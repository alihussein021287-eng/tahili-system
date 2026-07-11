#!/usr/bin/env bash
set -Eeuo pipefail

line() { printf '\n%s\n' "============================================================"; }
ok() { printf '✅ %s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*"; }

line
echo "Tahili build-check image cleaner"
echo "This removes ONLY images matching:"
echo "tahili-system-app:build-check-*"
date

line
echo "Running containers will NOT be touched"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" || true

line
echo "Build-check images found"
mapfile -t IMAGES < <(docker images --format '{{.Repository}}:{{.Tag}}' --filter=reference='tahili-system-app:build-check-*' | sort -u)

if [ "${#IMAGES[@]}" -eq 0 ]; then
  ok "No build-check images found."
  exit 0
fi

printf '%s\n' "${IMAGES[@]}"

line
if [ "${CONFIRM_DELETE:-0}" != "1" ]; then
  warn "Dry run only. Nothing was deleted."
  echo "To delete these images, run:"
  echo "CONFIRM_DELETE=1 ./scripts/tahili-clean-build-check-images.sh"
  exit 0
fi

for img in "${IMAGES[@]}"; do
  echo "Removing $img"
  docker rmi "$img" || warn "Could not remove $img"
done

line
ok "Cleanup finished."
