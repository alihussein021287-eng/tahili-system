export type MonitoringState = "healthy" | "attention" | "unavailable";

export type ObservabilitySummary = {
  state: MonitoringState;
  refreshedAt: string;
  services: Array<{ key: string; label: string; state: MonitoringState }>;
  alerts: { total: number; critical: number; warning: number; services: string[]; state: MonitoringState };
  smoke: { state: MonitoringState; lastRunSecondsAgo: number | null; durationSeconds: number | null };
  resources: { cpuPercent: number | null; memoryPercent: number | null; diskPercent: number | null };
  faro: { enabled: boolean | null; errorsPerMinute: number | null; lcpP95Ms: number | null; forwardFailures: number | null };
  tracing: { enabled: boolean | null; tracesPerMinute: number | null; latencyP95Ms: number | null; server5xxPercent: number | null; exportFailures: number | null };
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PromResult = { status?: string; data?: { result?: Array<{ metric?: Record<string, string>; value?: [number, string] }> } };

const RESPONSE_LIMIT_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 1_500;

// These are server-only Docker-network endpoints. They are deliberately not
// configurable by request, environment, or client code.
const INTERNAL = {
  prometheus: "http://prometheus:9090",
  alertmanager: "http://alertmanager:9093",
  tempo: "http://tempo:3200",
  loki: "http://loki:3100",
} as const;

export const OBSERVABILITY_QUERIES = {
  targets: "up",
  appHealth: "probe_success{job=\"blackbox\",instance=\"http://192.168.17.20:3000/login\"}",
  minioHealth: "probe_success{job=\"blackbox\",instance=\"http://minio:9000/minio/health/live\"}",
  clamavHealth: "probe_success{job=\"blackbox-tcp\",instance=\"clamav:3310\"}",
  postgresHealth: "up{job=\"postgres\"}",
  alloyHealth: "up{job=\"alloy\"}",
  tempoHealth: "up{job=\"tempo\"}",
  smokeSuccess: "tahili_smoke_success",
  smokeLastRun: "time() - tahili_smoke_last_run_timestamp",
  smokeDuration: "tahili_smoke_duration_seconds",
  cpu: "100 - (avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
  memory: "(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100",
  disk: "max(100 * (1 - (node_filesystem_avail_bytes{fstype!~\"tmpfs|overlay\"} / node_filesystem_size_bytes{fstype!~\"tmpfs|overlay\"})))",
  faroEnabled: "tahili_faro_enabled",
  faroErrors: "sum(rate(tahili_faro_frontend_logs_total{level=\"error\"}[5m])) * 60",
  faroLcp: "histogram_quantile(0.95, sum by (le) (rate(tahili_faro_lcp_milliseconds_bucket[10m])))",
  faroForwardFailures: "sum(increase(tahili_faro_forward_failures_total[5m]))",
  otelEnabled: "tahili_otel_enabled",
  tracesRate: "sum(rate(tahili_server_calls_total[5m])) * 60",
  latencyP95: "histogram_quantile(0.95, sum by (le) (rate(tahili_server_duration_milliseconds_bucket[10m])))",
  server5xx: "100 * sum(rate(tahili_server_calls_total{tahili_status_class=\"5xx\"}[5m])) / clamp_min(sum(rate(tahili_server_calls_total[5m])), 0.001)",
  exportFailures: "sum(increase(otelcol_exporter_send_failed_spans_total[5m])) + sum(increase(tahili_otel_export_failures_total[5m]))",
} as const;

const SERVICE_LABELS: Record<string, string> = {
  app: "التطبيق",
  postgres: "PostgreSQL",
  minio: "MinIO",
  clamav: "ClamAV",
  alloy: "Alloy",
  tempo: "Tempo",
  prometheus: "Prometheus",
  loki: "Loki",
  grafana: "Grafana",
  alertmanager: "Alertmanager",
};
const SAFE_ALERT_SERVICES = new Set(["host", "smoke", "tahili-app", "tempo", "tracing", "tahili-frontend", "docker", "blackbox", "postgres", "alloy"]);

function unavailable(): MonitoringState { return "unavailable"; }
function stateFromBoolean(value: boolean | null): MonitoringState { return value === null ? unavailable() : value ? "healthy" : "attention"; }
function numberValue(payload: PromResult): number | null {
  const raw = payload?.data?.result?.[0]?.value?.[1];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
function boundedNumber(value: number | null, max = 1_000_000): number | null {
  return value === null || value < 0 || value > max ? null : Math.round(value * 100) / 100;
}

async function fetchBoundedText(url: string, fetcher: FetchLike = fetch): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("monitoring response unavailable");
    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > RESPONSE_LIMIT_BYTES) throw new Error("monitoring response too large");
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > RESPONSE_LIMIT_BYTES) throw new Error("monitoring response too large");
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBoundedJson(url: string, fetcher: FetchLike = fetch): Promise<unknown> {
  return JSON.parse(await fetchBoundedText(url, fetcher));
}

async function fetchHealthy(url: string, fetcher: FetchLike): Promise<boolean> {
  await fetchBoundedText(url, fetcher);
  return true;
}

async function prom(query: string, fetcher: FetchLike): Promise<PromResult> {
  return fetchBoundedJson(`${INTERNAL.prometheus}/api/v1/query?query=${encodeURIComponent(query)}`, fetcher) as Promise<PromResult>;
}

