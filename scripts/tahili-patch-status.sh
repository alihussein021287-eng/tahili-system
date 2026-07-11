#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

line() { printf '\n%s\n' "============================================================"; }

line
echo "Tahili patch status"
echo "Project: $ROOT_DIR"
date

line
echo "Patch log"
if [ -f PATCHLOG.md ]; then
  ls -lh PATCHLOG.md
  grep -n '^### Patch' PATCHLOG.md || true
else
  echo "PATCHLOG.md not found"
fi

line
echo "Important changed/prepared files"
for f in \
  .dockerignore \
  public/sw.js \
  next.config.mjs \
  docker-compose.secure-ports.yml \
  scripts/tahili-safe-check.sh \
  scripts/tahili-build-check.sh \
  scripts/tahili-clean-build-check-images.sh \
  scripts/tahili-patch-status.sh
do
  if [ -e "$f" ]; then
    ls -lh "$f"
  else
    echo "Missing: $f"
  fi
done

line
echo "Patch backups under /root/tahili-patch-backups"
if [ -d /root/tahili-patch-backups ]; then
  find /root/tahili-patch-backups -maxdepth 2 -type f | sort | tail -80
else
  echo "No /root/tahili-patch-backups directory found"
fi

line
echo "Source files touched by security patches"
for f in \
  "src/app/(app)/patients/page.tsx" \
  "src/app/(app)/patients/[id]/page.tsx" \
  "src/app/(app)/appointments/page.tsx" \
  "src/app/(app)/reports/page.tsx" \
  "src/app/api/export/patients/route.ts" \
  "src/app/api/export/full/route.ts" \
  "src/app/api/files/[...key]/route.ts" \
  "src/app/api/backup-download/route.ts" \
  "src/app/api/backup/export/route.ts" \
  "src/app/api/backup/import/route.ts" \
  "src/app/api/queue/today/route.ts" \
  "src/app/api/reminders/due/route.ts"
do
  if [ -f "$f" ]; then
    printf '\n--- %s ---\n' "$f"
    grep -nE 'requirePerm|loadPerms|NO_STORE_HEADERS|Cache-Control|force-dynamic|patients.export|patients.view|appointments.view|queue.view|x-reminder-key|Bearer' "$f" || true
  else
    echo "Missing: $f"
  fi
done

line
echo "Docker image summary"
docker images | grep -E 'tahili-system-app|postgres|minio' || true

line
echo "Running containers"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" || true

line
echo "Disk usage"
df -h . /var/lib/docker 2>/dev/null || df -h .

line
echo "Patch status finished. Read-only script; no changes were made."
