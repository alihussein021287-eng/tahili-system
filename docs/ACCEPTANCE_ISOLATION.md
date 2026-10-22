# Disposable critical acceptance harness

## Fresh checkout

Requires Git, Node >=20.9, host `tar`, and Docker Compose v2 with a running **local Linux** daemon (Docker Desktop Linux mode on Windows). No host npm install, existing database, local rehearsal image, `.env`, credentials file or historical evidence is needed. The first build needs access to public Node20 Alpine, PostgreSQL16 Alpine, Alpine packages and npm. Dependencies use the checked-in lockfile; OS/browser packages follow the public Alpine repository and are not a bit-for-bit OS lock.

From the checkout root run the single entry point:

```sh
node scripts/acceptance/run.cjs
```

For guards alone, without Docker or database access: `node scripts/acceptance/run.cjs --guard-only`.

### Critical versus legacy discovery

The disposable runner uses `tests/e2e/acceptance/playwright.critical.config.ts` and selects only the nine `critical-registration.spec.ts` cases. The original `tests/e2e/acceptance/playwright.config.ts` preserves discovery of `acceptance-*.spec.ts` and `resilient-probes.spec.ts`; it does not include the critical suite. Both configurations import the same fail-closed disposable-target guard, with no QA/production default and no dotenv loading in configuration.

For discovery only, use `node node_modules/@playwright/test/cli.js test -c tests/e2e/acceptance/playwright.config.ts --list` (or the critical config). Even listing requires a complete valid disposable identity; the focused discovery regression test supplies synthetic identity without opening a browser or database. Never supply QA credentials or port 3101. Legacy execution additionally needs its own synthetic role/fixture preparation inside a validated isolated environment; the nine-case runner does not prepare or execute those suites. Discovery is not a legacy execution pass.

The controller snapshots tracked working files plus its explicit harness file list. Ignored/untracked local application data is not copied. It records source hashes and any tracked working changes, builds a public-base harness image with lockfile dependencies, generates Prisma, and compiles Next in production mode. No previous node_modules, build output or tool image is reused as an input. Ordinary Docker layer caching is permitted. The production Dockerfile and application source are unchanged.

## Isolation and configuration

The controller generates a fresh project identity, database password, signing secret and available loopback app port (32000-49000). Docker's bind-conflict check is final; a collision fails closed. Only PostgreSQL and one test container start, sharing the disposable PostgreSQL namespace. PostgreSQL listens on internal loopback 55432, without a published database port. The app port is loopback-only. The project network is internal; PostgreSQL uses tmpfs with no persistent volume. The Compose file is the configuration template: all required identity values are generated, not supplied through `.env`. Remote Docker contexts and inherited application overrides are refused or discarded.

Before migrations or fixture writes, the controller verifies actual project/network/tmpfs/port identity, and the worker checks the guard plus the actual database name, user, port and zero public tables. Only synthetic reference records and five users are seeded. Credentials live in container tmpfs; browser state and reports contain synthetic data only. Neither preserved QA/3101 nor production is contacted.

The guard rejects missing identity, protected/QA/production origins, ports outside the guarded range, noncanonical ports, unexpected database/user/host/port, URL options and alternate database/Node/dotenv overrides. Acceptance helpers also require this identity before collection. This entry point is intentionally limited to the nine critical cases; it does not authorize direct execution of legacy database integration suites or other operational scripts.

## Nine cases and synchronization

Six real-login/Server Action registration cases cover own-branch defaults, cross-branch refusal, unassigned staff, admin missing/explicit branch and inactive branch. Three legacy CSV cases cover assigned, unassigned and inactive-branch admins, with database assertions. No business assertion is replaced or weakened. Navigation first waits for React streaming boundary templates and hidden streamed containers to disappear, then `toHaveCount(1)` requires one fullName field. This avoids a transient count of one before a streamed copy arrives. Persistent streaming/duplication fails; timeouts are not swallowed. Playwright retries are fixed at zero. The final report must contain exactly nine passing cases, zero skipped/unexpected/flaky results.

This is not the complete role/workflow suite, a ClamAV/MinIO/backup test or full operational readiness/deployment approval. No clinical or permission code is changed.

## Security-candidate cross-check

From a clean committed harness checkout, make the application commit available locally (for PR #8, a fresh clone can run `git fetch origin codex/security-release-m04`), then use the same entry point:

```sh
node scripts/acceptance/run.cjs --app-ref 84c64c7d8545da291b59e998e44e999945249a4a
```

Only a full local commit SHA is accepted. The controller exports that application commit and overlays the explicit harness file list from its own committed HEAD in a temporary source snapshot. No branch is merged, rewritten or checked out by this command. Inputs record both exact commits and every source hash. The application package/lock, src, public and Prisma files remain those of the requested application commit; the security patch is not added to the harness branch. No undocumented external test modification is used.

## Evidence and cleanup

Each run writes a new ignored directory `release-evidence/acceptance-run/<generated-id>/`: build.log, worker.log, inputs.json, image.json, isolation.json, database-before-writes.json, runtime.json, acceptance-results.json, app.log, before/after QA snapshots and completion.json. Failure traces/screenshots and synthetic login states remain in that same run directory; later runs never reuse or erase it. Never commit or publish browser state or raw private evidence.

`finally` verifies generated container IDs/project labels against the pre-existing inventory, then removes only this run's containers/network and its freshly created source snapshot. It verifies QA IDs/images/start times/mounts/networks and the volume inventory are unchanged. No volume, retained image or build cache is deleted. Images use a unique per-run tag and are retained. A killed host process can leave temporary resources; record the exact project from the console, inspect only that label and confirm its identity before itemized cleanup. Never use global prune or operate on another project.