function targetStates(payload: PromResult): Map<string, boolean> {
  const result = payload?.data?.result ?? [];
  const byJob = new Map<string, boolean>();
  for (const sample of result) {
    const job = sample.metric?.job;
    const value = Number(sample.value?.[1]);
    if (job && Number.isFinite(value)) byJob.set(job, value === 1);
  }
  return byJob;
}

function safeAlerts(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : [];
  let critical = 0;
  let warning = 0;
  const services = new Set<string>();
  for (const row of rows.slice(0, 100)) {
    if (!row || typeof row !== "object") continue;
    const labels = (row as { labels?: unknown }).labels;
    if (!labels || typeof labels !== "object") continue;
    const severity = (labels as Record<string, unknown>).severity;
    const service = (labels as Record<string, unknown>).service;
    if (severity === "critical") critical += 1;
    if (severity === "warning") warning += 1;
    if (typeof service === "string" && SAFE_ALERT_SERVICES.has(service)) services.add(service);
  }
  return { total: critical + warning, critical, warning, services: [...services].sort() };
}

function serviceState(job: string, targets: Map<string, boolean>, direct: boolean | null): MonitoringState {
  if (direct !== null) return stateFromBoolean(direct);
  return stateFromBoolean(targets.get(job) ?? null);
}

export async function getObservabilitySummary(fetcher: FetchLike = fetch): Promise<ObservabilitySummary> {
  const entries = Object.entries(OBSERVABILITY_QUERIES);
  const [promisedQueries, alerts, alertmanager, tempo, loki] = await Promise.all([
    Promise.allSettled(entries.map(([, query]) => prom(query, fetcher))),
    fetchBoundedJson(`${INTERNAL.alertmanager}/api/v2/alerts`, fetcher),
    fetchHealthy(`${INTERNAL.alertmanager}/-/healthy`, fetcher).catch(() => false),
    fetchHealthy(`${INTERNAL.tempo}/ready`, fetcher).catch(() => false),
    fetchHealthy(`${INTERNAL.loki}/ready`, fetcher).catch(() => false),
  ].map(async (request) => {
    try { return await request; } catch { return null; }
  }));

  const queryResult = new Map<string, PromResult | null>();
  for (let index = 0; index < entries.length; index += 1) {
    const settled = (promisedQueries as PromiseSettledResult<PromResult>[] | null)?.[index];
    queryResult.set(entries[index][0], settled?.status === "fulfilled" ? settled.value : null);
  }
  const value = (key: keyof typeof OBSERVABILITY_QUERIES) => boundedNumber(numberValue(queryResult.get(key) ?? {}));
  const targets = targetStates(queryResult.get("targets") ?? {});
  const alertSummary = safeAlerts(alerts);
  const smokeSuccess = value("smokeSuccess");
  const smokeAge = value("smokeLastRun");
  const smokeState = smokeSuccess === null || smokeAge === null ? unavailable() : smokeSuccess === 1 && smokeAge < 4_500 ? "healthy" : "attention";
  const serviceSources: Array<{ key: keyof typeof SERVICE_LABELS; job: string; direct: boolean | null }> = [
    { key: "app", job: "blackbox", direct: value("appHealth") === null ? null : value("appHealth") === 1 }, { key: "postgres", job: "postgres", direct: value("postgresHealth") === null ? null : value("postgresHealth") === 1 }, { key: "minio", job: "blackbox", direct: value("minioHealth") === null ? null : value("minioHealth") === 1 }, { key: "clamav", job: "blackbox-tcp", direct: value("clamavHealth") === null ? null : value("clamavHealth") === 1 },
    { key: "alloy", job: "alloy", direct: value("alloyHealth") === null ? null : value("alloyHealth") === 1 }, { key: "tempo", job: "tempo", direct: tempo as boolean | null }, { key: "prometheus", job: "prometheus", direct: true }, { key: "loki", job: "loki", direct: loki as boolean | null },
    { key: "grafana", job: "grafana", direct: null }, { key: "alertmanager", job: "alertmanager", direct: alertmanager as boolean | null },
  ];
  const services = serviceSources.map(({ key, job, direct }) => ({ key, label: SERVICE_LABELS[key], state: serviceState(job, targets, direct) }));
  const metricsUnavailable = entries.some(([key]) => queryResult.get(key) === null);
  const state: MonitoringState = metricsUnavailable ? "unavailable" : alertSummary.critical > 0 || services.some((item) => item.state === "attention") ? "attention" : "healthy";

  return {
    state,
    refreshedAt: new Date().toISOString(),
    services,
    alerts: { ...alertSummary, state: alertSummary.total ? "attention" : "healthy" },
    smoke: { state: smokeState, lastRunSecondsAgo: smokeAge, durationSeconds: value("smokeDuration") },
    resources: { cpuPercent: value("cpu"), memoryPercent: value("memory"), diskPercent: value("disk") },
    faro: { enabled: value("faroEnabled") === null ? null : value("faroEnabled") === 1, errorsPerMinute: value("faroErrors"), lcpP95Ms: value("faroLcp"), forwardFailures: value("faroForwardFailures") },
    tracing: { enabled: value("otelEnabled") === null ? null : value("otelEnabled") === 1, tracesPerMinute: value("tracesRate"), latencyP95Ms: value("latencyP95"), server5xxPercent: value("server5xx"), exportFailures: value("exportFailures") },
  };
}
