# Stage 11 Development Security Review

Date: 2026-07-29
Revision: `9e404d2bc9713117f519af64ea38825e91c38112`
Environment: development VM only

## Executive summary

The scoped review of the isolated monitoring Compose package, observability
gateway, Alloy Faro receiver, and related application adapter found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 0

The prior Faro forwarding failure was operational, not an authorization bypass:
the gateway's upstream alias could resolve back to the gateway itself. Revision
`9e404d2` pins control-plane upstreams to fixed addresses on the internal
monitoring network. A subsequent HTTP 421 on the reverse metrics scrape was
fixed by setting only that fixed route's upstream `Host` to the application's
existing `app:3000` internal-metrics contract. The app remains the only allowed
Faro/OTLP peer, while a non-app peer is rejected with HTTP 403.

## Evidence

- All monitoring images are digest-pinned and use `pull_policy: never`.
- Monitoring containers run with a read-only root filesystem, all Linux
  capabilities dropped, `no-new-privileges`, and no privileged mode.
- The gateway has no published port and forwards only allowlisted
  method/path/source combinations with a 64 KiB body limit, a 120
  requests/source/port/minute limit, and a 1500 ms upstream timeout.
- Only `Accept`, `Host`, `Content-Type`, and bounded `Content-Length` headers
  are forwarded. Cookies, authorization headers, request IDs, and arbitrary
  proxy headers are not forwarded or logged.
- Alloy, Loki, Tempo, Prometheus, and Alertmanager remain on the internal
  monitoring network. PostgreSQL, MinIO, and ClamAV do not join the
  observability network.
- Grafana and Prometheus are configured for loopback-only host publication;
  other monitoring endpoints are Docker-internal.
- Monitoring secrets are Git-ignored and host files are mode `0600`; no secret
  content was inspected or emitted.
- The scoped Vitest suite passed 39/39 tests, including fixed upstreams,
  allowlists, disabled optional profiles, Faro sanitization, bounds, metrics,
  OTEL privacy/export behavior, and fail-open adapter behavior.
- Runtime checks confirmed Alloy readiness HTTP 200, Faro receiver HTTP 202,
  sanitized Loki presence, OTEL delivery to Tempo, all seven Prometheus targets
  healthy, and non-app peer rejection HTTP 403.

## Scope boundary

This was a source, configuration, and runtime-control review of Stage 11. It did
not scan unrelated medical application code or perform an external CVE image
scan. No application data, Prisma schema, workflow, role, permission, database,
object storage, antivirus, proxy, DNS, FRP, or router configuration was changed.
