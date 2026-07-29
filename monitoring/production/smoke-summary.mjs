const METRICS = [
  "tahili_smoke_success",
  "tahili_smoke_last_run_timestamp",
  "tahili_smoke_duration_seconds",
  "tahili_smoke_failed_checks",
  "tahili_smoke_passed_checks",
  "tahili_smoke_total_checks",
];

function metricValue(source, name) {
  const match = source.match(new RegExp(`^${name} ([0-9]+(?:\\.[0-9]+)?)$`, "m"));
  return match ? Number(match[1]) : null;
}

export function parseSmokeSummary(source, nowSeconds = Date.now() / 1000) {
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > 16 * 1024) return null;
  const values = Object.fromEntries(METRICS.map((name) => [name, metricValue(source, name)]));
  if (Object.values(values).some((value) => value === null || !Number.isFinite(value))) return null;

  const success = values.tahili_smoke_success;
  const timestampSeconds = values.tahili_smoke_last_run_timestamp;
  const durationSeconds = values.tahili_smoke_duration_seconds;
  const failedChecks = values.tahili_smoke_failed_checks;
  const passedChecks = values.tahili_smoke_passed_checks;
  const totalChecks = values.tahili_smoke_total_checks;
  if (
    (success !== 0 && success !== 1)
    || timestampSeconds < 1
    || timestampSeconds > nowSeconds + 300
    || durationSeconds < 0
    || durationSeconds > 3_600
    || ![failedChecks, passedChecks, totalChecks].every(Number.isInteger)
    || failedChecks < 0
    || passedChecks < 0
    || totalChecks < 1
    || totalChecks > 100
    || passedChecks + failedChecks !== totalChecks
  ) return null;

  return { success: success === 1, timestampSeconds, durationSeconds, failedChecks, passedChecks, totalChecks };
}
