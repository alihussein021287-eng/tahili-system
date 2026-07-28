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

server OTLP traces (Stage 7B; Node runtime only)
  -> Alloy OTLP receiver (`alloy:4317` gRPC, `alloy:4318` HTTP; Docker internal only)
  -> Tempo (`tempo:4317` OTLP, `tempo:3200` query; local named volume only)
  -> Grafana Tempo datasource UID `Tempo`

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
| Tempo | Docker internal; no host port | 72 hours in `tempodata` | `grafana/tempo:2.9.4@sha256:3ecdaa1af90b3068e77e4fb4b11d9f26201c3a57d5740d34965a323173a4f1aa`; local filesystem backend only |
| Debug bundles | `/tmp` or `test-results` | 7 days maximum | Redacted archive, preview first |
| Smoke results | `test-results` | 14 days maximum | Aggregate status only |

Pinned image digests/tags are recorded in the offline manifest before a release. Mutable tags such as `latest` are not introduced by this project; existing mutable baseline images are documented for later remediation.

## Ownership and permissions

`/observability` is an administrative operational area. It must use its own permission keys, default to ADMIN, and never change medical-role access. All adapter operations are allowlisted, timeout-bounded, schema-validated, redacted, and read-only except explicit alert acknowledgement and non-medical operational notes.

## Deferred decision

Stage 6A proves receiver infrastructure only: Alloy returns `202`, receiver counters increase, and Alloy writes a sanitized Loki entry without drops. Stage 6B adds pinned `@grafana/faro-web-sdk@2.8.2` and a same-origin bounded adapter; the browser never receives the Alloy address. It accepts only sanitized event/log/measurement envelopes, sends no exceptions or traces, and keeps route, app name, environment, and revision server-controlled.

`FARO_ENABLED` is a server runtime flag, defaulting to `false`; the same image can run with it enabled on development and disabled elsewhere. It is read by the server layout and adapter only. No `NEXT_PUBLIC_FARO_*` setting exists.

## Frontend dashboard and alerts (Stage 6C)

Provisioned dashboard UID `tahili-frontend-observability` is available through local Grafana only. It reads sanitized Faro logfmt fields from Loki and aggregate adapter counters from Prometheus. `service` and `environment` are the only stream labels; kind, level, normalized route, LCP, app, and revision remain parsed fields to avoid cardinality growth. Prometheus alerts cover Alloy availability, exporter drop/retry counters, telemetry absence, error rate, LCP, bounded rejection rate, and forwarding failures.

Stage 6C.1 adds a Docker-internal Prometheus scrape of the adapter's aggregate-only metrics endpoint. The endpoint does not expose telemetry, configuration, or identity data. `tahili_faro_enabled` gates telemetry-absence alerting; a 15-minute process warm-up prevents startup noise, and the counter reset is explicit through `tahili_faro_process_start_time_seconds`.

`pg_stat_statements` is not enabled in this work because it requires a PostgreSQL configuration change and restart. PostgreSQL restart is outside this project. Database metrics initially use exporter-safe counters only.

## Traces (Stages 7A–7B)

Tempo is a development-only, single-binary local trace store. It has a 72-hour retention period, a read-only configuration mount, a writable dedicated named volume, a 32 MiB temporary filesystem, and limits of 0.30 CPU / 384 MiB RAM. It publishes no host or LAN port and has no cloud endpoint, object storage, metrics generator, or service map.

Alloy accepts OTLP gRPC and HTTP only on the Docker network and forwards traces only to `tempo:4317`. Grafana datasource `Tempo` uses `http://tempo:3200`; its traces-to-logs mapping uses only `service.name -> service` and `deployment.environment -> environment`.

Stage 7B uses Next.js `src/instrumentation.ts` and the official `registerOTel` integration in the Node runtime only. `OTEL_ENABLED` is a server runtime flag and defaults to `false`; it initializes once with `instrumentations: []`, relying only on Next's built-in server spans before sending the privacy-projected output through OTLP/HTTP to `http://alloy:4318/v1/traces`. The normal development sampler is parent-based 5%. Browser tracing, Prisma, SQL, request bodies, outgoing HTTP, and workflow instrumentation remain disabled. The image carries its immutable build revision in server-only `GIT_REVISION`, used as `service.version`; it is not a runtime feature flag.

## Acceptance gates

- No public administrative port or cloud dependency.
- No data-bearing log fields or arbitrary query/shell interfaces.
- PostgreSQL, MinIO, and Caddy are never restarted for observability work.
- Stage 7B adds only sanitized Node server request tracing; it does not add Prisma, SQL, browser, or workflow instrumentation.
- Each runtime phase has an isolated commit, push, dev-only release, health check, and checkpoint.
