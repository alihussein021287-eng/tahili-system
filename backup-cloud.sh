#!/bin/bash
# رفع النسخ الاحتياطية المحلية إلى تخزين سحابي عبر rclone
# يُشغّل بعد backup.sh (الذي ينشئ النسخ في /tahili-system/backups)
set -e

DIR=/tahili-system/backups
RCLONE_REMOTE="${RCLONE_REMOTE:-tahili-backup:tahili}"   # غيّرها لاسم ريموت rclone عندك، مثل: gdrive:tahili
RETENTION_DAYS=14

if ! command -v rclone >/dev/null 2>&1; then
  echo "[!] rclone غير منصّب. للتنصيب:  curl https://rclone.org/install.sh | sudo bash"
  exit 1
fi

# ارفع كل النسخ (.gz) — rclone يتخطّى المرفوع مسبقاً
rclone copy "$DIR" "$RCLONE_REMOTE" --include "*.gz" --transfers 2 --quiet
# احذف النسخ السحابية الأقدم من المدة المحددة
rclone delete "$RCLONE_REMOTE" --min-age "${RETENTION_DAYS}d" --quiet || true

echo "[✓] تمت المزامنة السحابية: $(date '+%Y-%m-%d %H:%M')"
