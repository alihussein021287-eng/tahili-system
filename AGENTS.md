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
