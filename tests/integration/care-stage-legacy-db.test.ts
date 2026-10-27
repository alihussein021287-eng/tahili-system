import { beforeAll, afterAll, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma, type UserRole } from "@prisma/client";
import { transitionCareStage, completeCenterStageWork } from "@/lib/care-stage-service";
import { hasApprovedCenterReviewerDesignationPolicy } from "@/lib/center-clinical-policy";
import { withSerializableRetry } from "@/lib/serializable-retry";
createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
const db = new PrismaClient(), first = new PrismaClient(), second = new PrismaClient(), observer = new PrismaClient();
const users = new Map<string, { id: string; role: UserRole }>();
let patientId: string, centerId: number;
const snapshots = path.resolve("release-evidence/mission-46-20261027");
const blockedModule = pathToFileURL(path.join(snapshots, "blocked-stage.ts")).href;
const oldModule = pathToFileURL(path.join(snapshots, "baseline-stage.ts")).href;
const evidence: unknown[] = [];
const actor = (key: string) => ({ userId: users.get(key)!.id, role: users.get(key)!.role });
function save(label: string, result: unknown) {
  evidence.push({ label, result });
  writeFileSync(process.env.M46_STATE!, JSON.stringify(evidence, null, 2));
}
const tx = <T>(call: (t: Prisma.TransactionClient) => Promise<T>) => db.$transaction(call, { isolationLevel: "Serializable" });
async function state(id: string) {
  return JSON.parse(JSON.stringify({ stage: await db.careStage.findUniqueOrThrow({ where: { id } }),
    audits: await db.auditLog.findMany({ where: { recordId: id }, orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ where: { careStageId: id }, orderBy: { id: "asc" } }) }));
}
async function denied(label: string, id: string, call: () => Promise<unknown>) {
  const before = await state(id); await expect(call()).rejects.toThrow();
  const after = await state(id); expect(after).toEqual(before); save(label, { before, after, unchanged: true });
}
async function work(id: string, key = "head") {
  const s = await db.careStage.findUniqueOrThrow({ where: { id } });
  return tx(t => completeCenterStageWork(t, actor(key), { patientId: s.patientId, stageId: id, expectedUpdatedAt: s.updatedAt.toISOString() }));
}
beforeAll(async () => {
  // Reproducible, fixed source specimens: never rely on an untracked hand-edited copy.
  mkdirSync(snapshots, { recursive: true });
  for (const [name, sha] of [["blocked-stage.ts", "90ce6e7b4c7131aa9acdebc65af6c29f0c5b2b1b"], ["baseline-stage.ts", "f1401602d1b75c2d604e54e9de658ca2200fe615"]]) {
    writeFileSync(path.join(snapshots, name), execFileSync("git", ["show", `${sha}:src/lib/care-stage-service.ts`], { windowsHide: true }));
  }
  const branch = await db.branch.create({ data: { name: "M46 SYNTHETIC branch" } });
  centerId = (await db.center.create({ data: { name: "M46 SYNTHETIC center" } })).id;
  for (const [key, role] of [["head", "HEAD_THERAPIST"], ["otherHead", "HEAD_THERAPIST"], ["doctor", "DOCTOR"], ["admin", "ADMIN"], ["manager", "MANAGER"]] as const) {
    const u = await db.user.create({ data: { username: `m46-${key}`, fullName: `M46 SYNTHETIC ${key}`, role, branchId: branch.id, passwordHash: "!unusable-synthetic", needsActivation: false } }); users.set(key, u);
    if (key !== "otherHead" && key !== "admin" && key !== "manager") await db.centerMembership.create({ data: { userId: u.id, centerId, role: role === "DOCTOR" ? "SPECIALIST" : "HEAD_THERAPIST", status: "ACTIVE" } });
  }
  patientId = (await db.patient.create({ data: { fullName: "M46 SYNTHETIC legacy", branchId: branch.id } })).id;
  const ids = ["old-proof", "old-work", "old-assignee", "old-no-center", "old-no-role", "old-unclassified", "old-denials", "old-lock-work-first", "old-lock-doctor-first", "old-history", "m44-legacy-confirmed"];
  for (const id of ids) await db.$executeRaw`INSERT INTO "CareStage" (id,"patientId",station,"responsibleRole","responsibilityScope","responsibleCenterId",status,sequence,"updatedAt") VALUES (${id},${patientId},'M46 SYNTHETIC','HEAD_THERAPIST','CENTER',${centerId},'WAITING',0,NOW())`;
  await db.$executeRaw`UPDATE "CareStage" SET "responsibleCenterId"=NULL WHERE id='old-no-center'`;
  await db.$executeRaw`UPDATE "CareStage" SET "responsibleRole"=NULL WHERE id='old-no-role'`;
  await db.$executeRaw`UPDATE "CareStage" SET "responsibilityScope"=NULL WHERE id='old-unclassified'`;
  await db.$executeRaw`UPDATE "CareStage" SET "assignedUserId"=${users.get("otherHead")!.id} WHERE id='old-assignee'`;
  await db.$executeRaw`UPDATE "CareStage" SET status='CONFIRMED',"confirmedById"=${users.get("head")!.id},"confirmedAt"=NOW() WHERE id IN ('old-history','m44-legacy-confirmed')`;
  const before = await db.$queryRaw<{ rows: Record<string, unknown>[] }[]>`SELECT json_agg(s) AS rows FROM (SELECT * FROM "CareStage" ORDER BY id) s`;
  const sql = readFileSync("prisma/migrations/20261027090000_care_stage_operational_completion/migration.sql", "utf8");
  for (const stmt of sql.split(";").map(s => s.trim()).filter(Boolean)) await db.$executeRawUnsafe(stmt);
  const after = await db.$queryRaw<{ rows: Record<string, unknown>[] }[]>`SELECT json_agg(s) AS rows FROM (SELECT * FROM "CareStage" ORDER BY id) s`;
  expect(after[0].rows.map(row => { const r = { ...row }; for (const k of ["requiresPhysicianConfirmation", "operationalCompletedById", "operationalCompletedAt", "operationalCompletionId"]) { expect(r[k]).toBeNull(); delete r[k]; } return r; })).toEqual(before[0].rows);
  save("real-migration-rehearsal", { before, after, oldValuesUnchanged: true, noBackfill: true });
});
afterAll(async () => { await Promise.all([db.$disconnect(), first.$disconnect(), second.$disconnect(), observer.$disconnect()]); });

