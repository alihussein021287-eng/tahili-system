---
name: tahili-feature-work
description: Implement or modify features in the tahili-system project. Use automatically when a user requests adding, changing, fixing, or extending application behavior in /tahili-system.
---

# Tahili Feature Work

- Read `AGENTS.md` when present and only files relevant to the requested area.
- Inspect the current implementation before creating components or workflows.
- Follow existing Next.js, Server Actions, Prisma, and project patterns.
- Enforce permissions server-side; never rely only on hiding UI.
- Preserve RTL behavior and Arabic copy.
- Never use Vercel, `deploy-to-vercel`, or `vercel-optimize`.
- Ignore a pre-existing untracked `skills-lock.json`; do not modify or stage it.
- Never use `prisma db push`. When database changes are required, create a small, safe migration.
- Never touch the production VM or expand the task beyond the request.
- After successful implementation and checks, commit, push to `origin/main`, and apply directly to the development VM.
- Never delete, reset, or wipe data automatically.
