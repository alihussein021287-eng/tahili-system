import { NextRequest, NextResponse } from "next/server";
import { resolveEnvironmentAccess } from "@/lib/environment-access";
import { faroEnabled, sanitizeFaroEnvelope } from "@/lib/faro";

const recent: number[] = [];
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const access = resolveEnvironmentAccess(request.headers);
  if (!access || !faroEnabled() || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return new NextResponse(null, { status: 404, headers: noStore });
  if (request.headers.get("origin") !== access.origin) return new NextResponse(null, { status: 403, headers: noStore });
  if (Number(request.headers.get("content-length") || 0) > 2048) return new NextResponse(null, { status: 413, headers: noStore });
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).byteLength > 2048) return new NextResponse(null, { status: 413, headers: noStore });
  const safe = sanitizeFaroEnvelope((() => { try { return JSON.parse(text); } catch { return null; } })(), process.env.GIT_REVISION || "unknown");
  if (!safe) return new NextResponse(null, { status: 400, headers: noStore });
  if (!("events" in safe || "logs" in safe || "measurements" in safe)) return new NextResponse(null, { status: 204, headers: noStore });
  const now = Date.now(); while (recent[0] && recent[0] < now - 60_000) recent.shift(); if (recent.length >= 30) return new NextResponse(null, { status: 429, headers: noStore }); recent.push(now);
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 1500); timer.unref?.();
    const response = await fetch("http://alloy:12347/collect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(safe), signal: controller.signal, cache: "no-store" });
    clearTimeout(timer); if (!response.ok) return new NextResponse(null, { status: 202, headers: noStore });
  } catch { /* telemetry must never affect the application */ }
  return new NextResponse(null, { status: 202, headers: noStore });
}