it("reproduces M45 blocked-candidate P1 on the migrated historical record", async () => {
  // Exact prior candidate copied into private evidence by the runner, not patched.
  const previous: Pick<typeof import("@/lib/care-stage-service"), "completeCenterStageWork"> = await import(blockedModule);
  const s = await db.careStage.findUniqueOrThrow({ where: { id: "old-proof" } });
  await denied("prior-candidate-stranding", s.id, () => tx(t => previous.completeCenterStageWork(t, actor("head"), { patientId, stageId: s.id, expectedUpdatedAt: s.updatedAt.toISOString() })));
  await work(s.id); expect((await state(s.id)).stage).toMatchObject({ status: "IN_PROGRESS", requiresPhysicianConfirmation: null, operationalCompletedById: users.get("head")!.id, confirmedById: null });
  save("same-row-corrected", await state(s.id));
});
it("allows legitimate historical CENTER progress and explicit completion without medical inference", async () => {
  await tx(t => transitionCareStage(t, actor("head"), { patientId, stageId: "old-work", to: "IN_PROGRESS" }));
  await work("old-work"); const s = await state("old-work");
  expect(s.stage).toMatchObject({ status: "IN_PROGRESS", requiresPhysicianConfirmation: null, operationalCompletedById: users.get("head")!.id, confirmedById: null, confirmedAt: null });
  expect(s.stage.operationalCompletionId).toBeTruthy();
  expect(s.audits.filter((a: { newValue?: { operationalCompletion?: boolean } }) => a.newValue?.operationalCompletion)).toHaveLength(1);
  save("historical-operational-completion", s);
});
it.each(["old-no-center", "old-no-role", "old-unclassified", "old-assignee"])("keeps ambiguous or mismatched responsibility controlled: %s", async id => {
  await denied(`manual-reconciliation-${id}`, id, () => work(id));
});
it.each(["doctor", "admin", "manager", "otherHead"])("does not expand operational ownership to %s", async key => {
  await denied(`operational-actor-${key}`, "old-denials", () => work("old-denials", key));
});
it("requires current membership, effective permission, active account and actual patient scope", async () => {
  const h = users.get("head")!; const m = await db.centerMembership.findFirstOrThrow({ where: { userId: h.id, centerId } });
  await db.centerMembership.update({ where: { id: m.id }, data: { endDate: new Date(0) } });
  await denied("expired-membership", "old-denials", () => work("old-denials"));
  await db.centerMembership.update({ where: { id: m.id }, data: { endDate: null } });
  await db.userPermission.create({ data: { userId: h.id, permKey: "journey.confirm", allowed: false } });
  await denied("permission-revoked", "old-denials", () => work("old-denials"));
  await db.userPermission.delete({ where: { userId_permKey: { userId: h.id, permKey: "journey.confirm" } } });
  await db.user.update({ where: { id: h.id }, data: { isActive: false } });
  await denied("inactive-actor", "old-denials", () => work("old-denials"));
  await db.user.update({ where: { id: h.id }, data: { isActive: true } });
  const branch = await db.branch.create({ data: { name: "M46 OTHER SYNTHETIC" } });
  const p = await db.patient.create({ data: { branchId: branch.id, fullName: "M46 SYNTHETIC scope" } });
  const stage = await db.careStage.create({ data: { patientId: p.id, station: "M46 scope", responsibilityScope: "CENTER", responsibleCenterId: centerId, responsibleRole: "HEAD_THERAPIST" } });
  await denied("patient-scope", stage.id, () => work(stage.id));
});
it("preserves historical CONFIRMED values without retroactive physician approval", async () => {
  const before = await state("old-history");
  expect(before.stage).toMatchObject({ status: "CONFIRMED", requiresPhysicianConfirmation: null, confirmedById: users.get("head")!.id, operationalCompletedAt: null });
  await denied("historical-final-no-work", "old-history", () => work("old-history"));
  expect(await state("old-history")).toEqual(before);
});
it("does not accept legacy final confirmation or reopen completed work while designation is unresolved", async () => {
  expect(hasApprovedCenterReviewerDesignationPolicy()).toBe(false);
  for (const key of ["head", "doctor", "admin", "manager"]) await denied(`legacy-no-medical-${key}`, "old-work", () => tx(t => transitionCareStage(t, actor(key), { patientId, stageId: "old-work", to: "CONFIRMED" })));
  await denied("no-skip-after-work", "old-work", () => tx(t => transitionCareStage(t, actor("head"), { patientId, stageId: "old-work", to: "SKIPPED" })));
});
it("proves old app is incompatible with persisted new work; no old-image recovery promise", async () => {
  const old: Pick<typeof import("@/lib/care-stage-service"), "transitionCareStage"> = await import(oldModule);
  await tx(t => old.transitionCareStage(t, actor("admin"), { patientId, stageId: "old-proof", to: "CONFIRMED" }));
  expect((await state("old-proof")).stage).toMatchObject({ status: "CONFIRMED", requiresPhysicianConfirmation: null, confirmedById: users.get("admin")!.id, operationalCompletedById: users.get("head")!.id });
  save("old-binary-incompatible-after-work", { oldAppRollbackAfterNewWrites: "PROHIBITED", state: await state("old-proof") });
});

