import { describe, expect, it } from "vitest";
import { sumPrometheusMetric } from "../../scripts/lib/prometheus-metrics.mjs";

describe("Prometheus metric summary", () => {
  it("sums labeled and unlabeled samples without matching similarly named metrics", () => {
    const text = [
      "metric_total{source=\"one\"} 2",
      "metric_total{source=\"two\"} 3",
      "metric_total_extra 99",
      "gauge 7",
    ].join("\n");
    expect(sumPrometheusMetric(text, "metric_total")).toBe(5);
    expect(sumPrometheusMetric(text, "gauge")).toBe(7);
  });
});
