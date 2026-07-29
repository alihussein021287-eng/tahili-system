import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFaroMetricsForTests } from "@/lib/faro-metrics";

const enabled = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/faro", () => ({ faroEnabled: enabled }));

describe("Faro metric endpoint", () => {
  beforeEach(() => { enabled.mockReset(); enabled.mockReturnValue(true); resetFaroMetricsForTests(); });
  it("returns read-only Prometheus text without runtime configuration", async () => {
    const { GET } = await import("@/app/api/observability/faro/metrics/route");
    const response = GET(); const body = await response.text();
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("tahili_faro_enabled 1");
    expect(body).toContain("tahili_faro_telemetry_expected 0");
    expect(body).not.toMatch(/^tahili_faro_telemetry_expected\{/m);
    expect(body).not.toContain("FARO_ENABLED=");
  });
  it("reports disabled as a zero gauge", async () => {
    enabled.mockReturnValue(false); const { GET } = await import("@/app/api/observability/faro/metrics/route");
    const body = await (GET()).text();
    expect(body).toContain("tahili_faro_enabled 0");
    expect(body).toContain("tahili_faro_telemetry_expected 0");
  });
});
