export const APP_IP = "172.30.255.2";
export const PROMETHEUS_IP = "172.30.254.2";
export const GATEWAY_IP = "172.30.255.3";
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_REQUESTS_PER_MINUTE = 120;

export const KNOWN_PROM_QUERIES = new Set([
  "up",
  "probe_success{job=\"blackbox\",instance=\"http://192.168.17.20:3000/login\"}",
  "probe_success{job=\"blackbox\",instance=\"http://minio:9000/minio/health/live\"}",
  "probe_success{job=\"blackbox-tcp\",instance=\"clamav:3310\"}",
  "up{job=\"postgres\"}",
  "up{job=\"alloy\"}",
  "up{job=\"tempo\"}",
  "tahili_smoke_success",
  "time() - tahili_smoke_last_run_timestamp",
  "tahili_smoke_duration_seconds",
  "100 - (avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
  "(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100",
  "max(100 * (1 - (node_filesystem_avail_bytes{fstype!~\"tmpfs|overlay\"} / node_filesystem_size_bytes{fstype!~\"tmpfs|overlay\"})))",
  "tahili_faro_enabled",
  "sum(rate(tahili_faro_frontend_logs_total{level=\"error\"}[5m])) * 60",
  "histogram_quantile(0.95, sum by (le) (rate(tahili_faro_lcp_milliseconds_bucket[10m])))",
  "sum(increase(tahili_faro_forward_failures_total[5m]))",
  "tahili_otel_enabled",
  "sum(rate(tahili_server_calls_total[5m])) * 60",
  "histogram_quantile(0.95, sum by (le) (rate(tahili_server_duration_milliseconds_bucket[10m])))",
  "100 * sum(rate(tahili_server_calls_total{tahili_status_class=\"5xx\"}[5m])) / clamp_min(sum(rate(tahili_server_calls_total[5m])), 0.001)",
  "sum(increase(otelcol_exporter_send_failed_spans_total[5m])) + sum(increase(tahili_otel_export_failures_total[5m]))",
]);

export const ROUTES = new Map([
  [9090, { target: ["172.30.254.2", 9090], sources: [APP_IP], methods: ["GET"], paths: ["/api/v1/query"], query: "known-prom-query" }],
  [9093, { target: ["172.30.254.4", 9093], sources: [APP_IP], methods: ["GET"], paths: ["/api/v2/alerts", "/-/healthy"] }],
  [3100, { target: ["172.30.254.5", 3100], sources: [APP_IP], methods: ["GET"], paths: ["/ready"] }],
  [3200, { target: ["172.30.254.6", 3200], sources: [APP_IP], methods: ["GET"], paths: ["/ready"] }],
  [12347, { target: ["172.30.254.7", 12347], sources: [APP_IP], methods: ["POST"], paths: ["/collect"] }],
  [4318, { target: ["172.30.254.7", 4318], sources: [APP_IP], methods: ["POST"], paths: ["/v1/traces"] }],
  [9101, { target: [APP_IP, 3000], upstreamHost: "app:3000", sources: [PROMETHEUS_IP], methods: ["GET"], paths: ["/api/observability/faro/metrics"] }],
]);

export function normalizeAddress(address = "") {
  return address.replace(/^::ffff:/, "");
}

export function isAllowedRequest({ source, port, method, rawUrl }) {
  const route = ROUTES.get(port);
  if (!route || !route.sources.includes(normalizeAddress(source)) || !route.methods.includes(method)) return false;
  const url = new URL(rawUrl, "http://gateway");
  if (!route.paths.includes(url.pathname)) return false;
  if (route.query === "known-prom-query") {
    return [...url.searchParams.keys()].length === 1 && KNOWN_PROM_QUERIES.has(url.searchParams.get("query") ?? "");
  }
  return url.search === "";
}
