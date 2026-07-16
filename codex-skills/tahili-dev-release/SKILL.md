---
name: tahili-dev-release
description: Release a Tahili change to the development VM only. Use automatically when the user asks to apply, deploy, publish, rebuild, restart, or roll out a commit or change to the Tahili development environment at /tahili-system.
---

# Tahili Development Release

- Work only on the development VM at `/tahili-system`; never on production.
- Confirm the requested commit exists in `origin/main` and the working tree has no relevant uncommitted tracked changes.
- Fast-forward to the requested commit from `origin/main`; do not merge manually.
- If new migrations exist, apply them only with `prisma migrate deploy`.
- Build the application image from the latest Git source.
- Recreate only the app service with `--no-deps`.
- Do not restart PostgreSQL or MinIO without an explicit need.
- If ClamAV was added or changed, recreate only the needed service too; otherwise leave supporting services untouched.
- Verify `/login`, changed pages, and the application startup log. For protected pages, verify either 200 with a valid session or expected redirect for unauthenticated access.
- Do not create rollback images or backups unless requested.
- Never clean images, volumes, or data without an explicit request.
- Never touch the production VM.
- Report only the commit, application status, and applied change.
- Ignore a pre-existing untracked `skills-lock.json`; do not modify or stage it.
