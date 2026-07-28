# ADR-005: Local, read-only observability stack

**Status:** Accepted

**Date:** 2026-07-28

**Affects:** development Docker monitoring, Grafana/Loki, Tahili admin operations

## Context

Tahili needs diagnostics that function offline without exposing medical or authentication data. Existing Grafana, Loki, Promtail, and Uptime Kuma must be reused; application access to Docker is forbidden.

## Decision

Add a separately profiled, pinned-image metrics/alerts/traces stack on the development VM. Keep all new endpoints internal or loopback-only. Use provisioned Grafana dashboards, a redacting bounded adapter for the in-app view, and no cloud services or arbitrary query interfaces.

## Options considered

| Option | Decision |
| --- | --- |
| Local Prometheus/Alertmanager/exporters plus existing Grafana/Loki | Chosen: offline and isolated |
| Grafana Cloud/SaaS | Rejected: violates local/offline scope |
| Docker socket in Next.js | Rejected: violates least privilege |
| PostgreSQL configuration changes now | Deferred: requires restart/approval |

## Consequences

- Positive: local metrics, logs, alerts, and traces are available without exposing operations publicly.
- Negative: additional bounded development resource overhead and image lifecycle work.
- Follow-up: record pinned image identifiers and test offline behavior before any production decision.

## Validation

Check endpoint exposure, redaction tests, Grafana provisioning, internal alerts, read-only adapter behavior, and development health checks.
