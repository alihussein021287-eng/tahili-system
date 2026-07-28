import { beforeEach, describe, expect, it } from "vitest";
import { recordFaroAccepted, recordFaroForwardFailure, recordFaroForwarded, recordFaroRejected, recordFaroRequest, renderFaroMetrics, resetFaroMetricsForTests } from "@/lib/faro-metrics";

describe("Faro aggregate metrics", () => {
  beforeEach(() => resetFaroMetricsForTests());

  it("renders fixed Prometheus names, labels, and runtime enabled gauge only", () => {
    recordFaroRequest(); recordFaroRejected("origin"); recordFaroForwardFailure("timeout");
    const output = renderFaroMetrics(true);
    expect(output).toContain("tahili_faro_enabled 1");
    expect(output).toContain('tahili_faro_rejected_total{reason="origin"} 1');
    expect(output).toContain('tahili_faro_forward_failures_total{reason="timeout"} 1');
    expect(output).toContain("tahili_faro_process_start_time_seconds");
    expect(output).not.toContain("patientName"); expect(output).not.toContain("password"); expect(output).not.toContain("runId");
  });

  it("counts accepted signal kinds, bounded levels, and valid LCP buckets", () => {
    recordFaroAccepted({ events: 1, logs: ["error", "unknown"], measurements: [{ type: "LCP", value: 700 }, { type: "LCP", value: Number.NaN }, { type: "CLS", value: 2 }] });
    recordFaroForwarded();
    const output = renderFaroMetrics(false);
    expect(output).toContain("tahili_faro_enabled 0");
    expect(output).toContain('tahili_faro_signals_total{kind="event"} 1');
    expect(output).toContain('tahili_faro_signals_total{kind="measurement"} 3');
    expect(output).toContain('tahili_faro_frontend_logs_total{level="error"} 1');
    expect(output).toContain('tahili_faro_lcp_milliseconds_bucket{le="1000"} 1');
    expect(output).toContain("tahili_faro_lcp_milliseconds_count 1");
    expect(output).toContain("tahili_faro_last_accepted_timestamp_seconds ");
    expect(output).toContain("tahili_faro_last_forwarded_timestamp_seconds ");
  });
});
