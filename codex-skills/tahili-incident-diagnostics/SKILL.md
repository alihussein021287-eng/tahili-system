---
name: tahili-incident-diagnostics
description: Diagnose Tahili development incidents safely with the local tahili-diagnose CLI. Use when investigating request IDs, error IDs, monitoring health, alerts, smoke results, or a redacted debug bundle without changing the application or infrastructure.
---

# Tahili Incident Diagnostics

- Work only on `/tahili-system` development VM and read `ENVIRONMENTS.md` first.
- Start with `node scripts/tahili-diagnose.mjs status --json`, then use `request` or `error` only with a validated ID.
- Use `alerts`, `smoke`, and `recent-errors` for bounded summaries; use `service` only with its fixed allowlist.
- Use `bundle --dry-run` first. Require an explicit request before `bundle --apply`; report only its path, checksum, and size.
- Never pass URLs, PromQL, LogQL, container names, file paths, shell fragments, or credentials to the CLI.
- Do not use `docker exec`, raw log/span dumps, DNS, production, restart/delete/prune/migrate operations, or application changes during diagnosis.
- Treat missing monitoring data as unavailable, not an application failure. Use the LAN IP only for app checks.
