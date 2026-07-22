---
name: tahili-architecture
description: Create or update a concise ADR for important Tahili technical decisions. Use for schema strategy, deployment architecture, external services, offline production constraints, storage/scanning choices, or decisions likely to be revisited.
---

# Tahili Architecture

Use this skill to write an Architecture Decision Record. Do not implement the decision unless separately requested.

## Required Context

- Work from `/tahili-system`.
- Read `AGENTS.md` and the relevant sections of `SYSTEM_MAP.md`.
- For deployment or operations decisions, read `RUNBOOK.md`, `PRODUCTION_CHECKLIST.md`, and `OFFLINE_DEPLOYMENT.md`.
- For permissions decisions, read `ROLES_PERMISSIONS.md` and the relevant code in `src/lib/perms.ts` or `src/lib/access.ts`.
- Do not touch production, do not use `prisma db push`, do not print secrets, and do not stage `skills-lock.json`.

## ADR Rules

- Store ADRs in `docs/adr/` only if the user asks for a file; otherwise return the ADR in chat.
- Use short, numbered filenames such as `docs/adr/ADR-004-offline-image-release.md`.
- Record the decision, options considered, consequences, and follow-up checks.
- Avoid speculative architecture. Prefer the smallest design that fits current Tahili constraints.

## Template

```markdown
# ADR-[number]: [title]

**Status:** Proposed | Accepted | Superseded
**Date:** [YYYY-MM-DD]
**Affects:** [modules/routes/services]

## Context
[problem, constraints, operational limits]

## Decision
[chosen approach]

## Options Considered
| Option | Pros | Cons | Operational impact |

## Consequences
- Positive:
- Negative:
- Follow-up:

## Validation
- [tests, health checks, migration checks, docs to update]
```

If the ADR changes release flow, update `PRODUCTION_CHECKLIST.md` or `OFFLINE_DEPLOYMENT.md` in the same work item.
