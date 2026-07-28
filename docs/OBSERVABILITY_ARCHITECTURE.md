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
  -> same-origin `POST /api/observability/faro`
  -> Alloy Faro receiver (`alloy:12347`, Docker internal only) -> Loki
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
| Alloy Faro receiver | Docker internal; no host port | 7 days in Loki | `grafana/alloy:v1.16.2@sha256:32913cbfac652d15fa84d256a74e5ee3f71575961bb19d34796ce3838bfba693` |
| Debug bundles | `/tmp` or `test-results` | 7 days maximum | Redacted archive, preview first |
| Smoke results | `test-results` | 14 days maximum | Aggregate status only |

Pinned image digests/tags are recorded in the offline manifest before a release. Mutable tags such as `latest` are not introduced by this project; existing mutable baseline images are documented for later remediation.

## Ownership and permissions

`/observability` is an administrative operational area. It must use its own permission keys, default to ADMIN, and never change medical-role access. All adapter operations are allowlisted, timeout-bounded, schema-validated, redacted, and read-only except explicit alert acknowledgement and non-medical operational notes.

## Deferred decision

Stage 6A proves receiver infrastructure only: Alloy returns `202`, receiver counters increase, and Alloy writes a sanitized Loki entry without drops. Stage 6B adds pinned `@grafana/faro-web-sdk@2.8.2` and a same-origin bounded adapter; the browser never receives the Alloy address. It accepts only sanitized event/log/measurement envelopes, sends no exceptions or traces, and keeps route, app name, environment, and revision server-controlled.

`FARO_ENABLED` is a server runtime flag, defaulting to `false`; the same image can run with it enabled on development and disabled elsewhere. It is read by the server layout and adapter only. No `NEXT_PUBLIC_FARO_*` setting exists.

## Frontend dashboard and alerts (Stage 6C)

Provisioned dashboard UID `tahili-frontend-observability` is available through local Grafana only. It reads sanitized Faro logfmt fields from Loki and Alloy counters from Prometheus. `service` and `environment` are the only stream labels; kind, level, normalized route, LCP, app, and revision remain parsed fields to avoid cardinality growth. Prometheus alerts cover Alloy availability and exporter drop/retry counters. Telemetry-absence, adapter-rate-limit, and LCP/error-rate alerts are intentionally deferred until a privacy-safe server metric exists: `FARO_ENABLED=false` must never generate a false alert.

`pg_stat_statements` is not enabled in this work because it requires a PostgreSQL configuration change and restart. PostgreSQL restart is outside this project. Database metrics initially use exporter-safe counters only.

## Acceptance gates

- No public administrative port or cloud dependency.
- No data-bearing log fields or arbitrary query/shell interfaces.
- PostgreSQL, MinIO, and Caddy are never restarted for observability work.
- Each runtime phase has an isolated commit, push, dev-only release, health check, and checkpoint.
