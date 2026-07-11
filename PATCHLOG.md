# Tahili System Patch Log

هذا الملف يسجل التحديثات الآمنة المطبقة على نظام المجمع التأهيلي.

ملاحظة مهمة:
أغلب تعديلات الكود لا تؤثر على الحاوية الشغالة إلا بعد rebuild/deploy لاحق.

## Applied Patches

### Patch 001 - Docker Ignore Protection
- Added .dockerignore.
- Prevents secrets, backups, uploads, node_modules, and build output from entering Docker build context.

### Patch 002 - PWA Cache Security
- Updated public/sw.js.
- Prevents browser cache for sensitive medical/admin pages.
- Allows cache only for safe public/static files.

### Patch 003 - Patients/Appointments/Export Permissions
- Added stricter permission checks for patients, appointments, and patient export.
- Protected patient export API with patients.export.

### Patch 004 - Patient Details Guard
- Added patients.view guard before loading patient detail data.

### Patch 005 - Safe Health Check Script
- Added scripts/tahili-safe-check.sh.
- Read-only system health check: containers, HTTP, logs, disk, memory.

### Patch 006 - Queue API Guard
- Added queue.view permission guard for today queue API.
- Added no-store headers.

### Patch 006-FIX - Queue API Syntax Fix
- Fixed literal newline issue in queue API response block.

### Patch 007 - Sensitive Download No-Store
- Added no-store headers for exports, files, and backup downloads.
- Added .sql.gz support for backup downloads.

### Patch 008 - Build Check Script
- Added scripts/tahili-build-check.sh.
- Builds isolated test image without restarting running containers.

### Patch 009 - Reminder API Security
- Reminder API now supports query key, x-reminder-key, and Authorization Bearer.
- Added no-store headers.

### Patch 010 - Backup JSON API No-Store
- Added no-store headers for backup JSON export/import APIs.

### Patch 011 - Next.js Security Headers
- Added global security headers in next.config.mjs.
- Added no-store headers for sensitive routes.

### Patch 012 - Build Check Image Cleaner
- Added scripts/tahili-clean-build-check-images.sh.
- Removes only tahili-system-app:build-check-* images.

### Patch 013 - Secure Ports Override Preparation
- Added docker-compose.secure-ports.yml.
- Prepares optional localhost-only ports for PostgreSQL and MinIO.

### Patch 013-FIX - Compose Ports Override Fix
- Updated secure ports override to use Docker Compose !override.
- Confirmed config replaces ports instead of merging them.

## Current Production Status

- Running containers were not restarted during these patches.
- Current live app still uses the previously running Docker image.
- Source code changes are build-checked successfully.
- Activation of code changes requires planned rebuild/deploy later.

## Important Commands

Read-only health check:
./scripts/tahili-safe-check.sh

Isolated build check:
./scripts/tahili-build-check.sh

Clean build-check images:
CONFIRM_DELETE=1 ./scripts/tahili-clean-build-check-images.sh

Optional secure ports activation, only during maintenance:
docker compose -f docker-compose.yml -f docker-compose.secure-ports.yml up -d

### Patch 014 - Patch Log
- Added PATCHLOG.md to document applied safe patches.
- Documents that live containers were not restarted during patching.

### Patch 015 - Patch Status Script
- Added scripts/tahili-patch-status.sh.
- Shows applied patches, important changed files, backups, touched security files, images, containers, and disk usage.
- Read-only script; no changes are made when it runs.

### Patch 017 - Patient Files Permission Guard
- Protected patient file download API with patients.view permission.
- Added no-store headers for 401, 403, 404, and successful file responses.
- Build check passed successfully after this patch.

### Patch 016 - Patch Log Sync
- Updated PATCHLOG.md to include Patch 014 and Patch 015.
- Verified patch status and safe health check after updating the log.

### Patch 018 - Patch Log and Build Image Cleanup
- Added Patch 017 entry to PATCHLOG.md.
- Cleaned the latest tahili-system-app:build-check-* image.
- Verified running containers remained untouched.

### Patch 020 - Role Workflows Preparation
- Added docs/ROLE_WORKFLOWS.md to document workflows for reception, doctor, therapist, pharmacy, finance, admin, and portal users.
- Added src/lib/role-workspaces.ts as a prepared role workspace configuration.
- Build check passed successfully after this patch.

### Patch 022 - Workspaces Page
- Added /workspaces page.
- Page displays role-based workspace cards according to user permissions.
- Build check passed successfully.

### Patch 023 - Sidebar Workspaces Link
- Added "مساحات العمل" link to the sidebar.
- Build check passed successfully.

### Patch 024 - Production Deploy
- Created rollback image: tahili-system-app:rollback-20260703_025027.
- Built production app image.
- Recreated app container only using docker compose up -d --no-deps app.
- Database and MinIO containers were not restarted.
- Security headers are active.
- Safe health check passed after deployment.

### Patch 025 - Stable Release Confirmation
- Confirmed /workspaces page is working from browser.
- Confirmed sidebar link "مساحات العمل" is visible and working.
- Confirmed production app is running after deploy.
- Confirmed security headers are active.
- Confirmed no obvious app/database errors after deployment.
- Tagged current working app image as stable release.

### Patch 026 - Final Stability Confirmation
- User confirmed the system is stable after deployment.
- Finalized the applied changes as the active production state.
- Removed rollback image after stability confirmation.
- Kept stable image tahili-system-app:stable-20260703_0305.
- Confirmed latest image remains the active production image.

### Patch 027 - Secure Ports Activation
- Activated docker-compose.secure-ports.yml.
- PostgreSQL is now bound to 127.0.0.1:5432 only.
- MinIO API and Console are now bound to 127.0.0.1:9000-9001 only.
- Public app port 3000 remains available.
- Database and MinIO containers were recreated to apply secure port bindings.
- App remained running.
- HTTP check passed after activation.
