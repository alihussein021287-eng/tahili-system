#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_URL="${APP_URL:-http://localhost:3000}"

line() { printf '\n%s\n' "============================================================"; }
ok() { printf '✅ %s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*"; }

line
echo "Tahili safe read-only check"
echo "Project: $ROOT_DIR"
echo "URL:     $APP_URL"
date

line
echo "Docker compose status"
docker compose ps || warn "docker compose ps failed"

line
echo "Docker containers"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || warn "docker ps failed"

line
echo "HTTP check"
if curl -fsSI "$APP_URL" >/tmp/tahili_http_headers.txt 2>/tmp/tahili_http_error.txt; then
  sed -n '1,8p' /tmp/tahili_http_headers.txt
  ok "HTTP reachable"
else
  sed -n '1,8p' /tmp/tahili_http_error.txt || true
  warn "HTTP check failed"
fi

line
echo "Recent app warning/error lines (read-only)"
docker compose logs --tail=120 app 2>/dev/null | grep -Ei "error|fatal|failed|exception|traceback|prisma|denied|unauthorized" || ok "No obvious app errors in last 120 lines"

line
echo "Recent database warning/error lines (read-only)"
docker compose logs --tail=120 postgres 2>/dev/null | grep -Ei "error|fatal|failed|panic|corrupt" || ok "No obvious database errors in last 120 lines"

line
echo "Disk space"
df -h . /var/lib/docker 2>/dev/null || df -h .

line
echo "Memory snapshot"
free -h || true

line
echo "Important project files"
for f in docker-compose.yml Dockerfile package.json prisma/schema.prisma .dockerignore public/sw.js; do
  if [ -e "$f" ]; then
    ls -lh "$f"
  else
    warn "Missing: $f"
  fi
done

line
ok "Safe check finished. No restart/build/migration was executed."
