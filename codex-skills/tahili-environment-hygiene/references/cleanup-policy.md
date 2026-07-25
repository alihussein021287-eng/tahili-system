# Cleanup Policy

## Read-only inventory

- `df -hT`, `df -ih`, `free -h`, `uptime`
- `docker system df`, `docker image ls --no-trunc`, `docker ps -a`
- absolute `/tmp` candidates, test artifacts, preview caches, transfer archives
- container log sizes and backup freshness without reading secrets

## Safe only after verification

- dangling images;
- unused build cache;
- stopped non-required containers;
- confirmed `/tmp/tahili-*` exports and transfer archives;
- old Playwright/Office preview temp and superseded reports.

## Always protect

Volumes, PostgreSQL, MinIO, uploads, backups, credentials, QA data, Git objects, migrations, active logs, running images, and explicitly retained stable images.

Use explicit IDs/paths. Check an absolute path before recursive deletion and measure before/after.
