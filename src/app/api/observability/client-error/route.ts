import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CLIENT_ERROR_CODES, logEvent, normalizeRoute } from "@/lib/observability";
import { resolveEnvironmentAccess } from "@/lib/environment-access";

const report = z.object({ errorId: z.string().uuid(), route: z.string().max(512), errorCode: z.enum(CLIENT_ERROR_CODES), fingerprint: z.string().regex(/^[a-zA-Z0-9:_-]{1,128}$/) }).strict();
const recentReports: number[] = [];
const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 30;

function rateLimited(now: number) {
  while (recentReports[0] && recentReports[0] <= now - WINDOW_MS) recentReports.shift();
  if (recentReports.length >= MAX_REPORTS_PER_WINDOW) return true;
  recentReports.push(now);
  return false;
}

export async function POST(request: NextRequest) {
  const access = resolveEnvironmentAccess(request.headers);
  if (!access || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return new NextResponse(null, { status: 415, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== access.origin) return new NextResponse(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const size = Number(request.headers.get("content-length") || 0);
  if (size > 1024) return new NextResponse(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  const body = await request.text().catch(() => "");
  if (new TextEncoder().encode(body).byteLength > 1024) return new NextResponse(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  const parsed = report.safeParse((() => { try { return JSON.parse(body); } catch { return null; } })());
  if (!parsed.success) return new NextResponse(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (rateLimited(Date.now())) return new NextResponse(null, { status: 429, headers: { "Cache-Control": "no-store" } });
  const reportRequestId = crypto.randomUUID();
  logEvent({ eventType: "client_error_report", level: "error", errorId: parsed.data.errorId, reportRequestId, route: normalizeRoute(parsed.data.route), errorCode: parsed.data.errorCode, fingerprint: parsed.data.fingerprint, release: process.env.npm_package_version || "unknown" });
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
