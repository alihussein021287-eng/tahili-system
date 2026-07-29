export type MonitoringState = "healthy" | "attention" | "waiting" | "security_na" | "unavailable";

export type MetricReading = {
  value: number | null;
  state: MonitoringState;
};

export type BooleanReading = {
  value: boolean | null;
  state: MonitoringState;
};

export type ObservabilitySummary = {
  state: MonitoringState;
  refreshedAt: string;
  services: Array<{ key: string; label: string; state: MonitoringState; detail?: string }>;
  alerts: { total: number | null; critical: number | null; warning: number | null; services: string[]; state: MonitoringState };
  smoke: {
    state: MonitoringState;
    passedChecks: number | null;
    totalChecks: number | null;
    lastRunAt: string | null;
    durationSeconds: number | null;
  };
  resources: { cpu: MetricReading; memory: MetricReading; disk: MetricReading };
  faro: {
    enabled: BooleanReading;
    automaticTelemetryExpected: BooleanReading;
    signals: MetricReading;
    errorsPerMinute: MetricReading;
    lcpP95Ms: MetricReading;
    forwardFailures: MetricReading;
  };
  tracing: {
    enabled: BooleanReading;
    tracesPerMinute: MetricReading;
    latencyP95Ms: MetricReading;
    server5xxPercent: MetricReading;
    exportFailures: MetricReading;
  };
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PromResult = { status?: string; data?: { result?: Array<{ metric?: Record<string, string>; value?: [number, string] }> } };
type SmokePayload = {
  success?: unknown;
  timestampSeconds?: unknown;
  durationSeconds?: unknown;
  failedChecks?: unknown;
  passedChecks?: unknown;
  totalChecks?: unknown;
};

const RESPONSE_LIMIT_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 1_500;
const SMOKE_STALE_SECONDS = 4_500;

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
  alloyHealth: "up{job=\"alloy\"}",
  faroEnabled: "tahili_faro_enabled",
  faroTelemetryExpected: "tahili_faro_telemetry_expected",
  faroSignals: "sum(tahili_faro_accepted_envelopes_total)",
  faroErrors: "sum(rate(tahili_faro_frontend_logs_total{level=\"error\"}[5m])) * 60",
  faroLcpSamples: "sum(increase(tahili_faro_lcp_milliseconds_count[10m]))",
  faroLcp: "histogram_quantile(0.95, sum by (le) (rate(tahili_faro_lcp_milliseconds_bucket[10m])))",
  faroForwardFailures: "sum(tahili_faro_forward_failures_total)",
  otelEnabled: "tahili_otel_enabled",
  traceSamples: "sum(increase(tahili_server_calls_total[10m]))",
  tracesRate: "sum(rate(tahili_server_calls_total[5m])) * 60",
  latencyP95: "histogram_quantile(0.95, sum by (le) (rate(tahili_server_duration_milliseconds_bucket[10m])))",
  server5xx: "100 * (sum(rate(tahili_server_calls_total{tahili_status_class=\"5xx\"}[5m])) or vector(0)) / clamp_min(sum(rate(tahili_server_calls_total[5m])), 0.001)",
  exportFailures: "(sum(otelcol_exporter_send_failed_spans_total) or vector(0)) + (sum(tahili_otel_export_failures_total) or vector(0))",
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

function parseSmokePayload(payload: unknown, nowSeconds = Date.now() / 1000) {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as SmokePayload;
  const timestampSeconds = Number(value.timestampSeconds);
  const durationSeconds = Number(value.durationSeconds);
  const passedChecks = Number(value.passedChecks);
  const totalChecks = Number(value.totalChecks);
  const failedChecks = Number(value.failedChecks);
  if (
    typeof value.success !== "boolean"
    || !Number.isFinite(timestampSeconds)
    || timestampSeconds < 1
    || timestampSeconds > nowSeconds + 300
    || !Number.isFinite(durationSeconds)
    || durationSeconds < 0
    || durationSeconds > 3_600
    || ![passedChecks, totalChecks, failedChecks].every(Number.isInteger)
    || passedChecks < 0
    || failedChecks < 0
    || totalChecks < 1
    || totalChecks > 100
    || passedChecks + failedChecks !== totalChecks
  ) return null;
  return { success: value.success, timestampSeconds, durationSeconds, passedChecks, totalChecks };
}

function targetState(targetsPayload: PromResult | null, targets: Map<string, boolean>, job: string): MonitoringState {
  if (!targetsPayload || !targets.has(job)) return "unavailable";
  return targets.get(job) ? "healthy" : "attention";
}

function metricReading(
  key: keyof typeof OBSERVABILITY_QUERIES,
  queryResult: Map<string, PromResult | null>,
  emptyState: MonitoringState = "waiting",
): MetricReading {
  const payload = queryResult.get(key);
  if (!payload) return { value: null, state: "unavailable" };
  const value = boundedNumber(numberValue(payload));
  return value === null ? { value: null, state: emptyState } : { value, state: "healthy" };
}

function withAttention(reading: MetricReading, predicate: (value: number) => boolean): MetricReading {
  return reading.value !== null && predicate(reading.value) ? { ...reading, state: "attention" } : reading;
}

function waitingWithoutSamples(reading: MetricReading, samples: MetricReading): MetricReading {
  if (samples.state === "unavailable") return { value: null, state: "unavailable" };
  if (samples.value === null || samples.value <= 0) return { value: null, state: "waiting" };
  return reading;
}

function booleanReading(reading: MetricReading): BooleanReading {
  if (reading.value === null) return { value: null, state: reading.state === "waiting" ? "unavailable" : reading.state };
  return { value: reading.value === 1, state: reading.value === 1 ? "healthy" : "attention" };
}

function expectedTelemetryReading(reading: MetricReading): BooleanReading {
  if (reading.value === null) return { value: null, state: reading.state === "waiting" ? "unavailable" : reading.state };
  return { value: reading.value === 1, state: reading.value === 1 ? "healthy" : "security_na" };
}

export async function getObservabilitySummary(fetcher: FetchLike = fetch): Promise<ObservabilitySummary> {
  const entries = Object.entries(OBSERVABILITY_QUERIES);
  const [promisedQueries, alertsPayload, alertmanagerReady, tempoReady, lokiReady, smokePayload] = await Promise.all([
    Promise.allSettled(entries.map(([, query]) => prom(query, fetcher))),
    fetchBoundedJson(`${INTERNAL.alertmanager}/api/v2/alerts`, fetcher),
    fetchHealthy(`${INTERNAL.alertmanager}/-/healthy`, fetcher),
    fetchHealthy(`${INTERNAL.tempo}/ready`, fetcher),
    fetchHealthy(`${INTERNAL.loki}/ready`, fetcher),
    fetchBoundedJson(`${INTERNAL.prometheus}/api/v1/smoke-summary`, fetcher),
  ].map(async (request) => {
    try { return await request; } catch { return null; }
  }));

  const queryResult = new Map<string, PromResult | null>();
  for (let index = 0; index < entries.length; index += 1) {
    const settled = (promisedQueries as PromiseSettledResult<PromResult>[] | null)?.[index];
    queryResult.set(entries[index][0], settled?.status === "fulfilled" ? settled.value : null);
  }

  const targetsPayload = queryResult.get("targets") ?? null;
  const targets = targetStates(targetsPayload ?? {});
  const isolatedDetail = "غير مراقب مباشرة — عزل أمني";
  const services: ObservabilitySummary["services"] = [
    { key: "app", label: SERVICE_LABELS.app, state: "security_na", detail: isolatedDetail },
    { key: "postgres", label: SERVICE_LABELS.postgres, state: "security_na", detail: isolatedDetail },
    { key: "minio", label: SERVICE_LABELS.minio, state: "security_na", detail: isolatedDetail },
    { key: "clamav", label: SERVICE_LABELS.clamav, state: "security_na", detail: isolatedDetail },
    { key: "alloy", label: SERVICE_LABELS.alloy, state: booleanReading(metricReading("alloyHealth", queryResult, "unavailable")).state },
    { key: "tempo", label: SERVICE_LABELS.tempo, state: tempoReady === true ? "healthy" : "unavailable" },
    { key: "prometheus", label: SERVICE_LABELS.prometheus, state: targetsPayload ? "healthy" : "unavailable" },
    { key: "loki", label: SERVICE_LABELS.loki, state: lokiReady === true ? "healthy" : "unavailable" },
    { key: "grafana", label: SERVICE_LABELS.grafana, state: targetState(targetsPayload, targets, "grafana") },
    { key: "alertmanager", label: SERVICE_LABELS.alertmanager, state: alertmanagerReady === true ? "healthy" : "unavailable" },
  ];

  const alertSummary = alertsPayload === null ? null : safeAlerts(alertsPayload);
  const alerts: ObservabilitySummary["alerts"] = alertSummary
    ? { ...alertSummary, state: alertSummary.total > 0 ? "attention" : "healthy" }
    : { total: null, critical: null, warning: null, services: [], state: "unavailable" };

  const smokeValue = parseSmokePayload(smokePayload);
  const smokeAge = smokeValue ? Math.max(0, Date.now() / 1000 - smokeValue.timestampSeconds) : null;
  const smoke: ObservabilitySummary["smoke"] = smokeValue
    ? {
        state: smokeValue.success && smokeAge !== null && smokeAge < SMOKE_STALE_SECONDS ? "healthy" : "attention",
        passedChecks: smokeValue.passedChecks,
        totalChecks: smokeValue.totalChecks,
        lastRunAt: new Date(smokeValue.timestampSeconds * 1000).toISOString(),
        durationSeconds: boundedNumber(smokeValue.durationSeconds, 3_600),
      }
    : { state: "unavailable", passedChecks: null, totalChecks: null, lastRunAt: null, durationSeconds: null };

  const faroEnabled = booleanReading(metricReading("faroEnabled", queryResult, "unavailable"));
  const faroTelemetryExpected = expectedTelemetryReading(metricReading("faroTelemetryExpected", queryResult, "unavailable"));
  const faroSignals = metricReading("faroSignals", queryResult);
  const faroSignalsDisplay = faroSignals.value === 0 ? { value: null, state: "waiting" as const } : faroSignals;
  const faroLcpSamples = metricReading("faroLcpSamples", queryResult);
  const faroErrors = waitingWithoutSamples(metricReading("faroErrors", queryResult), faroSignals);
  const faroLcp = waitingWithoutSamples(metricReading("faroLcp", queryResult), faroLcpSamples);
  const faroFailures = withAttention(metricReading("faroForwardFailures", queryResult, "unavailable"), (value) => value > 0);

  const otelEnabled = booleanReading(metricReading("otelEnabled", queryResult, "unavailable"));
  const traceSamples = metricReading("traceSamples", queryResult);
  const tracesRate = waitingWithoutSamples(metricReading("tracesRate", queryResult), traceSamples);
  const latencyP95 = waitingWithoutSamples(metricReading("latencyP95", queryResult), traceSamples);
  const server5xx = withAttention(waitingWithoutSamples(metricReading("server5xx", queryResult), traceSamples), (value) => value > 5);
  const exportFailures = withAttention(metricReading("exportFailures", queryResult, "unavailable"), (value) => value > 0);

  const relevantStates = [
    ...services.map((service) => service.state),
    alerts.state,
    smoke.state,
    faroEnabled.state,
    faroTelemetryExpected.state,
    faroErrors.state,
    faroLcp.state,
    faroFailures.state,
    otelEnabled.state,
    tracesRate.state,
    latencyP95.state,
    server5xx.state,
    exportFailures.state,
  ];
  const state: MonitoringState = relevantStates.includes("unavailable")
    ? "unavailable"
    : relevantStates.includes("attention") ? "attention" : "healthy";

  return {
    state,
    refreshedAt: new Date().toISOString(),
    services,
    alerts,
    smoke,
    resources: {
      cpu: { value: null, state: "security_na" },
      memory: { value: null, state: "security_na" },
      disk: { value: null, state: "security_na" },
    },
    faro: {
      enabled: faroEnabled,
      automaticTelemetryExpected: faroTelemetryExpected,
      signals: faroSignalsDisplay,
      errorsPerMinute: withAttention(faroErrors, (value) => value > 0),
      lcpP95Ms: withAttention(faroLcp, (value) => value > 4_000),
      forwardFailures: faroFailures,
    },
    tracing: {
      enabled: otelEnabled,
      tracesPerMinute: tracesRate,
      latencyP95Ms: latencyP95,
      server5xxPercent: server5xx,
      exportFailures,
    },
  };
}
