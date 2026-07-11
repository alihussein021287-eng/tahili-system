#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="${1:-$(date +%Y%m%d-%H%M%S)}"
OUT_DIR="${ROOT_DIR}/releases"
OUT_FILE="${OUT_DIR}/tahili-system-release-${STAMP}.tar.gz"

mkdir -p "${OUT_DIR}"

tar -czf "${OUT_FILE}" \
  -C "${ROOT_DIR}" \
  --exclude="./.env" \
  --exclude="./.env.local" \
  --exclude="./.env.development" \
  --exclude="./.env.development.local" \
  --exclude="./.env.production" \
  --exclude="./.env.production.local" \
  --exclude="./.env.test" \
  --exclude="./.env.test.local" \
  --exclude="./node_modules" \
  --exclude="./.next" \
  --exclude="./out" \
  --exclude="./dist" \
  --exclude="./build" \
  --exclude="./coverage" \
  --exclude="./backups" \
  --exclude="./uploads" \
  --exclude="./_images" \
  --exclude="./releases" \
  --exclude="./.git" \
  --exclude="./.agents" \
  --exclude="./.codex" \
  --exclude="./CLAUDE.md" \
  --exclude="./ROADMAP.md" \
  --exclude="./setup-ssl.sh" \
  --exclude="./deploy-commands-*.txt" \
  --exclude="./*.zip" \
  --exclude="./*.tar" \
  --exclude="./*.tar.gz" \
  --exclude="./*.tgz" \
  --exclude="./*.sql" \
  --exclude="./*.sql.gz" \
  --exclude="./*.backup" \
  --exclude="./*.dump" \
  --exclude="./*.bak" \
  --exclude="./*.bak_*" \
  --exclude="./*.tsbuildinfo" \
  --exclude="./logs" \
  --exclude="./*.log" \
  --exclude="./.DS_Store" \
  --exclude="./Thumbs.db" \
  .

echo "${OUT_FILE}"
