---
name: tahili-write-spec
description: Write a compact implementation-ready spec for large Tahili features or risky changes before coding. Use for new modules, Prisma/schema changes, permission changes, cross-role workflows, or ambiguous feature requests in /tahili-system.
---

# Tahili Write Spec

Use this skill before implementation when the request needs product, role, data, or rollout clarity. Do not edit application code unless the user explicitly asks to turn the spec into implementation.

## Required Context

- Work from `/tahili-system`.
- Read `AGENTS.md` first.
- Read only the relevant parts of `SYSTEM_MAP.md`, `ROLES_PERMISSIONS.md`, and `ACCEPTANCE_MATRIX.md`.
- Inspect the current implementation narrowly with `rg` and targeted file reads.
- Do not touch production, do not use `prisma db push`, do not print secrets, and do not stage `skills-lock.json`.

## Spec Workflow

1. Restate the user problem and the affected operational area.
2. Identify affected roles, expected permissions, and pages/routes.
3. Confirm whether persistence changes are needed. If yes, specify Prisma migration expectations but do not create one unless requested.
4. Reuse existing pages, tabs, components, server actions, and permission helpers where possible.
5. Define acceptance checks before implementation.
6. Surface open questions only when they materially change the build.

## Output Shape

```markdown
# Spec: [feature]

## Problem
[short problem statement and affected users]

## Goals
- [measurable outcome]

## Non-Goals
- [explicitly excluded scope]

## Roles & Permissions
| Role | Expected access | Permission keys |

## Routes & UI
- [existing or new route]
- [RTL/mobile notes]

## Data & Server Logic
- Prisma impact: [none / migration required]
- Server-side guards: [permission checks]
- Audit/notification/file-storage impact: [if any]

## Acceptance
- [route/test/user flow]

## Rollout Notes
- [dev/prod/migration/health-check notes]

## Open Questions
- [only blockers]
```

Keep the spec concise. If a decision changes architecture, use `tahili-architecture` for an ADR.
