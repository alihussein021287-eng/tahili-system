import { TraceFlags, type SpanContext } from "@opentelemetry/api";
import { requestId } from "@/lib/observability";

export type TraceCorrelation = {
  requestId: string;
  traceId: string;
};

type CorrelationSpan = {
  spanContext(): SpanContext;
  setAttribute(key: string, value: string): unknown;
};

/**
 * Correlate only the ID minted by the proxy with an already-sampled server span.
 * This deliberately never reads traceparent, baggage, cookies, or arbitrary headers.
 */
export function correlateTrustedRequest(
  span: CorrelationSpan | undefined,
  trustedRequestId: string | null,
  trustedSource: string | null,
): TraceCorrelation | null {
  if (trustedSource !== "proxy" || !trustedRequestId || requestId(trustedRequestId) !== trustedRequestId) return null;
  const context = span?.spanContext();
  if (!context || (context.traceFlags & TraceFlags.SAMPLED) === 0 || !/^[a-f0-9]{32}$/i.test(context.traceId)) return null;
  span.setAttribute("tahili.request_id", trustedRequestId);
  return { requestId: trustedRequestId, traceId: context.traceId };
}
