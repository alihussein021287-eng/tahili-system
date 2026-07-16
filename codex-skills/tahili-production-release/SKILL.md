---
name: tahili-production-release
description: Release Tahili to the production VM only after an explicit production deployment request. Use only when the user clearly asks to deploy, publish, transfer, or apply a change to Tahili production; never trigger for ordinary feature work, Git checks, quality checks, or development deployment.
---

# Tahili Production Release

- Require an explicit production deployment request before any production action; never touch production for feature work, Git checks, quality checks, or development releases.
- The user has a separate development VM and production VM. Confirm the development VM is already green before production.
- Target production only when explicitly requested: `root@192.168.17.228`; project `/tahili-system`; internal domain `https://tah.elaqat.site`.
- Do not install Codex skills on production or depend on them there.
- Keep production operable without Internet access: build the image on the development VM, confirm required runtime tools are inside the image, then transfer the image to production.
- Office preview must use LibreOffice inside the Docker image, not the production host; before transfer, verify inside the image with `libreoffice --version` or `soffice --version`.
- Apply migrations only with `prisma migrate deploy`; never use `prisma db push`.
- If `DATABASE_URL` in compose uses an internal hostname, run migrations from the correct container/network context or with a correct URL, and never print secrets.
- Preserve DNS, Caddy/domain/HTTPS, volumes, database, attachments, and Admin data unless an explicit clear request covers that exact action.
- Verify after deployment: `/login`, `/readiness`, `/users` presence, `/collaboration/files`, ordinary PDF/text previews, Office preview with a nonsensitive test file when possible, cleanup any test file, and logs without HTTP 500 or Prisma errors.
- If Office preview fails on production, do not install LibreOffice on the host first; verify the image contains LibreOffice and the app uses the new image.
- If a serious production blocker appears, stop and report before any step that could erase data or change DNS/Caddy/volumes.
- Report a concise result without secrets or passwords.
- Ignore a pre-existing untracked `skills-lock.json`; do not modify or stage it.
