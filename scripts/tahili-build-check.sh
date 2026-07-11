#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG="${TAG:-tahili-system-app:build-check-$(date +%Y%m%d_%H%M%S)}"

line() { printf '\n%s\n' "============================================================"; }
ok() { printf '✅ %s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*"; }

line
echo "Tahili Docker build check"
echo "Project: $ROOT_DIR"
echo "Tag:     $TAG"
date

line
echo "Safety notice"
echo "- This script builds a new image only."
echo "- It does NOT stop the running containers."
echo "- It does NOT run migrations."
echo "- It does NOT restart docker compose."
echo "- It does NOT replace tahili_app."

line
echo "Current running containers before build"
docker compose ps || true

line
echo "Starting isolated docker build"
docker build --pull=false -t "$TAG" .

line
ok "Build completed successfully: $TAG"

line
echo "Current running containers after build"
docker compose ps || true

line
ok "Build check finished. Running app was not restarted."
