#!/usr/bin/env bash
# Read-only development diagnostics. It deliberately excludes environment files and patient data.
set -euo pipefail
umask 077

SINCE=10m
REQUEST_ID=
ERROR_ID=
OUTPUT=
CREATE=0
MAX_BYTES=$((20 * 1024 * 1024))
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIAGNOSTICS="$ROOT/test-results/diagnostics"

usage() { printf '%s\n' "Usage: $0 [--dry-run] [--create] [--since 10m] [--request-id UUID] [--error-id UUID] [--output /tmp/name.tar.gz]"; }
valid_id() { [[ -z "$1" || "$1" =~ ^[0-9a-fA-F-]{36}$ ]]; }
valid_since() { [[ "$1" =~ ^[1-9][0-9]*[smhd]$ ]]; }
safe_output() { [[ "$1" == /tmp/* || "$1" == "$DIAGNOSTICS"/* ]]; }

while (($#)); do
  case "$1" in
    --dry-run) CREATE=0 ;;
    --create) CREATE=1 ;;
    --since) SINCE="${2:-}"; shift ;;
    --request-id) REQUEST_ID="${2:-}"; shift ;;
    --error-id) ERROR_ID="${2:-}"; shift ;;
    --output) OUTPUT="${2:-}"; shift ;;
    --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

valid_since "$SINCE" || { printf '%s\n' 'Invalid --since' >&2; exit 2; }
valid_id "$REQUEST_ID" && valid_id "$ERROR_ID" || { printf '%s\n' 'IDs must be UUIDs' >&2; exit 2; }
[[ -n "$OUTPUT" ]] || OUTPUT="$DIAGNOSTICS/tahili-debug-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
safe_output "$OUTPUT" || { printf '%s\n' 'Output must be under /tmp or test-results/diagnostics' >&2; exit 2; }

if ((CREATE == 0)); then
  printf 'mode=dry-run since=%s sections=manifest,git,image,services,resources,migrations,probes,alerts,logs,smoke,frontend-observability,tempo,alloy-traces,versions\n' "$SINCE"
  printf '%s\n' 'files=manifest.json git.txt image.txt services.txt resources.txt migrations.txt probes.txt alerts.json redacted-logs.jsonl smoke-summary.json frontend-observability-summary.json tempo-summary.json alloy-trace-summary.json versions.txt'
  printf '%s\n' 'excludes=.env credentials cookies tokens ssh-keys db-dumps uploads minio-objects patient-data request-bodies'
  exit 0
fi

mkdir -p "$DIAGNOSTICS"
WORK="$(mktemp -d /tmp/tahili-debug-bundle.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
redact() { sed -E -e 's/((password|cookie|authorization|token|secret|api[_-]?key)[[:space:]]*[:=][[:space:]]*)[^,[:space:]]+/\1[REDACTED]/Ig' -e 's/(postgres(ql)?:\/\/)[^[:space:]]+/\1[REDACTED]/Ig' -e 's/(AKIA[0-9A-Z]{16})/[REDACTED]/g'; }
allowed='["timestamp","level","environment","service","release","route","method","status","durationMs","requestId","traceId","role","actionCategory","errorCode","eventType","errorId","reportRequestId","fingerprint"]'
filter='.'
if [[ -n "$REQUEST_ID" || -n "$ERROR_ID" ]]; then filter="select((\"$REQUEST_ID\" == \"\" or .requestId == \"$REQUEST_ID\" or .reportRequestId == \"$REQUEST_ID\") and (\"$ERROR_ID\" == \"\" or .errorId == \"$ERROR_ID\"))"; fi

git -C "$ROOT" rev-parse HEAD > "$WORK/git.txt"
git -C "$ROOT" status --short --branch | redact >> "$WORK/git.txt"
docker image inspect tahili-system-app:latest --format 'id={{.Id}} revision={{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null | redact > "$WORK/image.txt" || true
docker compose -C "$ROOT" ps --format json 2>/dev/null | redact > "$WORK/services.txt" || true
docker inspect --format '{{.Name}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}} image={{.Image}}' tahili_app tahili_db tahili_storage tahili_clamav 2>/dev/null | redact >> "$WORK/services.txt" || true
{ uptime; free -h; df -h "$ROOT"; df -i "$ROOT"; } | redact > "$WORK/resources.txt"
(cd "$ROOT" && docker compose exec -T app npx prisma migrate status 2>&1 || true) | redact > "$WORK/migrations.txt"
{ printf 'login='; curl -fsS -o /dev/null -w '%{http_code}\n' http://192.168.17.20:3000/login || true; printf 'readiness='; curl -sS -o /dev/null -w '%{http_code}\n' http://192.168.17.20:3000/readiness || true; } > "$WORK/probes.txt"
docker exec tahili_alertmanager wget -qO- http://localhost:9093/api/v2/alerts 2>/dev/null | jq '[.[] | {status:.status.state,labels:{alertname:.labels.alertname,severity:.labels.severity,service:.labels.service,environment:.labels.environment},startsAt,endsAt,summary:.annotations.summary}]' | redact > "$WORK/alerts.json" || printf '[]\n' > "$WORK/alerts.json"
docker logs --since "$SINCE" --tail 1200 tahili_app 2>&1 | tail -c 2097152 | jq -R --argjson allowed "$allowed" "$filter | with_entries(select(.key as \$key | \$allowed | index(\$key)))" 2>/dev/null | redact > "$WORK/redacted-logs.jsonl" || : > "$WORK/redacted-logs.jsonl"
jq '{runId,success,durationSeconds,checks,countsMatch}' /var/lib/tahili-smoke/latest-summary.json 2>/dev/null | redact > "$WORK/smoke-summary.json" || printf '{}\n' > "$WORK/smoke-summary.json"
docker exec tahili_app node -e 'const hold=setTimeout(()=>{process.exitCode=1},5000);(async()=>{const t=await (await fetch("http://alloy:12345/metrics")).text();const keys=["faro_receiver_events_total","faro_receiver_logs_total","faro_receiver_measurements_total","loki_write_sent_entries_total","loki_write_dropped_entries_total","loki_write_batch_retries_total"];const out={};for(const key of keys)out[key]=[...t.matchAll(new RegExp("^"+key+"(?:\\\\{[^}]*\\\\})? ([0-9.e+-]+)$","gm"))].reduce((sum,m)=>sum+Number(m[1]),0);console.log(JSON.stringify(out))})().then(()=>clearTimeout(hold),()=>{clearTimeout(hold);process.exitCode=1})' 2>/dev/null | redact > "$WORK/frontend-observability-summary.json" || printf '{}\n' > "$WORK/frontend-observability-summary.json"
docker exec tahili_app node -e 'const hold=setTimeout(()=>{process.exitCode=1},5000);(async()=>{const t=await (await fetch("http://app:3000/api/observability/faro/metrics")).text();const keys=["tahili_faro_enabled","tahili_faro_adapter_requests_total","tahili_faro_accepted_envelopes_total","tahili_faro_forwarded_envelopes_total","tahili_faro_last_accepted_timestamp_seconds","tahili_faro_last_forwarded_timestamp_seconds"];const out={};for(const key of keys)out[key]=[...t.matchAll(new RegExp("^"+key+"(?:\\\\{[^}]*\\\\})? ([0-9.e+-]+)$","gm"))].reduce((sum,m)=>sum+Number(m[1]),0);console.log(JSON.stringify(out))})().then(()=>clearTimeout(hold),()=>{clearTimeout(hold);process.exitCode=1})' 2>/dev/null > "$WORK/frontend-observability-adapter.json" || printf '{}\n' > "$WORK/frontend-observability-adapter.json"
if jq -s '.[0] * {adapter: .[1]}' "$WORK/frontend-observability-summary.json" "$WORK/frontend-observability-adapter.json" | redact > "$WORK/frontend-observability-summary.tmp"; then
  mv "$WORK/frontend-observability-summary.tmp" "$WORK/frontend-observability-summary.json"
else
  printf '{}\n' > "$WORK/frontend-observability-summary.json"
fi
rm -f -- "$WORK/frontend-observability-summary.tmp" "$WORK/frontend-observability-adapter.json"
docker inspect --format '{"status":"{{.State.Status}}","health":"{{if .State.Health}}{{.State.Health.Status}}{{end}}","restarts":{{.RestartCount}}}' tahili_tempo 2>/dev/null > "$WORK/tempo-summary.json" || printf '{}\n' > "$WORK/tempo-summary.json"
docker exec tahili_app node -e 'const hold=setTimeout(()=>{process.exitCode=1},5000);(async()=>{const t=await (await fetch("http://tempo:3200/metrics")).text();const keys=["tempo_distributor_spans_received_total","tempo_distributor_bytes_received_total","tempo_ingester_traces_created_total","tempo_ingester_live_traces"];const out={};for(const key of keys)out[key]=[...t.matchAll(new RegExp("^"+key+"(?:\\\\{[^}]*\\\\})? ([0-9.e+-]+)$","gm"))].reduce((sum,m)=>sum+Number(m[1]),0);console.log(JSON.stringify(out))})().then(()=>clearTimeout(hold),()=>{clearTimeout(hold);process.exitCode=1})' 2>/dev/null > "$WORK/tempo-metrics.json" || printf '{}\n' > "$WORK/tempo-metrics.json"
if jq -s '.[0] * {metrics: .[1]}' "$WORK/tempo-summary.json" "$WORK/tempo-metrics.json" | redact > "$WORK/tempo-summary.tmp"; then
  mv "$WORK/tempo-summary.tmp" "$WORK/tempo-summary.json"
else
  printf '{}\n' > "$WORK/tempo-summary.json"
fi
rm -f -- "$WORK/tempo-summary.tmp" "$WORK/tempo-metrics.json"
docker exec tahili_app node -e 'const hold=setTimeout(()=>{process.exitCode=1},5000);(async()=>{const t=await (await fetch("http://alloy:12345/metrics")).text();const keys=["otelcol_receiver_accepted_spans_total","otelcol_exporter_sent_spans_total","otelcol_exporter_send_failed_spans_total","otelcol_processor_dropped_spans_total"];const out={};for(const key of keys)out[key]=[...t.matchAll(new RegExp("^"+key+"(?:\\\\{[^}]*\\\\})? ([0-9.e+-]+)$","gm"))].reduce((sum,m)=>sum+Number(m[1]),0);console.log(JSON.stringify(out))})().then(()=>clearTimeout(hold),()=>{clearTimeout(hold);process.exitCode=1})' 2>/dev/null | redact > "$WORK/alloy-trace-summary.json" || printf '{}\n' > "$WORK/alloy-trace-summary.json"
{ node --version; npm --version; docker --version; docker compose version; (cd "$ROOT" && npx prisma --version | head -4); } | redact > "$WORK/versions.txt"
printf '{"generatedAt":"%s","since":"%s","sections":["manifest","git","image","services","resources","migrations","probes","alerts","logs","smoke","frontend-observability","tempo","alloy-traces","versions"],"requestIdIncluded":%s,"errorIdIncluded":%s,"redaction":"allowlisted structured fields only"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SINCE" "$([[ -n "$REQUEST_ID" ]] && echo true || echo false)" "$([[ -n "$ERROR_ID" ]] && echo true || echo false)" > "$WORK/manifest.json"

forbidden='(^|/)(\.env|.*credential.*|.*token.*|.*cookie.*|.*ssh.*|.*upload.*|.*dump.*|.*sql)$'
find "$WORK" -type f -printf '%f\n' | rg -i "$forbidden" >/dev/null && { printf '%s\n' 'Unsafe bundle path detected' >&2; exit 1; } || true
rg -n -i '(authorization:|set-cookie:|password[=:]|postgres(ql)?://|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY)' "$WORK" >/dev/null && { printf '%s\n' 'Secret scanner rejected bundle' >&2; exit 1; } || true
tar -C "$WORK" -czf "$OUTPUT" .
chmod 600 "$OUTPUT"
size=$(stat -c '%s' "$OUTPUT")
((size <= MAX_BYTES)) || { printf '%s\n' 'Bundle exceeds size limit' >&2; exit 1; }
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
chmod 600 "$OUTPUT.sha256"
tar -tzf "$OUTPUT" | rg -i "$forbidden" >/dev/null && { printf '%s\n' 'Archive path scanner rejected bundle' >&2; exit 1; } || true
tar -xOzf "$OUTPUT" | rg -n -i '(authorization:|set-cookie:|password[=:]|postgres(ql)?://|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY)' >/dev/null && { printf '%s\n' 'Archive secret scanner rejected bundle' >&2; exit 1; } || true
find "$DIAGNOSTICS" -maxdepth 1 -type f -name 'tahili-debug-*.tar.gz' -mtime +7 -print0 | while IFS= read -r -d '' old; do rm -f -- "$old" "${old}.sha256"; done
printf 'bundle=%s bytes=%s checksum=%s\n' "$OUTPUT" "$size" "${OUTPUT}.sha256"
