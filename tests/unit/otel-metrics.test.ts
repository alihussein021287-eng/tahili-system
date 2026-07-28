import { describe, expect, it } from "vitest";
import { recordOtelExport, renderOtelMetrics, resetOtelMetricsForTests } from "@/lib/otel/metrics";

describe("OTEL aggregate metrics", () => {
  it("exports only aggregate state without correlation labels", () => {
    resetOtelMetricsForTests();
    recordOtelExport({ code: 0 });
    const metrics = renderOtelMetrics(true);
    expect(metrics).toContain("tahili_otel_enabled 1");
    expect(metrics).toContain("tahili_otel_export_attempts_total 1");
    expect(metrics).not.toMatch(/trace[_-]?id|request[_-]?id|\{/i);
  });
});
