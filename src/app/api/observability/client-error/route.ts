import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CLIENT_ERROR_CODES, logEvent, normalizeRoute } from "@/lib/observability";
import { resolveEnvironmentAccess } from "@/lib/environment-access";

const report = z.object({ errorId: z.string().uuid(), route: z.string().max(512), errorCode: z.enum(CLIENT_ERROR_CODES), fingerprint: z.string().regex(/^[a-zA-Z0-9:_-]{1,128}$/) }).strict();
const seen = new Map<string, number>();
export async function POST(request: NextRequest) {
  const access = resolveEnvironmentAccess(request.headers);
  if (!access || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return new NextResponse(null, { status: 415, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== access.origin) return new NextResponse(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const size = Number(request.headers.get("content-length") || 0);
  if (size > 1024) return new NextResponse(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  const parsed = report.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  const now = Date.now(); const key = `${request.headers.get("x-forwarded-for") || "local"}:${parsed.data.errorId}`;
  if ((seen.get(key) || 0) + 60_000 > now) return new NextResponse(null, { status: 429, headers: { "Cache-Control": "no-store" } });
  seen.set(key, now);
  const reportRequestId = crypto.randomUUID();
  logEvent({ eventType: "client_error_report", level: "error", errorId: parsed.data.errorId, reportRequestId, route: normalizeRoute(parsed.data.route), errorCode: parsed.data.errorCode, fingerprint: parsed.data.fingerprint, release: process.env.npm_package_version || "unknown" });
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
