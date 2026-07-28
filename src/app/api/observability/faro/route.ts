import { NextRequest, NextResponse } from "next/server";
import { resolveEnvironmentAccess } from "@/lib/environment-access";
import { faroEnabled, sanitizeFaroEnvelope } from "@/lib/faro";
import { recordFaroAccepted, recordFaroForwarded, recordFaroForwardFailure, recordFaroRejected, recordFaroRequest } from "@/lib/faro-metrics";

const recent: number[] = [];
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const access = resolveEnvironmentAccess(request.headers);
  recordFaroRequest();
  if (!faroEnabled()) { recordFaroRejected("disabled"); return new NextResponse(null, { status: 404, headers: noStore }); }
  if (!access || request.headers.get("origin") !== access.origin) { recordFaroRejected("origin"); return new NextResponse(null, { status: 403, headers: noStore }); }
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") { recordFaroRejected("content_type"); return new NextResponse(null, { status: 404, headers: noStore }); }
  if (Number(request.headers.get("content-length") || 0) > 2048) { recordFaroRejected("oversize"); return new NextResponse(null, { status: 413, headers: noStore }); }
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > 2048) { recordFaroRejected("oversize"); return new NextResponse(null, { status: 413, headers: noStore }); }
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { recordFaroRejected("malformed"); return new NextResponse(null, { status: 400, headers: noStore }); }
  const safe = sanitizeFaroEnvelope(parsed, process.env.GIT_REVISION || "unknown");
  if (!safe) { recordFaroRejected("malformed"); return new NextResponse(null, { status: 400, headers: noStore }); }
  if (!("events" in safe || "logs" in safe || "measurements" in safe)) { recordFaroRejected("empty"); return new NextResponse(null, { status: 204, headers: noStore }); }
  const now = Date.now(); while (recent[0] && recent[0] < now - 60_000) recent.shift(); if (recent.length >= 30) { recordFaroRejected("rate_limit"); return new NextResponse(null, { status: 429, headers: noStore }); } recent.push(now);
  const record = safe as { events?: unknown[]; logs?: Array<{ level?: unknown }>; measurements?: Array<{ type?: unknown; values?: { value?: unknown } }> };
  recordFaroAccepted({ events: record.events?.length || 0, logs: (record.logs || []).map((item) => String(item.level || "")), measurements: (record.measurements || []).map((item) => ({ type: String(item.type || ""), value: Number(item.values?.value) })) });
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 1500); timer.unref?.();
    const response = await fetch("http://alloy:12347/collect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(safe), signal: controller.signal, cache: "no-store" });
    clearTimeout(timer); if (!response.ok) { recordFaroForwardFailure("failure"); return new NextResponse(null, { status: 202, headers: noStore }); } recordFaroForwarded();
  } catch (error) { recordFaroForwardFailure(error instanceof DOMException && error.name === "AbortError" ? "timeout" : "failure"); }
  return new NextResponse(null, { status: 202, headers: noStore });
}

function rejectMethod() { recordFaroRequest(); recordFaroRejected("method"); return new NextResponse(null, { status: 405, headers: { ...noStore, Allow: "POST" } }); }
export const GET = rejectMethod;
export const PUT = rejectMethod;
export const DELETE = rejectMethod;
