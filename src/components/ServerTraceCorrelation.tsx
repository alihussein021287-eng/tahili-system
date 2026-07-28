import { trace } from "@opentelemetry/api";
import { headers } from "next/headers";
import { correlateTrustedRequest } from "@/lib/otel/correlation";
import { logEvent } from "@/lib/observability";

/** Server-only bridge from proxy-minted request IDs to sampled Next request spans. */
export async function ServerTraceCorrelation() {
  if (process.env.OTEL_ENABLED !== "true") return null;
  const requestHeaders = await headers();
  const correlation = correlateTrustedRequest(
    trace.getActiveSpan(),
    requestHeaders.get("x-tahili-request-id"),
    requestHeaders.get("x-tahili-request-id-source"),
  );
  if (correlation) {
    logEvent({
      level: "info",
      eventType: "request_trace",
      requestId: correlation.requestId,
      traceId: correlation.traceId,
    });
  }
  return null;
}
