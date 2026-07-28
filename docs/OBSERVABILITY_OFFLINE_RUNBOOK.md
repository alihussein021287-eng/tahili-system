# Tahili Observability Offline Runbook

## Development-only release

1. Build and validate on the development VM after targeted tests pass.
2. Record immutable image tags/digests in the offline manifest.
3. Start only the new observability services; do not restart PostgreSQL, MinIO, Caddy, or unrelated services.
4. Verify via `http://192.168.17.20:3000` and local/internal monitoring endpoints.

## Offline operation

The monitoring stack uses local Docker images, local named volumes, provisioned Grafana assets, and no cloud endpoints. Internet loss must not interrupt LAN application access, metrics, logs, traces, alerts, smoke tests, debug bundles, or the local MCP/CLI.

## Image handling

Before offline validation, record image names, pinned tags, and image IDs. Save only the necessary images to a documented local archive or registry. Never remove running images, volumes, databases, uploads, backups, credentials, or QA data.

## Safe fault validation

Only non-critical observability containers may be stopped temporarily to confirm alert delivery, then immediately restored. A deliberately invalid internal probe target may validate HTTP alerts. Do not stop PostgreSQL, MinIO, Caddy, or the app; do not fill disk or mutate data.

## Recovery

If an observability service fails, retain its volume and inspect redacted logs. Restore only that observability service from its pinned local image. The application remains independent of monitoring services.
