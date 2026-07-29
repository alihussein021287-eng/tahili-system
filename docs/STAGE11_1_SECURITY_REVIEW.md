# Stage 11.1 Security Review

Scope: development VM `/observability` classification and its fixed, aggregate-only monitoring inputs. Production and application workflows are out of scope and unchanged.

## Result

| Severity | Open findings |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

## Reviewed controls

- Authorization remains a server-side active-user and `ADMIN` role check before the summary is rendered.
- The browser receives only a bounded DTO; it cannot supply URLs, paths, PromQL, LogQL, IDs, or telemetry payloads.
- The gateway still permits only the fixed app peer, method, path, query allowlist, body limit, timeout, and rate limit. A non-app peer is rejected.
- Stage 5 Smoke is read from one exact read-only aggregate metrics file. The gateway reads at most 16 KiB and validates timestamp, duration, success, and bounded check counts before returning JSON.
- PostgreSQL, MinIO, ClamAV, and the app are not joined to the monitoring network. Missing direct probes and host metrics are classified as intentional security N/A.
- No Docker socket, privileged container, host-root mount, raw artifact, credential, raw log/span, internal URL, request/trace ID, or medical field is exposed.
- Faro and OTEL remain aggregate-only. Empty sample windows are distinct from zero error/failure counters.

## Evidence

- Unit and contract tests: 315/315.
- TypeScript and production image build: PASS.
- ADMIN `/observability`: 200; non-ADMIN: redirected away.
- Faro: accepted and forwarded; forwarding failures zero; redacted Loki entry present.
- OTEL: accepted spans present; export failures zero.
- Fixed non-app gateway peer: 403.
- Read-only Smoke: 17/17 with preserved data counts.
- Inventory: zero unclassified pages.
