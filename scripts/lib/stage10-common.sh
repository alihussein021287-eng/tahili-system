#!/usr/bin/env bash
set -euo pipefail

STAGE10_ROOT=/var/backups/tahili
STAGE10_MIN_FREE_BYTES=${STAGE10_MIN_FREE_BYTES:-2147483648}
STAGE10_TIMEOUT_SECONDS=${STAGE10_TIMEOUT_SECONDS:-300}
STAGE10_LOCK=/run/tahili/stage10-backup.lock
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

stage10_die() { printf '%s\n' "stage10: $1" >&2; exit "${2:-1}"; }
stage10_name_ok() { [[ "$1" =~ ^stage10-[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]]; }
stage10_dir() { printf '%s/%s' "$STAGE10_ROOT" "$1"; }
stage10_init() { install -d -m 700 "$STAGE10_ROOT" /run/tahili; [[ ! -L "$STAGE10_ROOT" ]] || stage10_die "unsafe backup root" 2; [[ "${STAGE10_SKIP_LOCK:-0}" = 1 ]] && return; exec 9>"$STAGE10_LOCK"; flock -n 9 || stage10_die "operation already running" 75; }
stage10_guard_disk() { local free; free="$(df -PB1 "$STAGE10_ROOT" | awk 'NR==2 {print $4}')"; [[ "$free" =~ ^[0-9]+$ && "$free" -ge "$STAGE10_MIN_FREE_BYTES" ]] || stage10_die "insufficient disk space" 70; }
stage10_volume() { local volume; volume="$(docker inspect -f '{{range .Mounts}}{{if and (eq .Type "volume") (eq .Destination "'"$2"'")}}{{.Name}}{{end}}{{end}}' "$1" 2>/dev/null || true)"; [[ "$volume" =~ ^[a-zA-Z0-9_.-]+$ ]] || stage10_die "source volume unavailable" 69; printf '%s' "$volume"; }
stage10_network() { local network; network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' tahili_db 2>/dev/null || true)"; [[ "$network" =~ ^[a-zA-Z0-9_.-]+$ ]] || stage10_die "database network unavailable" 69; printf '%s' "$network"; }
stage10_image() { docker image inspect postgres:16-alpine >/dev/null 2>&1 || stage10_die "local postgres image unavailable" 69; printf '%s' postgres:16-alpine; }
stage10_env() { [[ -f "$ROOT_DIR/.env" && ! -L "$ROOT_DIR/.env" ]] || stage10_die "development environment unavailable" 69; printf '%s' "$ROOT_DIR/.env"; }
stage10_stats() { docker run --rm -v "$1:/source:ro" --entrypoint sh "$2" -ceu 'f=$(find /source -type f | wc -l | tr -d " "); b=$(find /source -type f -exec wc -c {} + 2>/dev/null | awk "{s+=\$1} END {print s+0}"); printf "%s %s\n" "$f" "$b"'; }
stage10_hash() { (cd "$1" && sha256sum postgres.dump minio.tar.gz uploads.tar.gz manifest.json > SHA256SUMS); chmod 600 "$1/SHA256SUMS"; }
