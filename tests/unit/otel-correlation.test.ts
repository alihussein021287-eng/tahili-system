import { TraceFlags } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { correlateTrustedRequest } from "@/lib/otel/correlation";

const requestId = "123e4567-e89b-12d3-a456-426614174000";

function sampledSpan(traceFlags: number) {
  const attributes: Record<string, unknown> = {};
  const target = {
    attributes,
    spanContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags }),
    setAttribute: (key: string, value: unknown) => { attributes[key] = value; return target; },
  };
  return target;
}

describe("trusted request trace correlation", () => {
  it("adds only a proxy-minted request ID to a sampled span", () => {
    const target = sampledSpan(TraceFlags.SAMPLED);
    expect(correlateTrustedRequest(target, requestId, "proxy")).toEqual({ requestId, traceId: "a".repeat(32) });
    expect(target.attributes).toEqual({ "tahili.request_id": requestId });
  });

  it("does not create a trace ID for an unsampled request", () => {
    const target = sampledSpan(TraceFlags.NONE);
    expect(correlateTrustedRequest(target, requestId, "proxy")).toBeNull();
    expect(target.attributes).toEqual({});
  });

  it("rejects spoofed source and non-generated request IDs", () => {
    const target = sampledSpan(TraceFlags.SAMPLED);
    expect(correlateTrustedRequest(target, requestId, "incoming")).toBeNull();
    expect(correlateTrustedRequest(target, "patient-42", "proxy")).toBeNull();
    expect(target.attributes).toEqual({});
  });
});
