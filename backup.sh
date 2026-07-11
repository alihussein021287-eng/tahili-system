#!/usr/bin/env bash
set -euo pipefail
cd /tahili-system
set -a; source .env 2>/dev/null || true; set +a
mkdir -p backups
DATE=$(date +%Y%m%d-%H%M%S)
DB_FILE="backups/db-$DATE.sql.gz"
UPLOADS_FILE="backups/uploads-$DATE.tar.gz"
DB_TMP="$DB_FILE.tmp"
UPLOADS_TMP="$UPLOADS_FILE.tmp"
trap 'rm -f "$DB_TMP" "$UPLOADS_TMP"' EXIT

# قاعدة البيانات
docker compose exec -T postgres pg_dump --clean --if-exists --no-owner --no-privileges -U "${DB_USER:-tahili}" "${DB_NAME:-tahili}" | gzip > "$DB_TMP"
mv "$DB_TMP" "$DB_FILE"

# ملفات الصور والمرفقات (من volume الدائم)
docker compose exec -T app tar czf - -C /app/uploads . > "$UPLOADS_TMP" 2>/dev/null || true
if [ -s "$UPLOADS_TMP" ]; then
  mv "$UPLOADS_TMP" "$UPLOADS_FILE"
  UPLOADS_STATUS=" + uploads-$DATE.tar.gz"
else
  UPLOADS_STATUS=" (uploads skipped)"
fi

# الاحتفاظ بآخر 14 يوم فقط
find backups -name 'db-*.sql.gz'      -mtime +14 -delete
find backups -name 'uploads-*.tar.gz' -mtime +14 -delete

echo "[$(date)] backup OK: db-$DATE.sql.gz$UPLOADS_STATUS"
