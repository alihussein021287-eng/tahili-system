---
name: tahili-system-design
description: Design large Tahili modules or multi-file workflows before implementation. Use for new operational areas, major UI/data flows, multiple Prisma models, cross-role behavior, integrations, or changes likely to affect more than five files.
---

# Tahili System Design

Use this skill to design a substantial change before a spec or implementation. Prefer existing Tahili architecture over new layers.

## Required Context

- Work from `/tahili-system`.
- Read `AGENTS.md`, then the relevant rows of `SYSTEM_MAP.md` and `ROLES_PERMISSIONS.md`.
- Read `RUNBOOK.md`, `PRODUCTION_CHECKLIST.md`, and `OFFLINE_DEPLOYMENT.md` if the design affects deployment, migrations, files, or services.
- Inspect the current routes, `src/lib` helpers, Prisma models, and tests that are directly related.
- Do not touch production, do not use `prisma db push`, do not print secrets, and do not stage `skills-lock.json`.

## Design Checklist

- Boundaries: which module owns the feature and which existing routes/tabs should host it.
- Data: existing models first; migration only for real persistence needs.
- Permissions: server-side enforcement through existing permission helpers.
- Workflows: happy path, denied path, empty state, and error handling.
- Dependencies: PostgreSQL, MinIO, ClamAV, Caddy, notifications, backup, or readiness impact.
- Testing: unit, integration, and Playwright coverage proportional to risk.
- Rollout: dev-only, production image transfer, migration, and health-check implications.

## Output Shape

```markdown
# Design: [module/change]

## Context
## Proposed Shape
## Routes and Components
## Data Model
## Server Actions and Permissions
## Operational Impact
## Test Strategy
## Phases
## Risks and Tradeoffs
## Next Spec or ADR
```

Keep the design actionable. If the key output is a durable decision, use `tahili-architecture`.
