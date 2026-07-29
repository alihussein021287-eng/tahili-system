import { describe, expect, it } from "vitest";
import { OBSERVABILITY_QUERIES, fetchBoundedJson, getObservabilitySummary } from "@/lib/observability-summary";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const prom = (value: string, labels: Record<string, string> = {}) => ({ status: "success", data: { result: [{ metric: labels, value: [0, value] }] } });
const emptyProm = { status: "success", data: { result: [] } };

describe("observability summary privacy contract", () => {
  it("uses a fixed, bounded query inventory", () => {
    expect(Object.values(OBSERVABILITY_QUERIES).every((query) => !query.includes("$"))).toBe(true);
    expect(Object.values(OBSERVABILITY_QUERIES).join(" ")).not.toMatch(/request_id|trace_id|patient|user|url/i);
  });

  it("fails safely for malformed and oversized monitoring responses", async () => {
    await expect(fetchBoundedJson("http://example.invalid", async () => new Response("not-json"))).rejects.toThrow();
    await expect(fetchBoundedJson("http://example.invalid", async () => new Response("{}", { headers: { "content-length": "999999" } }))).rejects.toThrow();
  });

  it("uses a short abortable timeout instead of holding the page on a monitoring outage", async () => {
    await expect(fetchBoundedJson("http://example.invalid", async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }))).rejects.toThrow();
  }, 3_000);

  it("keeps unavailable monitoring data out of the page DTO", async () => {
    const summary = await getObservabilitySummary(async (url) => {
      const text = String(url);
      if (text.includes("alertmanager")) return json([{ labels: { severity: "critical", service: "patient" } }]);
      if (text.includes("tempo") || text.includes("loki")) return json({});
      if (text.includes(encodeURIComponent(OBSERVABILITY_QUERIES.targets))) return json(prom("1", { job: "prometheus" }));
      return json(prom("1"));
    });
    expect(summary.alerts.services).toEqual([]);
    expect(summary.services.every((item) => !/http|trace|request|patient/i.test(`${item.label} ${item.key}`))).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/http:\/\/|trace_id|request_id|patient/);
  });

  it("classifies intended isolation, zero failures, and missing samples independently", async () => {
    const summary = await getObservabilitySummary(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v1/smoke-summary") return json({
        success: true,
        timestampSeconds: Date.now() / 1000,
        durationSeconds: 3.7,
        failedChecks: 0,
        passedChecks: 17,
        totalChecks: 17,
      });
      if (parsed.pathname === "/api/v2/alerts") return json([]);
      if (parsed.pathname.endsWith("/ready") || parsed.pathname.endsWith("/-/healthy")) return json({});
      const query = parsed.searchParams.get("query");
      if (query === OBSERVABILITY_QUERIES.targets) {
        return json({ status: "success", data: { result: ["alloy", "grafana"].map((job) => ({ metric: { job }, value: [0, "1"] })) } });
      }
      if (query === OBSERVABILITY_QUERIES.faroLcp || query === OBSERVABILITY_QUERIES.latencyP95 || query === OBSERVABILITY_QUERIES.server5xx) return json(emptyProm);
      if (query === OBSERVABILITY_QUERIES.faroEnabled || query === OBSERVABILITY_QUERIES.otelEnabled || query === OBSERVABILITY_QUERIES.faroSignals || query === OBSERVABILITY_QUERIES.alloyHealth) return json(prom("1"));
      return json(prom("0"));
    });

    expect(summary.services.slice(0, 4).every((service) => service.state === "security_na")).toBe(true);
    expect(Object.values(summary.resources).every((reading) => reading.state === "security_na")).toBe(true);
    expect(summary.smoke).toMatchObject({ state: "healthy", passedChecks: 17, totalChecks: 17 });
    expect(summary.faro.automaticTelemetryExpected).toEqual({ value: false, state: "security_na" });
    expect(summary.faro.errorsPerMinute).toEqual({ value: 0, state: "healthy" });
    expect(summary.faro.forwardFailures).toEqual({ value: 0, state: "healthy" });
    expect(summary.faro.lcpP95Ms).toEqual({ value: null, state: "waiting" });
    expect(summary.tracing.tracesPerMinute).toEqual({ value: null, state: "waiting" });
    expect(summary.tracing.server5xxPercent).toEqual({ value: null, state: "waiting" });
    expect(summary.tracing.exportFailures).toEqual({ value: 0, state: "healthy" });
    expect(summary.state).toBe("healthy");
  });

  it("marks a failed required monitoring source as actually unavailable", async () => {
    const summary = await getObservabilitySummary(async () => {
      throw new Error("offline");
    });
    expect(summary.state).toBe("unavailable");
    expect(summary.alerts.state).toBe("unavailable");
    expect(summary.smoke.state).toBe("unavailable");
    expect(summary.faro.enabled.state).toBe("unavailable");
  });
});
