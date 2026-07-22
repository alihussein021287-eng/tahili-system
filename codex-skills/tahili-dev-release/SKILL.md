---
name: tahili-dev-release
description: Release a Tahili change to the development VM only. Use automatically when the user asks to apply, deploy, publish, rebuild, restart, or roll out a commit or change to the Tahili development environment at /tahili-system.
---

# Tahili Development Release

- Work only on the development VM at `/tahili-system`; never on production.
- Before release actions, read `AGENTS.md`, `RUNBOOK.md`, `PRODUCTION_CHECKLIST.md`, and `OFFLINE_DEPLOYMENT.md`; use `scripts/health-check.sh` when a read-only service check is useful.
- Confirm the requested commit exists in `origin/main` and the working tree has no relevant uncommitted tracked changes.
- Fast-forward to the requested commit from `origin/main`; do not merge manually.
- If new migrations exist, apply them only with `prisma migrate deploy`. On the development VM, `.env` may use Docker hostname `postgres`; host-side Prisma commands should use the localhost-published database URL without printing secrets.
- Build the application image from the latest Git source.
- Expect Docker build to repeat `prisma generate` and `next build`; long layer export is normal unless it errors.
- If the image installs LibreOffice or large Alpine packages, `apk add` may be silent for 30+ minutes; verify the process is alive before aborting, and run the build outside the sandbox if sandboxed Docker output stalls.
- Recreate only the app service with `--no-deps`.
- Do not restart PostgreSQL or MinIO without an explicit need.
- If ClamAV was added or changed, recreate only the needed service too; otherwise leave supporting services untouched.
- Verify `/login`, changed pages, and the application startup log. For protected pages, verify either 200 with a valid session or expected redirect for unauthenticated access.
- Do not create rollback images or backups unless requested.
- Never clean images, volumes, or data without an explicit request.
- Never touch the production VM.
- If an environment or operational blocker repeats twice or consumes more than 10 minutes, include it as a "lesson learned" in the final report. After release succeeds or stops cleanly, add one concise, generic, non-secret line to the most relevant Tahili skill only; never update skills mid-task, and skip one-off or unclear issues.
- Report only the commit, application status, and applied change.
- Ignore a pre-existing untracked `skills-lock.json`; do not modify or stage it.