function barrier() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
it.each([true, false])("proves actual legacy work/medical lock ordering, workFirst=%s", async workFirst => {
  const id = workFirst ? "old-lock-work-first" : "old-lock-doctor-first";
  const row = await db.careStage.findUniqueOrThrow({ where: { id } });
  const workCall = (t: Prisma.TransactionClient) => completeCenterStageWork(t, actor("head"), { patientId, stageId: id, expectedUpdatedAt: row.updatedAt.toISOString() });
  const doctorCall = (t: Prisma.TransactionClient) => transitionCareStage(t, actor("doctor"), { patientId, stageId: id, to: "CONFIRMED" });
  const held = barrier(), release = barrier(), launched = barrier(); let blocker = 0, waiter = 0;
  const a = first.$transaction(async t => { await t.$executeRaw`SET LOCAL lock_timeout='6s'`; blocker = (await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; await t.$queryRaw`SELECT id FROM "CareStage" WHERE id=${id} FOR UPDATE`; held.resolve(); await release.promise; return (workFirst ? workCall : doctorCall)(t); }, { isolationLevel: "Serializable", timeout: 12000 });
  const ar = a.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error) }));
  await held.promise;
  const b = withSerializableRetry(() => second.$transaction(async t => { await t.$executeRaw`SET LOCAL lock_timeout='6s'`; waiter = (await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; launched.resolve(); return (workFirst ? doctorCall : workCall)(t); }, { isolationLevel: "Serializable", timeout: 12000 }));
  const br = b.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error) }));
  await launched.promise; let proof: unknown;
  try { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const rows = await observer.$queryRaw<{ pid: number; blockers: number[]; wait_event_type: string }[]>`SELECT pid,pg_blocking_pids(pid) AS blockers,wait_event_type FROM pg_stat_activity WHERE pid=${waiter}`; if (rows[0]?.wait_event_type === "Lock" && rows[0].blockers.includes(blocker)) { proof = rows[0]; break; } await new Promise(r => setTimeout(r, 25)); } expect(proof).toBeTruthy(); } finally { release.resolve(); }
  const results = await Promise.all([ar, br]); expect(results.map(r => r.ok)).toEqual(workFirst ? [true, false] : [false, true]);
  const s = await state(id); expect(s.stage).toMatchObject({ status: "IN_PROGRESS", operationalCompletedById: users.get("head")!.id, confirmedById: null });
  expect(s.audits.filter((a: { newValue?: { operationalCompletion?: boolean } }) => a.newValue?.operationalCompletion)).toHaveLength(1);
  save(`legacy-lock-${workFirst ? "work-first" : "doctor-first"}`, { blocker, waiter, proof, results, state: s });
});
