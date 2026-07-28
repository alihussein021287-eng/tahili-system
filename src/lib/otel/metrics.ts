const processStart = Date.now() / 1000;
const counters = { attempted: 0, succeeded: 0, failed: 0, lastExport: 0, lastSuccess: 0 };

const line = (name: string, value: number) => `${name} ${value}\n`;

export function recordOtelExport(result: { code: number }) {
  counters.attempted += 1;
  counters.lastExport = Date.now() / 1000;
  if (result.code === 0) counters.succeeded += 1;
  else counters.failed += 1;
}

export function recordOtelExportSuccess() { counters.lastSuccess = Date.now() / 1000; }

export function renderOtelMetrics(enabled: boolean) {
  let output = "# HELP tahili_otel_enabled Server tracing enabled by runtime configuration\n# TYPE tahili_otel_enabled gauge\n" + line("tahili_otel_enabled", enabled ? 1 : 0);
  output += "# HELP tahili_otel_export_attempts_total Sanitized trace export attempts\n# TYPE tahili_otel_export_attempts_total counter\n" + line("tahili_otel_export_attempts_total", counters.attempted);
  output += "# HELP tahili_otel_export_failures_total Sanitized trace export failures\n# TYPE tahili_otel_export_failures_total counter\n" + line("tahili_otel_export_failures_total", counters.failed);
  output += "# HELP tahili_otel_last_export_timestamp_seconds Last sanitized trace export attempt\n# TYPE tahili_otel_last_export_timestamp_seconds gauge\n" + line("tahili_otel_last_export_timestamp_seconds", counters.lastExport);
  output += "# HELP tahili_otel_last_export_success_timestamp_seconds Last successful sanitized trace export\n# TYPE tahili_otel_last_export_success_timestamp_seconds gauge\n" + line("tahili_otel_last_export_success_timestamp_seconds", counters.lastSuccess);
  output += "# HELP tahili_otel_process_start_time_seconds OTEL metric process start timestamp\n# TYPE tahili_otel_process_start_time_seconds gauge\n" + line("tahili_otel_process_start_time_seconds", processStart);
  return output;
}

export function resetOtelMetricsForTests() { counters.attempted = counters.succeeded = counters.failed = counters.lastExport = counters.lastSuccess = 0; }
