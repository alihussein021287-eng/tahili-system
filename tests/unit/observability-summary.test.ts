import { describe, expect, it } from "vitest";
import { OBSERVABILITY_QUERIES, fetchBoundedJson, getObservabilitySummary } from "@/lib/observability-summary";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const prom = (value: string, labels: Record<string, string> = {}) => ({ status: "success", data: { result: [{ metric: labels, value: [0, value] }] } });

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
});
