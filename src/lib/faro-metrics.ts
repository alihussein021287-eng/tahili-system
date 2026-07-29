import { FARO_TELEMETRY_EXPECTED } from "@/lib/faro-telemetry-policy";

export const FARO_REJECTION_REASONS = ["disabled", "method", "content_type", "malformed", "oversize", "origin", "rate_limit", "empty"] as const;
export const FARO_SIGNAL_KINDS = ["event", "log", "measurement"] as const;
export const FARO_LOG_LEVELS = ["debug", "info", "warn", "error", "log"] as const;

type RejectionReason = (typeof FARO_REJECTION_REASONS)[number];
type SignalKind = (typeof FARO_SIGNAL_KINDS)[number];
type LogLevel = (typeof FARO_LOG_LEVELS)[number];
type ForwardFailure = "failure" | "timeout";

const lcpBuckets = [100, 250, 500, 1000, 1500, 2500, 4000, 6000, 10000];
const processStart = Date.now() / 1000;
const counters = {
  requests: 0, accepted: 0, forwarded: 0,
  rejected: Object.fromEntries(FARO_REJECTION_REASONS.map((reason) => [reason, 0])) as Record<RejectionReason, number>,
  forwardFailures: { failure: 0, timeout: 0 } as Record<ForwardFailure, number>,
  signals: Object.fromEntries(FARO_SIGNAL_KINDS.map((kind) => [kind, 0])) as Record<SignalKind, number>,
  logs: Object.fromEntries(FARO_LOG_LEVELS.map((level) => [level, 0])) as Record<LogLevel, number>,
  lcpBuckets: Object.fromEntries(lcpBuckets.map((bucket) => [bucket, 0])) as Record<number, number>,
  lcpCount: 0, lcpSum: 0, lastAccepted: 0, lastForwarded: 0,
};

const line = (name: string, value: number, labels?: string) => `${name}${labels ? `{${labels}}` : ""} ${value}\n`;
const counter = (name: string, help: string) => `# HELP ${name} ${help}\n# TYPE ${name} counter\n`;
const gauge = (name: string, help: string) => `# HELP ${name} ${help}\n# TYPE ${name} gauge\n`;

export function recordFaroRequest() { counters.requests += 1; }
export function recordFaroRejected(reason: RejectionReason) { counters.rejected[reason] += 1; }
export function recordFaroAccepted(signals: { events: number; logs: Array<string>; measurements: Array<{ type: string; value: number }> }) {
  counters.accepted += 1; counters.lastAccepted = Date.now() / 1000;
  counters.signals.event += signals.events; counters.signals.log += signals.logs.length; counters.signals.measurement += signals.measurements.length;
  for (const level of signals.logs) if ((FARO_LOG_LEVELS as readonly string[]).includes(level)) counters.logs[level as LogLevel] += 1;
  for (const measurement of signals.measurements) if (measurement.type === "LCP" && Number.isFinite(measurement.value) && measurement.value >= 0) {
    counters.lcpCount += 1; counters.lcpSum += measurement.value;
    for (const bucket of lcpBuckets) if (measurement.value <= bucket) counters.lcpBuckets[bucket] += 1;
  }
}
export function recordFaroForwarded() { counters.forwarded += 1; counters.lastForwarded = Date.now() / 1000; }
export function recordFaroForwardFailure(reason: ForwardFailure) { counters.forwardFailures[reason] += 1; }

export function renderFaroMetrics(enabled: boolean) {
  let output = gauge("tahili_faro_enabled", "Faro adapter enabled by runtime configuration") + line("tahili_faro_enabled", enabled ? 1 : 0);
  output += gauge("tahili_faro_telemetry_expected", "Automatic periodic Faro telemetry expected from approved instrumentations") + line("tahili_faro_telemetry_expected", FARO_TELEMETRY_EXPECTED ? 1 : 0);
  output += counter("tahili_faro_adapter_requests_total", "Faro adapter requests") + line("tahili_faro_adapter_requests_total", counters.requests);
  output += counter("tahili_faro_accepted_envelopes_total", "Accepted sanitized Faro envelopes") + line("tahili_faro_accepted_envelopes_total", counters.accepted);
  output += counter("tahili_faro_forwarded_envelopes_total", "Faro envelopes forwarded to Alloy") + line("tahili_faro_forwarded_envelopes_total", counters.forwarded);
  output += counter("tahili_faro_rejected_total", "Rejected Faro envelopes by bounded reason"); for (const reason of FARO_REJECTION_REASONS) output += line("tahili_faro_rejected_total", counters.rejected[reason], `reason="${reason}"`);
  output += counter("tahili_faro_forward_failures_total", "Faro forwarding failures by bounded reason"); for (const reason of ["failure", "timeout"] as const) output += line("tahili_faro_forward_failures_total", counters.forwardFailures[reason], `reason="${reason}"`);
  output += counter("tahili_faro_signals_total", "Accepted Faro signals by bounded kind"); for (const kind of FARO_SIGNAL_KINDS) output += line("tahili_faro_signals_total", counters.signals[kind], `kind="${kind}"`);
  output += counter("tahili_faro_frontend_logs_total", "Accepted frontend logs by bounded level"); for (const level of FARO_LOG_LEVELS) output += line("tahili_faro_frontend_logs_total", counters.logs[level], `level="${level}"`);
  output += "# HELP tahili_faro_lcp_milliseconds Sanitized LCP values in milliseconds\n# TYPE tahili_faro_lcp_milliseconds histogram\n";
  for (const bucket of lcpBuckets) output += line("tahili_faro_lcp_milliseconds_bucket", counters.lcpBuckets[bucket], `le="${bucket}"`);
  output += line("tahili_faro_lcp_milliseconds_bucket", counters.lcpCount, 'le="+Inf"') + line("tahili_faro_lcp_milliseconds_sum", counters.lcpSum) + line("tahili_faro_lcp_milliseconds_count", counters.lcpCount);
  output += gauge("tahili_faro_last_accepted_timestamp_seconds", "Unix timestamp of last accepted Faro envelope") + line("tahili_faro_last_accepted_timestamp_seconds", counters.lastAccepted);
  output += gauge("tahili_faro_last_forwarded_timestamp_seconds", "Unix timestamp of last forwarded Faro envelope") + line("tahili_faro_last_forwarded_timestamp_seconds", counters.lastForwarded);
  output += gauge("tahili_faro_process_start_time_seconds", "Faro metric process start timestamp") + line("tahili_faro_process_start_time_seconds", processStart);
  return output;
}

export function resetFaroMetricsForTests() { for (const reason of FARO_REJECTION_REASONS) counters.rejected[reason] = 0; for (const kind of FARO_SIGNAL_KINDS) counters.signals[kind] = 0; for (const level of FARO_LOG_LEVELS) counters.logs[level] = 0; for (const bucket of lcpBuckets) counters.lcpBuckets[bucket] = 0; counters.requests = counters.accepted = counters.forwarded = counters.lcpCount = counters.lcpSum = counters.lastAccepted = counters.lastForwarded = 0; counters.forwardFailures.failure = counters.forwardFailures.timeout = 0; }
