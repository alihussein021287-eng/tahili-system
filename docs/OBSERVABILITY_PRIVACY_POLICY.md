# Tahili Observability Privacy Policy

## Purpose

Operational telemetry must make failures diagnosable without exposing patient, clinical, financial, authentication, or file content.

## Allowed fields

- timestamp, level, environment, service, route template, method, status, duration
- generated request ID and error ID
- sampled trace ID
- general role and action category
- bounded error code, container status, resource metric, migration state, and aggregate scan count

## Prohibited fields

- names, file numbers, phones, addresses, diagnoses, medical notes, form values, file names/content, uploads, or SQL parameter values
- passwords, secrets, cookies, tokens, authorization headers, CSRF values, connection strings, and `.env` content
- raw query strings when they can contain identifiers or values; patient routes must be normalized to `/patients/:id`
- session replay, video, DOM text capture, and browser form capture

## Redaction and access

The logger and monitor adapter redact sensitive key names before output. Request/error lookup accepts only generated IDs and returns bounded, sanitized records. Grafana is local and authenticated. The in-app operational view is ADMIN-only by default and has no arbitrary PromQL, LogQL, SQL, or shell input.

## Retention and export

Development logs, metrics, alerts, and telemetry retain at most seven days by default. Debug bundles and smoke outputs are short-lived, redacted, and created only after a preview. Archives may be stored only in `/tmp` or `test-results`; they are never database dumps and never contain credentials or patient data.

## Review

Privacy regression tests block forbidden values in structured logs and debug bundles. Any new telemetry field requires review against this policy before release.
