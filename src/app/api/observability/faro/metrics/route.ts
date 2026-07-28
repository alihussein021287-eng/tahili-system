import { NextResponse } from "next/server";
import { faroEnabled } from "@/lib/faro";
import { renderFaroMetrics } from "@/lib/faro-metrics";

export function GET() {
  return new NextResponse(renderFaroMetrics(faroEnabled()), { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } });
}
