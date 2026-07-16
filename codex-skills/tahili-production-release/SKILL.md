---
name: tahili-production-release
description: Release Tahili to the production VM only after an explicit production deployment request. Use only when the user clearly asks to deploy, publish, transfer, or apply a change to Tahili production; never trigger for ordinary feature work, Git checks, quality checks, or development deployment.
---

# Tahili Production Release

- Require an explicit production deployment request before any production action.
- The user has a separate development VM and production VM. Confirm the development VM is already green before production.
- Target production only when explicitly requested: `root@192.168.17.228`; project `/tahili-system`; internal domain `https://tah.elaqat.site`.
- Keep the system operable without Internet access.
- Build the image on the development VM, then transfer it to production; never depend on production package downloads.
- Preserve Caddy, the domain, and HTTPS configuration.
- Do not change DNS. The internal domain uses MikroTik DNS when applicable.
- Apply migrations only with `prisma migrate deploy`; never use `prisma db push`.
- Never erase the database, volumes, or attachments without an explicit clear request.
- Never change Admin data.
- Verify `/login`, `/readiness`, the changed pages, and all required services: app, PostgreSQL, MinIO, Caddy, and ClamAV when present.
- Report a concise result without secrets or passwords.
- Ignore a pre-existing untracked `skills-lock.json`; do not modify or stage it.
