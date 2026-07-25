---
name: tahili-project-audit
description: Inventory Tahili routes, actions, components, domain logic, Prisma structure, permissions, navigation, tests, operations, and memory. Use for project inventories, system-map updates, discovery of new routes or functions, code-to-document comparison, and operational-memory completeness audits.
---

# Tahili Project Audit

Work from `/tahili-system` on development. Do not read patient rows, credentials, tokens, or production.

## Workflow

1. Read `AGENTS.md`, `SYSTEM_MAP.md`, and `references/audit-sources.md`.
2. Check Git and preserve unrelated changes; never stage `skills-lock.json`.
3. Run `node scripts/audit-project.mjs`; require `unclassifiedPages=0`.
4. Use `rg` to inspect only mismatches and sensitive workflow owners.
5. Reconcile:
   - `docs/UI_INFORMATION_ARCHITECTURE.md`
   - `docs/MEDICAL_WORKFLOW_BOUNDARIES.md`
   - `docs/UI_DUPLICATION_REGISTER.md`
   - `ROLES_PERMISSIONS.md` and `ACCEPTANCE_MATRIX.md`
6. Report deterministic counts and gaps. Do not change application behavior during an audit.

Regenerate the route table with:

```bash
node scripts/audit-project.mjs --markdown
```

Review generated changes before committing; the script uses source heuristics, while workflow truth remains in the linked domain files.
