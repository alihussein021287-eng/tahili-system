import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import type { PrismaClient, UserRole } from "@prisma/client";
import { loadPermissionsFromStore } from "../../../src/lib/permission-store";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const denialDigest = "NEXT_HTTP_ERROR_FALLBACK;404";

async function snapshot(db: PrismaClient) {
  const tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
  );
  if (!tables.length || tables.some(t => !/^[A-Za-z0-9_]+$/.test(t.table_name))) throw new Error("Invalid disposable schema");
  return db.$queryRawUnsafe<Array<{ table_name: string; count: number; checksum: string }>>(tables.map(t =>
    `SELECT '${t.table_name}' AS table_name, count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS checksum FROM public."${t.table_name}" t`,
  ).join(" UNION ALL "));
}

// Inspect every byte, HTML script and decoded Flight record without evaluating JavaScript.
function decodedPayload(body: string) {
  const strings = [body];
  const flight: string[] = [];
  const errorRecords: Array<Record<string, unknown>> = [];
  let scripts = 0, frames = 0, parsedRecords = 0, parseFailures = 0;
  const collect = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, val]) => { strings.push(key); collect(val); });
  };
  for (const match of body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    scripts++;
    const script = match[1];
    if (!script.includes("self.__next_f")) continue;
    const start = script.indexOf(".push(");
    const end = script.lastIndexOf(")");
    if (start < 0 || end < start) { parseFailures++; continue; }
    try {
      const frame: unknown = JSON.parse(script.slice(start + 6, end));
      frames++;
      collect(frame);
      if (Array.isArray(frame) && frame[0] === 1 && typeof frame[1] === "string") flight.push(frame[1]);
    } catch { parseFailures++; }
  }
  const stream = flight.join("");
  strings.push(stream);
  for (const line of stream.split("\n")) {
    const match = /^[0-9a-f]+:([A-Z]*)([\s\S]*)$/i.exec(line);
    if (!match || !/^[\[{"0-9-]/.test(match[2])) continue;
    try {
      const record: unknown = JSON.parse(match[2]);
      parsedRecords++;
      collect(record);
      if (match[1] === "E" && record && typeof record === "object" && !Array.isArray(record)) {
        errorRecords.push(record as Record<string, unknown>);
      }
    } catch { parseFailures++; }
  }
  const decode = (value: string) => value
    .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex: string, dec: string) => {
      const point = parseInt(hex || dec, hex ? 16 : 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "\ufffd";
    })
    .replace(/&quot;|&apos;|&lt;|&gt;|&amp;/g, entity => ({ "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" })[entity]!)
    .replace(/(?:%[0-9a-f]{2})+/gi, encoded => { try { return decodeURIComponent(encoded); } catch { return encoded; } })
    .replace(/\\(["\\/])/g, "$1");
  let decoded = strings.join("\n"), stable = false;
  for (let i = 0; i < 12; i++) {
    const next = decode(decoded);
    if (next === decoded) { stable = true; break; }
    strings.push(next); decoded = next;
  }
  return { corpus: strings.join("\n"), scripts, frames, parsedRecords, parseFailures, stable, errorRecords,
    flightNotFound: errorRecords.some(record => record.digest === denialDigest) };
}

export async function verifyPatientDenial(page: Page, db: PrismaClient, input: {
  caseId: "03" | "08"; actorId: string; role: UserRole; patientId: string;
}) {
  const { canAccessPatientRecord } = await import("../../../src/lib/patient-access");
  const target = await db.patient.findUniqueOrThrow({ where: { id: input.patientId },
    include: { treatmentPlans: true, referralRequests: true } });
  const perms = await loadPermissionsFromStore(input.actorId, input.role, {
    findRolePermissions: role => db.rolePermission.findMany({ where: { role } }),
    findUserPermissions: userId => db.userPermission.findMany({ where: { userId } }),
  });
  const sourceGuardDenies = !(await canAccessPatientRecord(db, { userId: input.actorId, role: input.role, permissions: perms }, target.id));
  const who = await page.evaluate(async () => {
    const session = await (await fetch("/api/auth/session")).json();
    return { id: session?.user?.id, role: session?.user?.role, authVersion: session?.user?.authVersion };
  });
  const liveActor = await db.user.findUniqueOrThrow({ where: { id: input.actorId },
    select: { role: true, isActive: true, needsActivation: true, authVersion: true } });
  const identityVerified = who.id === input.actorId && who.role === input.role && liveActor.role === input.role &&
    liveActor.isActive && !liveActor.needsActivation && Number.isInteger(who.authVersion) && who.authVersion === liveActor.authVersion;
  const before = await snapshot(db);
  const url = `${process.env.E2E_BASE_URL}/patients/${target.id}`;
  const requestHeaders: Record<string, string> = {};
  let requestCaptured = false, requestEvidencePending: Promise<void> | undefined;
  const requestListener = (request: import("@playwright/test").Request) => {
    if (request.url() !== url || request.method() !== "GET") return;
    requestEvidencePending = (async () => {
      const all = await request.allHeaders();
      for (const key of ["accept", "rsc", "next-router-state-tree", "next-action", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"]) {
        if (all[key]) requestHeaders[key] = all[key];
      }
      requestCaptured = true;
    })();
  };
  page.on("request", requestListener);
  const response = await page.evaluate(async url => {
    const start = performance.now();
    const response = await fetch(url, { redirect: "manual" });
    const headersMs = performance.now() - start;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let body = "", bytes = 0, chunks = 0, firstChunkMs: number | null = null, denialChunk: number | null = null;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks++; bytes += part.value.byteLength;
      if (firstChunkMs === null) firstChunkMs = performance.now() - start;
      body += decoder.decode(part.value, { stream: true });
      if (denialChunk === null && body.includes("NEXT_HTTP_ERROR_FALLBACK;404")) denialChunk = chunks;
    }
    body += decoder.decode();
    return { body, bytes, chunks, firstChunkMs, denialChunk, headersMs, complete: true,
      elapsedMs: performance.now() - start, status: response.status, url: response.url,
      headers: Object.fromEntries(response.headers) };
  }, url);
  await requestEvidencePending;
  page.off("request", requestListener);
  const after = await snapshot(db);
  const decoded = decodedPayload(response.body);
  const values: Array<{ field: string; value: string }> = [];
  const add = (field: string, value: unknown) => { if (typeof value === "string" && value.length > 10) values.push({ field, value }); };
  for (const key of ["fullName", "motherName", "phone", "notes", "accessToken"] as const) add(`patient.${key}`, target[key]);
  if (String(target.fileNumber).length >= 6) values.push({ field: "patient.fileNumber", value: String(target.fileNumber) });
  for (const plan of target.treatmentPlans) {
    for (const key of ["id", "title", "goals", "beforeCondition", "afterCondition", "notes", "finalRecommendation"] as const) add(`plan.${key}`, plan[key]);
  }
  for (const referral of target.referralRequests) {
    for (const key of ["id", "requestedService", "clinicalReason"] as const) add(`referral.${key}`, referral[key]);
  }
  const corpus = decoded.corpus + "\n" + JSON.stringify(response.headers);
  const forbiddenValueHits = values.filter(item => corpus.includes(item.value)).map(item => item.field);
  const nestedKeys = ["treatmentPlan", "treatmentPlans", "therapySessions", "therapySessionLogs", "goals", "beforeCondition", "afterCondition", "finalRecommendation", "fileNumber"];
  const forbiddenRelationKeys = nestedKeys.filter(key => new RegExp(`"${key}"\\s*:`).test(decoded.corpus));
  const rawErrorPatterns: Record<string, RegExp> = {
    sqlOrDatabaseError: /PrismaClient(?:KnownRequest|UnknownRequest|Validation|Initialization)Error|postgres(?:ql)?:\/\/|(?:SELECT|INSERT INTO|UPDATE)\s+"[A-Za-z_]+"/,
    rawStackOrServerPath: /(?:at\s+(?:async\s+)?\w+\s*\([^\n]*:\d+:\d+\))|\/app\/\.next\/server|[A-Z]:\\Users\\|node:internal\//,
  };
  const rawErrorHits = Object.entries(rawErrorPatterns).filter(([, pattern]) => pattern.test(corpus)).map(([key]) => key);
  const secretHits = ["NEXTAUTH_SECRET", "ACCEPTANCE_DB_PASSWORD", "E2E_PASSWORD", "DATABASE_URL"]
    .filter(key => process.env[key] && corpus.includes(process.env[key]!));
  const genericMessage = /^An error occurred in the Server Components render\./;
  const rawErrorRecord = decoded.errorRecords.some(record => record.stack ||
    (record.message && (typeof record.message !== "string" || !genericMessage.test(record.message))) || record.digest !== denialDigest);
  const changedTables = before.filter((table, index) => JSON.stringify(table) !== JSON.stringify(after[index])).map(table => table.table_name);
  const noindex = /<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(response.body);
  const responseHeaders = Object.fromEntries(["content-type", "transfer-encoding", "content-encoding", "content-length", "vary", "cache-control"]
    .filter(key => response.headers[key]).map(key => [key, response.headers[key]]));
  const evidence = {
    caseId: `M41R1-HTTP-${input.caseId}`, phase: process.env.PAYLOAD_DENIAL_PHASE || "observe",
    request: { method: "GET", url, requestedSyntheticPatientId: target.id, targetNameSha256: hash(target.fullName),
      headers: requestHeaders, requestCaptured, rscHeaderAbsent: !requestHeaders.rsc, actionHeaderAbsent: !requestHeaders["next-action"],
      responsePathUnchanged: response.url === url },
    authentication: { identityVerified, actorId: input.actorId, role: input.role, effectivePermissions: [...perms].sort(),
      noRoleOverrides: await db.rolePermission.count() === 0, noUserOverrides: await db.userPermission.count() === 0 },
    response: { status: response.status, contentType: response.headers["content-type"], headers: responseHeaders,
      complete: response.complete, decodedBytes: response.bytes, sha256: hash(response.body),
      byteLengthVerified: Buffer.byteLength(response.body, "utf8") === response.bytes,
      chunks: response.chunks, headersMs: response.headersMs, firstChunkMs: response.firstChunkMs, denialChunk: response.denialChunk,
      shellChunkPrecedesDenialMarker: response.denialChunk !== null && response.denialChunk > 1,
      elapsedMs: response.elapsedMs, html: /<!DOCTYPE html>/i.test(response.body), noindex,
      redirectHeadersAbsent: !response.headers.location && !response.headers["x-action-redirect"],
      rawBodySaved: false, sanitizedExcerpt: decoded.flightNotFound ? 'E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}' : null },
    inspection: { htmlScripts: decoded.scripts, embeddedFlightFrames: decoded.frames, parsedFlightRecords: decoded.parsedRecords,
      parseFailures: decoded.parseFailures, decodingStable: decoded.stable, allReceivedBytesInspected: true,
      valueChecks: values.map(item => ({ field: item.field, absent: !corpus.includes(item.value) })),
      forbiddenValueHits, forbiddenRelationKeys, rawErrorHits, secretHits, rawErrorRecord,
      correctTargetNameAbsent: !corpus.includes(target.fullName), flightNotFound: decoded.flightNotFound },
    authorization: { targetExists: true, sourceGuardDenies, denialSource: "src/app/(app)/patients/[id]/page.tsx:39",
      evidenceBasis: "Real HTTP Flight 404 digest plus independent execution of unchanged authoritative scope guard on the same actor, permissions and disposable database" },
    database: { tablesCompared: before.length, beforeSha256: hash(JSON.stringify(before)), afterSha256: hash(JSON.stringify(after)),
      changedTables, noMutation: changedTables.length === 0 },
  };
  const dir = dirname(process.env.PAYLOAD_FIXTURE_FILE!);
  writeFileSync(join(dir, `CASE_${input.caseId}_HTTP_EVIDENCE.json`), JSON.stringify(evidence, null, 2));
  const checkpointFile = join(dir, "RESUME_CHECKPOINT.json");
  const checkpoint = existsSync(checkpointFile) ? JSON.parse(readFileSync(checkpointFile, "utf8")) : {};
  checkpoint.lastCase = evidence.caseId; checkpoint.phase = evidence.phase;
  checkpoint.caseEvidence = { ...checkpoint.caseEvidence, [input.caseId]: `CASE_${input.caseId}_HTTP_EVIDENCE.json` };
  writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));
  expect(identityVerified).toBe(true);
  expect(requestCaptured).toBe(true);
  expect(sourceGuardDenies).toBe(true);
  expect(response.complete && evidence.response.byteLengthVerified).toBe(true);
  expect(response.url).toBe(url);
  expect(decoded.frames).toBeGreaterThan(0);
  expect(decoded.parseFailures).toBe(0);
  expect(decoded.stable).toBe(true);
  expect(decoded.flightNotFound).toBe(true);
  expect(noindex).toBe(true);
  expect(forbiddenValueHits).toEqual([]);
  expect(forbiddenRelationKeys).toEqual([]);
  expect(rawErrorHits).toEqual([]);
  expect(secretHits).toEqual([]);
  expect(rawErrorRecord).toBe(false);
  expect(changedTables).toEqual([]);
  expect(response.headers["content-type"]).toContain("text/html");
  return evidence;
}

/** A streamed HTML page denial, never a general-purpose HTTP/API success rule. */
export function expectPatientPageDenialStatus(evidence: Awaited<ReturnType<typeof verifyPatientDenial>>) {
  expect(evidence.request.method).toBe("GET");
  expect(evidence.request.rscHeaderAbsent && evidence.request.actionHeaderAbsent).toBe(true);
  expect(evidence.request.responsePathUnchanged && evidence.response.redirectHeadersAbsent).toBe(true);
  expect(evidence.authentication.identityVerified && evidence.authorization.sourceGuardDenies).toBe(true);
  expect(evidence.response.complete && evidence.response.byteLengthVerified && evidence.response.html && evidence.response.noindex).toBe(true);
  expect(evidence.response.contentType).toContain("text/html");
  expect(evidence.inspection.flightNotFound && evidence.inspection.decodingStable && evidence.inspection.correctTargetNameAbsent).toBe(true);
  expect(evidence.inspection.parseFailures).toBe(0);
  expect(evidence.inspection.forbiddenValueHits).toEqual([]);
  expect(evidence.inspection.forbiddenRelationKeys).toEqual([]);
  expect(evidence.inspection.rawErrorHits).toEqual([]);
  expect(evidence.inspection.secretHits).toEqual([]);
  expect(evidence.inspection.rawErrorRecord).toBe(false);
  expect(evidence.database.noMutation).toBe(true);
  expect([404, 200]).toContain(evidence.response.status);
  if (evidence.response.status === 200) {
    expect(evidence.response.headers["transfer-encoding"]).toBe("chunked");
    expect(evidence.response.headers["cache-control"]).toContain("no-store");
  }
}
