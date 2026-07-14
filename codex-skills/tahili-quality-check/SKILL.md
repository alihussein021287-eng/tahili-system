---
name: tahili-quality-check
description: Test and inspect changes in tahili-system. Use automatically when a user asks to test, validate, verify, audit, or quality-check an application change.
---

# Tahili Quality Check

- Run TypeScript checks and related tests first; run the full suite for shared or high-risk changes.
- Inspect Server Actions, server-side permissions, and center isolation.
- Visually inspect only changed pages, on desktop and mobile, for RTL and horizontal clipping.
- Do not capture or send images unless the user explicitly requests images.
- Do not repeat heavy E2E tests without a reason.
- Distinguish environment failures from application failures.
- Inspect application logs for HTTP 500 and Prisma errors.
- Report only: passed, failed, and required fixes.
- Ignore a pre-existing untracked `skills-lock.json`; do not modify or stage it.
- Never delete, reset, wipe, deploy, or touch production as part of validation.
