# Tahili Incident Response

## First response

1. Open the local Grafana dashboard or `/observability` as an administrator.
2. Record the generated request/error ID, alert name, service state, and time window; do not copy patient or authentication data.
3. Check the bounded recent-error view and readiness status.
4. Acknowledge/group the alert locally when an operator is investigating it.

## Safe actions

- Refresh read-only status, download a redacted debug bundle, run a read-only smoke test, and add a non-medical operational note.
- Inspect only the last ten minutes of redacted logs by default.
- Escalate repeated app failures, migration discrepancies, stale backup, or unavailable file scanning.

## Redacted debug bundle

ابدأ دائماً بـ`./scripts/collect-debug-bundle.sh --dry-run`. عند الحاجة إلى evidence غير حساس فقط، نفّذ `--create --since 10m` (أو أضف Request/Error ID UUID). الناتج محصور في `/tmp` أو `test-results/diagnostics`، بصلاحية `600` مع checksum وsecret scan. لا تشارك archive قبل التحقق من manifest؛ لا يحتوي dumps أو `.env` أو uploads أو MinIO أو credentials أو cookies/tokens أو request bodies أو بيانات طبية.

## Prohibited actions

- No automatic restart, database migration, restore, cleanup, Docker socket access from the app, or configuration change through the monitoring UI.
- Do not restart PostgreSQL, MinIO, or Caddy as an incident response step.
- Do not capture traffic, copy cookies/tokens, inspect patient data, or use production as a diagnostic target.

## Escalation

For a recurring 5xx, Prisma failure, or Server Action error: preserve only IDs and redacted evidence, create an incident from the template, then stop for a scoped repair decision. For a medical workflow symptom, use the existing workflow owner and do not change state transitions during observability work.
