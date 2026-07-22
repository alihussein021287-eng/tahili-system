# Spec: Dark Theme and Approved Reference Data

## Problem

The current dark mode is a partial list of color overrides and supports only light/dark. Reference lookups are complete on development but incomplete on production, while development also contains acceptance-only centers, halls, medicines, and batches that must never be transferred.

## Goals

- Provide flicker-free `light`, `dark`, and `system` themes across the shared shell and all existing routes.
- Keep print and document canvases white while preserving readable controls around them.
- Maintain one approved, idempotent reference-data source that can be dry-run before each transaction.
- Synchronize approved lookups and the medicine catalog by natural name without copying QA records or stock quantities.

## Non-Goals

- No permission, workflow, Prisma schema, patient, user, prescription, or stock-movement changes.
- No invented branches, batches, quantities, suppliers, or expiry dates.
- No deletion of existing operational or QA records.

## Roles & Permissions

All existing role and permission checks remain unchanged. Theme selection is available to every authenticated user. Reference synchronization is an offline operator command, not a new application permission.

## Routes & UI

- Existing routes and patient tabs keep their URLs and actions.
- AppShell, shared controls, collaboration viewers, charts, forms, tables, dialogs, loading/empty/error states, and login receive token-backed dark styles.
- Print routes and `@media print` always render on white.

## Data & Server Logic

- Prisma impact: none.
- Approved keys: normalized Arabic display names and center + hall natural pairs.
- Missing medicine entries are created with `quantity=0`; existing quantities and batches are never changed.
- Apply runs in one transaction and writes one counts-only `AuditLog` row.
- QA/test/acceptance names are rejected by the approved catalog and excluded from synchronization.

## Acceptance

- Theme preference survives reload and supports OS scheme changes in `system` mode without hydration flash.
- Shared surfaces have no white cells in dark mode; focus, placeholder, semantic alerts, charts, and links remain readable.
- Dry-run reports counts and changes but writes nothing; repeated apply creates no duplicates.
- Development and production contain the same approved lookup/catalog subset, independent of numeric IDs.
- No medicine batch or positive stock is created by synchronization.

## Rollout Notes

- Build and test on development, deploy one image, dry-run then apply on development.
- Transfer the identical image to production, then dry-run and apply there.
- Live checks use only the LAN IP in `ENVIRONMENTS.md`.

## Open Questions

- No trusted branch list or genuine stock ledger was found. Both remain intentionally empty until an approved operational source is supplied.
