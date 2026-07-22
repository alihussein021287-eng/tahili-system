#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_URL="${TAHILI_HEALTH_URL:-http://127.0.0.1:3000}"
APP_CONTAINER="${TAHILI_APP_CONTAINER:-tahili_app}"
DB_CONTAINER="${TAHILI_DB_CONTAINER:-tahili_db}"
MINIO_CONTAINER="${TAHILI_MINIO_CONTAINER:-tahili_storage}"
CLAMAV_CONTAINER="${TAHILI_CLAMAV_CONTAINER:-tahili_clamav}"

section() {
  printf '\n== %s ==\n' "$1"
}

run_readonly() {
  printf '+ %s\n' "$*"
  "$@"
  local status=$?
  if [ "$status" -ne 0 ]; then
    printf 'WARN: command exited with status %s\n' "$status"
  fi
  return 0
}

cd "$ROOT_DIR" || exit 1

section "Docker containers"
if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    run_readonly docker compose ps
  else
    run_readonly docker ps --filter "name=tahili" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
  fi
  for container in "$APP_CONTAINER" "$DB_CONTAINER" "$MINIO_CONTAINER" "$CLAMAV_CONTAINER"; do
    if docker inspect "$container" >/dev/null 2>&1; then
      run_readonly docker inspect -f '{{.Name}} {{.State.Status}} restarts={{.RestartCount}} image={{.Image}}' "$container"
    else
      printf 'WARN: container not found: %s\n' "$container"
    fi
  done
else
  printf 'WARN: docker command is unavailable\n'
fi

section "HTTP /login"
if command -v curl >/dev/null 2>&1; then
  status_code="$(curl -fsS -o /dev/null -w '%{http_code}' "${APP_URL%/}/login" 2>/dev/null || printf '000')"
  printf '/login status: %s\n' "$status_code"
else
  printf 'WARN: curl command is unavailable\n'
fi

section "Prisma migrations"
if command -v docker >/dev/null 2>&1 && docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    docker compose exec -T app npx prisma migrate status 2>&1 | sed -E 's#(postgresql://)[^ @]+#\1***#g'
  else
    printf 'WARN: docker compose is unavailable; cannot check migrations inside app\n'
  fi
else
  printf 'WARN: app container unavailable; cannot check migrations\n'
fi

section "Host resources"
run_readonly df -h /
if command -v free >/dev/null 2>&1; then
  run_readonly free -h
else
  printf 'WARN: free command is unavailable\n'
fi

section "Filtered app logs"
if command -v docker >/dev/null 2>&1 && docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  matches="$(docker logs --tail 250 "$APP_CONTAINER" 2>&1 | grep -Ei '(^|[^0-9])500([^0-9]|$)|Prisma|ERROR|FATAL' || true)"
  if [ -n "$matches" ]; then
    printf '%s\n' "$matches"
  else
    printf 'No 500/Prisma/ERROR/FATAL entries in last 250 app log lines.\n'
  fi
else
  printf 'WARN: app container unavailable; cannot read logs\n'
fi

section "Caddy"
if systemctl list-unit-files caddy.service >/dev/null 2>&1; then
  run_readonly systemctl is-active caddy
elif command -v docker >/dev/null 2>&1; then
  docker ps --filter "name=caddy" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
else
  printf 'WARN: Caddy status unavailable\n'
fi

printf '\nHealth check finished without making changes.\n'
