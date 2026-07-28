#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/stage10-common.sh
source "$ROOT_DIR/scripts/lib/stage10-common.sh"
[[ $# -eq 1 ]] || stage10_die "usage: stage10-verify-backup.sh NAME" 2; name="$1"; stage10_name_ok "$name" || stage10_die "invalid backup name" 2; stage10_init
target="$(stage10_dir "$name")"; [[ -d "$target" && ! -L "$target" && "$(stat -c '%a' "$target")" = 700 ]] || stage10_die "backup unavailable" 3
for file in postgres.dump minio.tar.gz uploads.tar.gz manifest.json SHA256SUMS; do [[ -f "$target/$file" && ! -L "$target/$file" && "$(stat -c '%a' "$target/$file")" = 600 ]] || stage10_die "backup incomplete or unsafe" 65; done
(cd "$target" && sha256sum -c SHA256SUMS >/dev/null)
docker run --rm -v "$target:/backup:ro" --entrypoint sh "$(stage10_image)" -ceu 'pg_restore -l /backup/postgres.dump >/dev/null; tar -tzf /backup/minio.tar.gz >/dev/null; tar -tzf /backup/uploads.tar.gz >/dev/null'
jq -e '.format == 1 and (.schema.tables >= 0) and (.objects.minio.files >= 0) and (.objects.uploads.files >= 0)' "$target/manifest.json" >/dev/null
printf 'backup=%s status=verified\n' "$name"
