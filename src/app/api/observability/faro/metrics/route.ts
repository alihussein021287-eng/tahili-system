import { NextResponse } from "next/server";
import { faroEnabled } from "@/lib/faro";
import { renderFaroMetrics } from "@/lib/faro-metrics";
import { renderOtelMetrics } from "@/lib/otel/metrics";

export function GET() {
  return new NextResponse(renderFaroMetrics(faroEnabled()) + renderOtelMetrics(process.env.OTEL_ENABLED === "true"), { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } });
}
