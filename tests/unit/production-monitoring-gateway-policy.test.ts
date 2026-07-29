import { describe, expect, it } from "vitest";
import { OBSERVABILITY_QUERIES } from "@/lib/observability-summary";
import { APP_IP, GATEWAY_IP, KNOWN_PROM_QUERIES, PROMETHEUS_IP, ROUTES, isAllowedRequest } from "../../monitoring/production/gateway-policy.mjs";

describe("production monitoring gateway policy", () => {
  it("allows only the fixed app source and known summary query", () => {
    expect(isAllowedRequest({ source: APP_IP, port: 9090, method: "GET", rawUrl: "/api/v1/query?query=up" })).toBe(true);
    expect(isAllowedRequest({ source: APP_IP, port: 9090, method: "GET", rawUrl: "/api/v1/query?query=arbitrary" })).toBe(false);
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
  });
});
