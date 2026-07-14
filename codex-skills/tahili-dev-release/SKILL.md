---
name: tahili-dev-release
description: Release a tahili-system change to the development VM. Use automatically when a user asks to apply, deploy, publish, or roll out a commit or change to the Tahili development environment.
---

# Tahili Development Release

- Confirm the requested commit exists in `origin/main`.
- If new migrations exist, apply them only with `prisma migrate deploy`.
- Build the application image from the latest Git source.
- Recreate only the app service with `--no-deps`.
- Do not restart PostgreSQL or MinIO without an explicit need.
- Verify `/login`, changed pages, and the application startup log.
- Do not create rollback images or backups unless requested.
- Never clean images, volumes, or data without an explicit request.
- Never touch the production VM.
- Report only the commit, application status, and applied change.
- Ignore a pre-existing untracked `skills-lock.json`; do not modify or stage it.
