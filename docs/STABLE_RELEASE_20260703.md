# Stable Release - Tahili System

Date: 2026-07-03
Status: Stable and confirmed from browser.

## Confirmed Working

- Application is running.
- Login redirect is working.
- Security headers are active.
- /workspaces page is working.
- Sidebar link "مساحات العمل" is working.
- Database container was not restarted during deployment.
- MinIO container was not restarted during deployment.
- No obvious app errors after deployment.
- No obvious database errors after deployment.

## Docker Images

Stable image:
tahili-system-app:stable-20260703_0305

Rollback image:
tahili-system-app:rollback-20260703_025027

Current production image:
tahili-system-app:latest

## Important Notes

Do not delete the rollback image yet.
Keep it for at least 1-2 days after confirming all users work normally.

Do not activate docker-compose.secure-ports.yml during working hours.
It is prepared only for a later maintenance window.

## Health Check

./scripts/tahili-safe-check.sh

## Patch Status

./scripts/tahili-patch-status.sh
