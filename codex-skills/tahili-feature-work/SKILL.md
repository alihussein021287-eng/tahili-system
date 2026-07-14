---
name: tahili-feature-work
description: Coordinate token-efficient feature, fix, and modification work in /tahili-system. Use automatically for scoped application changes; inspect narrowly, select only necessary companion skills, verify proportionately, commit and push successful app changes, and release them to the development VM without touching production.
---

# Tahili Feature Work

## Scope

- Identify only the requested page or function.
- Read `AGENTS.md` when present and directly related files only.
- Do not scan the repository or read old reports or migrations unless needed.
- Inspect the current implementation before adding anything.

## Skills

Use the fewest skills required:

- Normal change: this skill only; verification: `tahili-quality-check`.
- Required UI check: `playwright`; manual diagnosis only: `playwright-interactive`.
- Images explicitly requested: `screenshot`.
- Login, permissions, files, backups, secrets, or sensitive Server Actions: `security-best-practices`.
- Explicit comprehensive security audit: `security-threat-model`.
- Explicit Git ownership analysis: `security-ownership-map`.
- Reports, books, or printing: `pdf`; statistical analysis: `jupyter-notebook`.
- Failed GitHub Actions: `gh-fix-ci`; PR feedback: `gh-address-comments`.
- Completed app change for development: `tahili-dev-release`.
- Explicit production request only: `tahili-production-release`.

Never invoke a skill merely because it is installed.

## Implement

- Change the fewest files; reuse existing components, functions, Next.js, Server Actions, Prisma, RTL, and Arabic patterns.
- Avoid general layers or abstractions for small work.
- Enforce permissions on the server, not only in the UI.
- Change Prisma only for genuinely new persistence. Use a small migration; never use `prisma db push`.
- Ignore a pre-existing untracked `skills-lock.json`; never modify or stage it.
- Do not use Vercel, expand scope, delete/reset data, or touch production.

## Verify

Run in order:

1. The related unit test.
2. TypeScript.
3. Only the changed page check.

- Run full tests only for Prisma/migrations, auth/permissions, a multi-module shared library, or a major multi-page workflow.
- Run Playwright only for the changed scenario; never run all E2E without cause.
- Never capture images unless explicitly requested.

## Git and development

- After success, create one clear commit and push it to `origin/main`.
- Apply the latest app-changing commit using `tahili-dev-release`; recreate only app with `--no-deps`.
- Do not restart PostgreSQL or MinIO without need.
- For tests-or-skills-only changes that do not alter the app, do not build an image.

## Report

Use at most eight lines covering: change, files, migration if any, tests, commit, development VM status, production untouched, and at most one remaining item. Do not repeat the request or include long logs, commands, images, or redundant explanation.
