#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/stage10-common.sh
source "$ROOT_DIR/scripts/lib/stage10-common.sh"

[[ $# -le 1 && ( $# -eq 0 || "$1" = "--apply" ) ]] || stage10_die "usage: stage10-backup.sh [--apply]" 2
stage10_init
if [[ "${1:-}" != "--apply" ]]; then printf '%s\n' 'mode=dry-run root=/var/backups/tahili artifacts=postgres-custom,minio-tar,uploads-tar'; exit 0; fi
stage10_guard_disk
name="stage10-$(date -u +%Y%m%dT%H%M%SZ)-$$"; target="$(stage10_dir "$name")"; umask 077; install -d -m 700 "$target"
image="$(stage10_image)"; network="$(stage10_network)"; env_file="$(stage10_env)"
pg_volume="$(stage10_volume tahili_db /var/lib/postgresql/data)"; minio_volume="$(stage10_volume tahili_storage /data)"; uploads_volume="$(stage10_volume tahili_app /app/uploads)"
metrics="$(docker run --rm --network "$network" --env-file "$env_file" --entrypoint sh "$image" -ceu 'export PGPASSWORD="$DB_PASSWORD"; psql -h postgres -U "$DB_USER" -d "$DB_NAME" -Atqc "SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = '\''public'\''), (SELECT count(*) FROM _prisma_migrations), (SELECT count(*) FROM pg_constraint WHERE contype = '\''f'\'' AND connamespace = '\''public'\''::regnamespace)"')"
read -r tables migrations foreign_keys <<<"${metrics//$'|'/ }"
docker run --rm --network "$network" --env-file "$env_file" -v "$target:/backup" --entrypoint sh "$image" -ceu 'umask 077; export PGPASSWORD="$DB_PASSWORD"; pg_dump -h postgres -U "$DB_USER" -d "$DB_NAME" -Fc -f /backup/postgres.dump'
docker run --rm -v "$minio_volume:/source:ro" -v "$target:/backup" --entrypoint sh "$image" -ceu 'umask 077; tar -C /source --numeric-owner -czf /backup/minio.tar.gz .'
docker run --rm -v "$uploads_volume:/source:ro" -v "$target:/backup" --entrypoint sh "$image" -ceu 'umask 077; tar -C /source --numeric-owner -czf /backup/uploads.tar.gz .'
read -r minio_files minio_bytes <<<"$(stage10_stats "$minio_volume" "$image")"; read -r uploads_files uploads_bytes <<<"$(stage10_stats "$uploads_volume" "$image")"
printf '{"format":1,"createdAt":"%s","revision":"%s","schema":{"tables":%s,"migrations":%s,"foreignKeys":%s},"objects":{"minio":{"files":%s,"bytes":%s},"uploads":{"files":%s,"bytes":%s}},"encryption":"none-permissions-600"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git -C "$ROOT_DIR" rev-parse HEAD)" "$tables" "$migrations" "$foreign_keys" "$minio_files" "$minio_bytes" "$uploads_files" "$uploads_bytes" > "$target/manifest.json"
chmod 600 "$target/postgres.dump" "$target/minio.tar.gz" "$target/uploads.tar.gz" "$target/manifest.json"; stage10_hash "$target"
rg -n -i '(password|secret|authorization|postgres(ql)?://|patient|medical|cookie|token)' "$target/manifest.json" >/dev/null && stage10_die "manifest contains forbidden data" 65 || true
printf 'backup=%s status=created\n' "$name"
