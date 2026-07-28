#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/stage10-common.sh
source "$ROOT_DIR/scripts/lib/stage10-common.sh"
[[ $# -eq 1 ]] || stage10_die "usage: stage10-isolated-restore-drill.sh NAME" 2; name="$1"; stage10_name_ok "$name" || stage10_die "invalid backup name" 2; stage10_init
target="$(stage10_dir "$name")"; STAGE10_SKIP_LOCK=1 "$ROOT_DIR/scripts/stage10-verify-backup.sh" "$name" >/dev/null
image="$(stage10_image)"; base="tahili-stage10-${name#stage10-}"; network="${base}-net"; db_volume="${base}-db"; minio_volume="${base}-minio"; uploads_volume="${base}-uploads"
cleanup() { docker rm -f "${base}-db" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; docker volume rm "$db_volume" "$minio_volume" "$uploads_volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker network create --internal "$network" >/dev/null; docker volume create "$db_volume" >/dev/null; docker volume create "$minio_volume" >/dev/null; docker volume create "$uploads_volume" >/dev/null
docker run -d --name "${base}-db" --network "$network" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore -v "$db_volume:/var/lib/postgresql/data" "$image" >/dev/null
deadline=$((SECONDS + STAGE10_TIMEOUT_SECONDS)); until docker run --rm --network "$network" --entrypoint pg_isready "$image" -h "${base}-db" -U postgres -d restore >/dev/null 2>&1; do (( SECONDS < deadline )) || stage10_die "isolated database timeout" 124; sleep 1; done
docker run --rm --network "$network" -v "$target:/backup:ro" --entrypoint pg_restore "$image" --exit-on-error --no-owner --no-privileges -h "${base}-db" -U postgres -d restore /backup/postgres.dump
docker run --rm -v "$target:/backup:ro" -v "$minio_volume:/restore" --entrypoint sh "$image" -ceu 'tar -xzf /backup/minio.tar.gz -C /restore'
docker run --rm -v "$target:/backup:ro" -v "$uploads_volume:/restore" --entrypoint sh "$image" -ceu 'tar -xzf /backup/uploads.tar.gz -C /restore'
source_metrics="$(jq -r '[.schema.tables,.schema.migrations,.schema.foreignKeys] | @tsv' "$target/manifest.json")"
restored_metrics="$(docker run --rm --network "$network" --entrypoint sh "$image" -ceu 'psql -h "'"${base}-db"'" -U postgres -d restore -Atqc "SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = '\''public'\''), (SELECT count(*) FROM _prisma_migrations), (SELECT count(*) FROM pg_constraint WHERE contype = '\''f'\'' AND connamespace = '\''public'\''::regnamespace)"')"
[[ "${source_metrics//$'\t'/|}" = "$restored_metrics" ]] || stage10_die "isolated database aggregate mismatch" 65
read -r minio_files minio_bytes <<<"$(stage10_stats "$minio_volume" "$image")"; read -r uploads_files uploads_bytes <<<"$(stage10_stats "$uploads_volume" "$image")"
[[ "$minio_files" = "$(jq -r '.objects.minio.files' "$target/manifest.json")" && "$minio_bytes" = "$(jq -r '.objects.minio.bytes' "$target/manifest.json")" && "$uploads_files" = "$(jq -r '.objects.uploads.files' "$target/manifest.json")" && "$uploads_bytes" = "$(jq -r '.objects.uploads.bytes' "$target/manifest.json")" ]] || stage10_die "isolated object aggregate mismatch" 65
printf 'backup=%s status=restore-drill-pass cleanup=scheduled\n' "$name"
