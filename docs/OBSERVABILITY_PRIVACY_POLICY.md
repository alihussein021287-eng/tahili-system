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

Alloy accepts telemetry only on the Docker network and forwards only to local Loki. It has no Cloud endpoint or host-published receiver port. SDK and same-origin adapter controls in Stage 6B provide the second allowlist/redaction boundary; 6A does not claim semantic browser-event coverage.

Stage 7A keeps OTLP gRPC/HTTP inside Docker only: Alloy forwards traces only to the local Tempo volume-backed store. Tempo has no host/LAN receiver, cloud endpoint, object storage, metrics generator, or service map. No browser traces, Next.js instrumentation, Prisma instrumentation, SQL statements, request URLs, query strings, patient/user names, or credentials are enabled in this stage. The one deployment validation trace is randomly identified and contains only a fixed synthetic service, environment, scope, and span name.

Stage 7B permits sampled Node server request spans only when `OTEL_ENABLED=true`. Before export, the application replaces each span with a prototype-preserving safe projection: fixed service/environment/build revision and only normalized route template, HTTP method, bounded status, and error class. It removes events, links, exception messages/stacks, headers, cookies, request/response bodies, query strings, identities, database attributes, and all other span/resource attributes. Alloy deletes sensitive keys again defensively. `OTEL_TEST_FORCE_SAMPLE` is test-only and is not present in the deployment compose contract.

Stage 6B is controlled only by the server runtime variable `FARO_ENABLED` (default `false`). The browser receives only an enabled boolean, never Alloy addressing or server configuration. The adapter accepts bounded event/log/measurement envelopes only and drops exceptions, traces, identity metadata, and empty envelopes. It extracts a pathname before normalizing it, so URL origins, query strings, hashes, and dynamic identifiers never reach Loki.

Privacy regression tests block forbidden values in structured logs and debug bundles. Any new telemetry field requires review against this policy before release.

Faro adapter metrics are server in-memory aggregates only. They use fixed names and bounded labels for rejection reason, signal kind, forwarding failure reason, and log level. They never include routes, URLs, query values, identifiers, user/session data, payload values, or environment values. Counters reset on an app restart; process-start and last-accepted/forwarded timestamps make this visible to monitoring.

Debug bundles may include only Tempo container state and aggregate receiver/storage counters. They must never contain trace IDs, spans, span attributes, OTLP payloads, or raw Tempo query output.

## Identifier semantics

Request ID identifies one HTTP request. Error ID identifies the incident shown to the user. Report Request ID identifies only the browser-error reporting POST. The guaranteed lookup chain is `Error ID → Report Request ID → Loki`; client render errors are not claimed to correlate reliably to the original page request. Future OpenTelemetry/Faro work may add a privacy-reviewed correlation mechanism.
