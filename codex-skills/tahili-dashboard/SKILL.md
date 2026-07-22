---
name: tahili-dashboard
description: Design or build Tahili monitoring and analytics dashboards. Use for Grafana/Loki panels, operational health dashboards, static HTML reports, KPI views, or visualizing patient, therapy, pharmacy, finance, collaboration, and system data.
---

# Tahili Dashboard

Use this skill when the requested deliverable is a dashboard or monitoring view. Prefer source-backed, offline-friendly outputs.

## Required Context

- Work from `/tahili-system`.
- Read `AGENTS.md`, `SYSTEM_MAP.md`, and the relevant acceptance rows.
- For operational monitoring, read `RUNBOOK.md` and inspect `monitoring/` plus current Docker service names.
- For data dashboards, inspect the actual Prisma models and existing report pages before choosing metrics.
- Do not touch production, do not use `prisma db push`, do not print secrets, and do not stage `skills-lock.json`.

## Dashboard Types

- Grafana/Loki: use for app logs, 5xx, Prisma errors, container health, ClamAV/MinIO file workflows, and deployment monitoring.
- Static HTML: use for local/offline reports when the user asks for a portable artifact.
- In-app dashboard: use existing Next.js/Tailwind patterns only when the user asks to add app UI.

## Rules

- Query or inspect existing labels before writing Loki expressions; do not assume container labels.
- Keep patient, finance, and file data aggregated unless the user explicitly asks for row-level review and has permission.
- Avoid external CDNs in offline dashboards unless the user approves.
- Use Arabic RTL layout for reader-facing dashboards.
- Do not create screenshots unless requested.

## Output Shape

```markdown
# Dashboard Plan: [name]

## Audience and Purpose
## Data Sources
## Metrics and Panels
## Permissions and Privacy
## Refresh/Delivery
## Validation
```

For Grafana changes, include provisioning file paths and a way to verify panels load. For HTML, include where the file is saved and how it can be opened locally.
