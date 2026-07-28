#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR=/run/tahili
LOCK_FILE="$RUNTIME_DIR/readonly-smoke.lock"
STATE_FILE="$RUNTIME_DIR/readonly-smoke.state"
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf 'smoke_status=already_running\n'
  exit 75
fi
run_id="smoke-$(date -u +%Y%m%dT%H%M%SZ)-$$"
printf 'pid=%s run_id=%s\n' "$$" "$run_id" > "$STATE_FILE"
chmod 600 "$STATE_FILE"
cleanup() { rm -f -- "$STATE_FILE"; }
trap cleanup EXIT INT TERM
TAHILI_SMOKE_RUN_ID="$run_id" npx tsx scripts/run-readonly-smoke.ts
