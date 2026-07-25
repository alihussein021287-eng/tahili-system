# Audit Sources

Read progressively:

1. `SYSTEM_MAP.md` for module ownership and hubs.
2. `docs/UI_INFORMATION_ARCHITECTURE.md` for every page and risk.
3. `docs/MEDICAL_WORKFLOW_BOUNDARIES.md` for workflow owners.
4. `src/lib/work-registry.ts`, `perms.ts`, and `permissions.ts` for navigation and access.
5. `prisma/schema.prisma` for structural counts only.
6. `ACCEPTANCE_MATRIX.md` and tests for coverage.

Use `rg --files` and `scripts/audit-project.mjs`; do not bulk-read runtime data.
