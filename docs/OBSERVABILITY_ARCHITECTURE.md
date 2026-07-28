# Tahili Local Observability Architecture

## Scope

This design applies only to the development VM. It is local-first, works without Internet access, and observes operations without collecting patient, treatment, financial, file, session, or form data.

## Baseline (2026-07-28)

The VM already runs Grafana, Loki, Promtail, and Uptime Kuma beside the application stack. Grafana is reachable only through loopback port `3002`; Loki is internal; Promtail reads Docker logs; Uptime Kuma is loopback-only. The primary stack keeps application port `3000` on the approved development LAN address and loopback, PostgreSQL on loopback `5432`, MinIO on loopback `9000/9001`, and supporting data in named volumes.

## Target data flow

```text
host + Docker + safe HTTP probes
  -> Prometheus / Alertmanager (internal network)
  -> provisioned Grafana dashboards (loopback only)

Docker JSON logs + app structured JSON
  -> Promtail (read-only Docker metadata/log access)
  -> Loki (internal network)
  -> Grafana / bounded Tahili adapter

browser telemetry (sampled, redacted, optional)
  -> local receiver / Loki-compatible store
  -> Grafana

Tahili /observability
  -> authenticated, allowlisted, read-only monitor adapter
  -> status summaries, redacted errors, alerts, test results
```

No application container receives a Docker socket. Only the dedicated collector may receive the minimum read-only mounts required for container metadata/log collection.

## Network and retention contract

| Component | Exposure | Development retention | Notes |
| --- | --- | --- | --- |
| Grafana | `127.0.0.1` only | dashboard definitions in Git | Existing service reused |
| Loki | Docker internal | 7 days | Structured/redacted logs only |
| Prometheus | Docker internal | 7 days | Metrics only |
| Alertmanager | Docker internal | 7 days | Local notification grouping/silencing only |
| Exporters | Docker internal | none | No public ports |
| Debug bundles | `/tmp` or `test-results` | 7 days maximum | Redacted archive, preview first |
| Smoke results | `test-results` | 14 days maximum | Aggregate status only |

Pinned image digests/tags are recorded in the offline manifest before a release. Mutable tags such as `latest` are not introduced by this project; existing mutable baseline images are documented for later remediation.

## Ownership and permissions

`/observability` is an administrative operational area. It must use its own permission keys, default to ADMIN, and never change medical-role access. All adapter operations are allowlisted, timeout-bounded, schema-validated, redacted, and read-only except explicit alert acknowledgement and non-medical operational notes.

## Deferred decision

`pg_stat_statements` is not enabled in this work because it requires a PostgreSQL configuration change and restart. PostgreSQL restart is outside this project. Database metrics initially use exporter-safe counters only.

## Acceptance gates

- No public administrative port or cloud dependency.
- No data-bearing log fields or arbitrary query/shell interfaces.
- PostgreSQL, MinIO, and Caddy are never restarted for observability work.
- Each runtime phase has an isolated commit, push, dev-only release, health check, and checkpoint.
