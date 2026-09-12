# Phase 0 — Local Staging Bootstrap

A fully isolated Windows local staging path is prepared for the Saif plan branch.

## Files

- `docker-compose.saif-dev.yml`
- `scripts/windows-saif-bootstrap.ps1`

## Target

- Project path: `C:\Users\Ali Hussein\Documents\GitHub\tahili-system-updates\UPDATE-01-GUID-FOUNDATION`
- Branch: `update/01-guid-foundation`
- Compose project: `tahili-saif-dev`
- App: `http://localhost:3000`
- PostgreSQL: `localhost:55432`
- MinIO API: `localhost:59000`
- MinIO Console: `http://localhost:59001`

## Bootstrap behavior

The PowerShell bootstrap:

1. Elevates to Administrator.
2. Enables WSL2/VirtualMachinePlatform when needed.
3. Installs Git, Node.js LTS, and Docker Desktop through winget when missing.
4. Generates local-only secrets under `.env.saif-dev` and `.secrets/` (already gitignored).
5. Builds the isolated app image.
6. Starts PostgreSQL 16, MinIO, and ClamAV.
7. Uses committed Prisma migrations via `prisma migrate deploy`; it does not use `db push`.
8. Seeds the fresh local database.
9. Starts the Tahili application.
10. Runs `npm ci`, Prisma generate, TypeScript check, tests, and production build check.
11. Performs a local HTTP check and writes a local-only setup report and credentials under `.secrets/`.

If Windows has just enabled WSL2 and requires a reboot, the script exits safely and instructs the operator to reboot once and rerun the same script. No production system is touched.

## Important boundary

This local staging environment enables development and migration rehearsal, but it does not replace the production Phase 0 gate. Before any live deployment, a real production PostgreSQL + MinIO + uploads backup, verification, and isolated restore drill are still mandatory per `Tahili_System_Plan_Saif_Style_RTL`.
