# Repository Guidelines

## Project Structure & Module Organization

This is a private Next.js/TypeScript application. Main app code lives in `src/`, with route-level UI and server actions under `src/app`, shared components under `src/components`, and reusable domain logic in `src/lib`. Database schema and migrations are in `prisma/`. Tests are organized under `tests/unit`, `tests/integration`, and `tests/e2e`. Static assets belong in `public/`; operational notes and supporting material live in `docs/` and `monitoring/`.

## Build, Test, and Development Commands

- `npm run dev`: start the local Next.js development server.
- `npm run build`: create a production build using Next.js webpack mode.
- `npm run start`: serve the built application.
- `npx tsc --noEmit`: run TypeScript type checking without writing output.
- `npm test`: run Vitest unit and integration tests.
- `npm run test:e2e`: run Playwright end-to-end tests.
- `npx prisma migrate dev`: create/apply local development migrations.
- `npx prisma migrate deploy`: apply committed migrations in deployed environments.

Avoid `prisma db push` on shared or production databases unless explicitly instructed.

## Coding Style & Naming Conventions

Use TypeScript and React patterns already present in the repository. Prefer 2-space indentation, named exports for shared utilities, PascalCase for React components, camelCase for functions and variables, and kebab-case or route-group conventions matching existing `src/app` paths. Keep authorization and role logic centralized in existing access helpers rather than duplicating checks in UI components. Preserve Arabic UI copy and right-to-left layout behavior when editing user-facing screens.

## Testing Guidelines

Use Vitest for unit/integration coverage and Playwright for browser workflows. Name tests with `*.test.ts` or the existing local convention in the target folder. When changing navigation, permissions, notifications, therapy, queue, appointments, collaboration, or readiness behavior, run the relevant targeted tests plus `npx tsc --noEmit`. For broad UI or routing changes, include Playwright checks for both desktop and mobile flows.

## Commit & Pull Request Guidelines

Recent history uses short imperative subjects, sometimes with Conventional Commit prefixes such as `feat:` or `fix:`. Keep commit messages focused, for example `fix: align sidebar permissions` or `Refine role-based sidebar groups`. Pull requests should describe the change, affected routes or roles, database migration status, and tests run. Include screenshots or a clear visual-check note for UI changes.

## Security & Configuration Tips

Do not commit secrets, `.env` values, database dumps, or generated private artifacts. Keep migrations explicit and review Prisma changes before deployment. Do not restart or modify production services unless the task explicitly asks for a production release.

## Operational Memory

Use the repository runbooks as the shared operating memory: `ENVIRONMENTS.md`, `RUNBOOK.md`, `PRODUCTION_CHECKLIST.md`, `SYSTEM_MAP.md`, `ROLES_PERMISSIONS.md`, `ACCEPTANCE_MATRIX.md`, and `OFFLINE_DEPLOYMENT.md`. `ENVIRONMENTS.md` is authoritative for environment URLs: health checks, smoke tests, and Playwright use the environment LAN IP only; do not check domains, DNS, FRP, or Caddy unless explicitly requested. When a change affects operations, permissions, acceptance coverage, or production release flow, update only the relevant section. Keep these files concise and use `scripts/health-check.sh` or `scripts/cleanup-qa-data.ts` when their checks apply.

For development incident diagnosis, use `scripts/tahili-diagnose.mjs` or the `tahili-incident-diagnostics` skill before broader inspection. It is read-only, bounded, Docker-bridge-only, and never accepts user-controlled telemetry queries, URLs, paths, or containers.

Before changing any page, permission, role workspace, navigation, Server Action, or workflow, read `docs/USER_ROLE_GUIDE_AR.md`, `docs/ROLE_PERMISSION_MATRIX_AR.md`, and `docs/ROLE_WORKFLOW_HANDOFFS_AR.md` alongside the code. They are staff-facing operational references; reconcile them with `src/lib/perms.ts`, access guards, and the actual Action before changing behavior.

Use Tahili workflow skills only when they fit the task: `tahili-write-spec` for large features before implementation, `tahili-system-design` for module design, `tahili-architecture` for ADRs, `tahili-code-review` for diff/code review, `tahili-testing-strategy` for test planning, and `tahili-dashboard` for monitoring, Grafana, or HTML dashboards. Do not use separate deploy/runbook skills when the same instructions already live in the runbooks unless they have been explicitly merged.

## UI Governance Boundary

For every UI/UX, navigation, responsive, RTL, dark-mode, or duplication task, read `docs/MEDICAL_WORKFLOW_BOUNDARIES.md`, `docs/UI_INFORMATION_ARCHITECTURE.md`, and `docs/UI_DUPLICATION_REGISTER.md` first and use `tahili-ui-governance`.

Allowed work is presentation-only: layout, navigation organization, shared UI components, forms, tables, empty states, accessibility, RTL, mobile, and theme behavior. Never change medical data or field meaning, treatment logic, state machines, role transitions, permissions, Prisma schema, Server Action behavior, or delete routes/functions as part of a UI improvement. A workflow change must be a separately specified and tested functional change. Preserve legacy routes and deep links when reorganizing navigation.

Run `node scripts/audit-project.mjs` after adding or removing routes, actions, components, roles, permissions, models, or migrations. The inventory must report zero unclassified pages before commit.

For VM cleanup or resource checks, use `tahili-environment-hygiene`: dry-run first, protect all volumes/databases/uploads/backups/credentials and active images, and keep development and production completely separate.
