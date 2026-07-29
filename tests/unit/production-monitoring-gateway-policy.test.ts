import { describe, expect, it } from "vitest";
import { OBSERVABILITY_QUERIES } from "@/lib/observability-summary";
import { APP_IP, GATEWAY_IP, KNOWN_PROM_QUERIES, PROMETHEUS_IP, ROUTES, SMOKE_SUMMARY_PATH, isAllowedRequest } from "../../monitoring/production/gateway-policy.mjs";
import { parseSmokeSummary } from "../../monitoring/production/smoke-summary.mjs";

describe("production monitoring gateway policy", () => {
  it("allows only the fixed app source and known summary query", () => {
    expect(isAllowedRequest({ source: APP_IP, port: 9090, method: "GET", rawUrl: "/api/v1/query?query=up" })).toBe(true);
    expect(isAllowedRequest({ source: APP_IP, port: 9090, method: "GET", rawUrl: "/api/v1/query?query=arbitrary" })).toBe(false);
  });

  it("serves only the fixed bounded smoke aggregate to the app peer", () => {
    expect(isAllowedRequest({ source: APP_IP, port: 9090, method: "GET", rawUrl: SMOKE_SUMMARY_PATH })).toBe(true);
    expect(isAllowedRequest({ source: "172.30.255.9", port: 9090, method: "GET", rawUrl: SMOKE_SUMMARY_PATH })).toBe(false);
    expect(isAllowedRequest({ source: APP_IP, port: 9090, method: "GET", rawUrl: `${SMOKE_SUMMARY_PATH}?path=x` })).toBe(false);
    expect(parseSmokeSummary([
      "tahili_smoke_success 1",
      "tahili_smoke_last_run_timestamp 1000",
      "tahili_smoke_duration_seconds 4.5",
      "tahili_smoke_failed_checks 0",
      "tahili_smoke_passed_checks 17",
      "tahili_smoke_total_checks 17",
    ].join("\n"), 1_100)).toEqual({
      success: true,
      timestampSeconds: 1_000,
      durationSeconds: 4.5,
      failedChecks: 0,
      passedChecks: 17,
      totalChecks: 17,
    });
    expect(parseSmokeSummary("tahili_smoke_success 1", 1_100)).toBeNull();
  });

  it("covers every immutable application summary query without allowing arbitrary queries", () => {
    for (const query of Object.values(OBSERVABILITY_QUERIES)) expect(KNOWN_PROM_QUERIES.has(query)).toBe(true);
    expect(KNOWN_PROM_QUERIES).toHaveLength(Object.keys(OBSERVABILITY_QUERIES).length);
  });

  it("uses fixed monitoring IPs for control-plane upstreams, never app aliases or gateway self", () => {
    const controlPlaneTargets = [9090, 9093, 3100, 3200, 12347, 4318]
      .map((port) => ROUTES.get(port)?.target[0]);
    expect(controlPlaneTargets).toEqual([
      "172.30.254.2", "172.30.254.4", "172.30.254.5", "172.30.254.6", "172.30.254.7", "172.30.254.7",
    ]);
    expect(controlPlaneTargets).not.toContain(GATEWAY_IP);
    for (const alias of ["prometheus", "alertmanager", "loki", "tempo", "alloy"]) {
      expect(controlPlaneTargets).not.toContain(alias);
    }
  });

  it("rejects a non-app source on control-plane and permits only fixed Prometheus metrics scrape", () => {
    expect(isAllowedRequest({ source: "172.30.255.9", port: 12347, method: "POST", rawUrl: "/collect" })).toBe(false);
    expect(isAllowedRequest({ source: PROMETHEUS_IP, port: 9101, method: "GET", rawUrl: "/api/observability/faro/metrics" })).toBe(true);
    expect(isAllowedRequest({ source: PROMETHEUS_IP, port: 9101, method: "GET", rawUrl: "/anything-else" })).toBe(false);
    expect(ROUTES.get(9101)?.upstreamHost).toBe("app:3000");
  });
});
