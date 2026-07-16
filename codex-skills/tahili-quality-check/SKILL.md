---
name: tahili-quality-check
description: Test and inspect Tahili changes on the development VM. Use automatically when the user asks to test, validate, verify, audit, visually inspect, or quality-check an application change, release candidate, page, workflow, or admin screen without touching production.
---

# Tahili Quality Check

- Work in `/tahili-system` on the development VM. Do not use the Windows checkout as the execution source unless explicitly requested.
- Confirm `HEAD` matches the intended commit and note any untracked files before testing.
- Run TypeScript checks and related tests first; run the full suite for shared or high-risk changes.
- Inspect Server Actions, server-side permissions, and center isolation.
- Visually inspect only changed pages, on desktop and mobile, for RTL and horizontal clipping.
- Do not capture or send images unless the user explicitly requests images.
- Do not repeat heavy E2E tests without a reason.
- Distinguish environment failures from application failures.
- If Playwright CLI cannot start because npm access or browser channels are unavailable, use the repo's installed `@playwright/test` Chromium in a small headless check. Do not install browsers unless necessary.
- Inspect application logs for HTTP 500 and Prisma errors.
- For Docker-applied app changes, verify app is running, `/login` returns 200, and the changed route loads or redirects correctly for unauthenticated users.
- For collaboration/files changes, verify ClamAV behavior only when the change affects upload, scan, download, permissions, or sharing.
- For admin pages, verify tabs, save buttons, readonly permissions, and mobile layout.
- For visual checks, report viewport, visible labels, console errors, HTTP 5xx, and horizontal overflow instead of sending screenshots unless requested.
- If an environment or operational blocker repeats twice or consumes more than 10 minutes, include it as a "lesson learned" in the final report. After validation succeeds or stops cleanly, add one concise, generic, non-secret line to the most relevant Tahili skill only; never update skills mid-task, and skip one-off or unclear issues.
- Report only: passed, failed, and required fixes.
- Ignore a pre-existing untracked `skills-lock.json`; do not modify or stage it.
- Ignore pre-existing `analysis/` artifacts unless they are part of the current request.
- Never delete, reset, wipe, deploy, or touch production as part of validation.
