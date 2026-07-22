---
name: tahili-code-review
description: Review Tahili code, diffs, or proposed changes for correctness, security, permissions, Prisma behavior, RTL UI risks, tests, and deployment impact. Use when the user asks for a review or asks whether a Tahili change is safe.
---

# Tahili Code Review

Take a code-review stance. Findings come first, ordered by severity, with file and line references where possible.

## Required Context

- Work from `/tahili-system`.
- Read `AGENTS.md`.
- For domain context, read the relevant rows of `SYSTEM_MAP.md`, `ROLES_PERMISSIONS.md`, and `ACCEPTANCE_MATRIX.md`.
- If no diff is provided, inspect `git status --short`, `git diff`, and targeted files only.
- Do not touch production, do not use `prisma db push`, do not print secrets, and do not stage `skills-lock.json`.

## Review Focus

- Server-side permissions: every mutation and protected read must guard with existing access helpers.
- Role visibility: sidebar, tabs, and direct route access must match permission keys.
- Prisma: avoid unbounded `findMany`, N+1 patterns, accidental deletes, unsafe migration assumptions, and leaking sensitive financial data.
- Files: MinIO object keys, ClamAV scan state, preview/download permissions, and path traversal.
- Auth/session: active user state, `authVersion`, redirects, and cookie assumptions.
- UI: Arabic copy, RTL layout, mobile overflow, repeated controls, and accessible labels.
- Tests: unit/integration/Playwright coverage proportional to risk.
- Operations: migration, image build, health-check, and production constraints when applicable.

## Output Shape

```markdown
**Findings**
- [severity] [file:line] [issue and impact]

**Open Questions**
- [only if needed]

**Tests/Checks**
- [what was run or what is missing]
```

If there are no findings, say so clearly and mention residual risk or unrun checks.
