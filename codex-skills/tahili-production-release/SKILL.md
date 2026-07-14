---
name: tahili-production-release
description: Release tahili-system to its production VM only after an explicit production deployment request. Use only when the user clearly asks to deploy, publish, or transfer a change to Tahili production; never trigger for ordinary feature work or development deployment.
---

# Tahili Production Release

- Require an explicit production deployment request before any production action.
- Target `root@192.168.17.228`; the project is `/tahili-system` and the domain is `https://tah.elaqat.site`.
- Keep the system operable without Internet access.
- Build the image on the development VM, then transfer it to production; never depend on production package downloads.
- Preserve Caddy, the domain, and HTTPS configuration.
- Apply migrations only with `prisma migrate deploy`; never use `prisma db push`.
- Never erase the database, volumes, or attachments without an explicit clear request.
- Never change Admin data.
- Verify `/login`, `/readiness`, and all four services.
- Report a concise result without secrets or passwords.
- Ignore a pre-existing untracked `skills-lock.json`; do not modify or stage it.
