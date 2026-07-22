---
name: tahili-testing-strategy
description: Plan or implement targeted Tahili tests for a change. Use for Vitest unit tests, integration tests, Playwright route checks, permission/navigation coverage, or deciding what tahili-quality-check should run.
---

# Tahili Testing Strategy

Use this skill to choose the smallest test set that gives credible confidence for the change.

## Required Context

- Work from `/tahili-system`.
- Read `AGENTS.md` and the relevant rows in `ACCEPTANCE_MATRIX.md`.
- Inspect existing tests under `tests/unit`, `tests/integration`, and `tests/e2e` before adding new ones.
- For permissions/navigation changes, read `ROLES_PERMISSIONS.md` and the related app shell or route guards.
- Do not touch production, do not use `prisma db push`, do not print secrets, and do not stage `skills-lock.json`.

## Test Selection

- Helpers and pure business rules: Vitest unit tests.
- Server actions, auth guards, permission stores, or DB behavior: integration tests if existing patterns support it.
- Navigation, role visibility, login, forms, upload/preview, or routing regressions: targeted Playwright.
- Shared permissions, migrations, or app-shell behavior: broaden to related tests and `npx tsc --noEmit`.
- Documentation or skill-only changes: validate scripts/frontmatter and run `git diff --check`; no app build unless app code changed.

## Common Commands

```bash
npx tsc --noEmit
npm test
npm run test:e2e -- --grep "[relevant pattern]"
npx playwright test tests/e2e/[file].spec.ts --workers=1
```

Read `ENVIRONMENTS.md` and use the environment LAN IP for authenticated browser checks. Never use localhost or either domain for live tests.

## Output Shape

```markdown
## Test Strategy: [change]

### Required
- [command/test and why]

### Optional
- [only if risk warrants]

### Not Needed
- [explicitly excluded checks and reason]

### Acceptance Mapping
- [ACCEPTANCE_MATRIX row or route]
```

When implementing tests, keep fixtures clearly marked as QA/ACCEPTANCE/e2e and leave cleanup to the approved dry-run-first script.
