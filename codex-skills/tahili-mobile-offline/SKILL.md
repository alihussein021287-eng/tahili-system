---
name: tahili-mobile-offline
description: Plan, implement, review, and test Tahili Mobile as a secure local-first React Native and Expo application. Use for changes under apps/mobile, shared mobile contracts, /api/mobile/v1 Route Handlers, device authentication, encrypted offline storage, read-only synchronization, local Android builds, or future offline-write proposals.
---

# Tahili Mobile Offline

Build Tahili Mobile without weakening the web system's medical, role, permission,
environment, or privacy boundaries. Treat the Tahili server as the only source of
truth and the device database as an expiring read cache.

## Read the governing context

Work from `/tahili-system`. Before planning or changing code, read:

- `AGENTS.md`, `SYSTEM_MAP.md`, `ROLES_PERMISSIONS.md`, and
  `ACCEPTANCE_MATRIX.md`
- `ENVIRONMENTS.md` and `OFFLINE_DEPLOYMENT.md`
- `docs/USER_ROLE_GUIDE_AR.md`, `docs/ROLE_PERMISSION_MATRIX_AR.md`, and
  `docs/ROLE_WORKFLOW_HANDOFFS_AR.md`
- `docs/MEDICAL_WORKFLOW_BOUNDARIES.md`,
  `docs/OBSERVABILITY_ARCHITECTURE.md`, and
  `docs/OBSERVABILITY_PRIVACY_POLICY.md`
- `docs/MOBILE_ARCHITECTURE.md`, `docs/MOBILE_OFFLINE_SYNC.md`,
  `docs/MOBILE_SECURITY_PRIVACY.md`,
  `docs/MOBILE_DEVELOPMENT_RUNBOOK.md`, and
  `docs/MOBILE_ACCEPTANCE_MATRIX.md`
- `docs/specs/MOBILE_DEVICE_SESSION_SCHEMA_REQUEST.md` and
  `docs/specs/MOBILE_PATIENT_SCOPE_POLICY_REQUEST.md`
- `src/lib/access.ts`, `src/lib/perms.ts`,
  `src/lib/patient-tab-policy.ts`, `src/lib/patient-tab-loader.ts`,
  `src/lib/patient-journey.ts`, and `src/lib/my-work.ts`

Inspect the current implementation narrowly. Do not infer access from a hidden
screen or from a role name.

## Preserve the architecture

- Keep the React Native and Expo client in `apps/mobile`.
- Put runtime-neutral Zod contracts in `packages/mobile-contracts`. Never import
  Prisma, Next.js, Node-only modules, secrets, or Server Actions into that
  package or the mobile bundle.
- Expose mobile data only through versioned Next.js Route Handlers under
  `/api/mobile/v1`. Never call a Next Server Action from the mobile client.
- Keep Prisma and authorization in server-only services. Each protected handler
  must verify the bearer session, active user, `authVersion`, device status,
  effective permissions, and branch/center/assignment scope before querying.
- Return explicit, minimal DTOs validated by shared output schemas. Use
  `Cache-Control: no-store` for authentication and medical responses.
- Keep development and production configuration separate. Read the API origin
  from controlled build/runtime configuration; do not hard-code an IP or
  domain in application logic.
- Build Android locally with Expo prebuild and the Android SDK/Gradle. Do not
  require Expo Go, EAS Build, EAS Update, Firebase, Sentry, or another cloud
  service. Keep iOS source-compatible; signed iOS builds require macOS, Xcode,
  and separately managed Apple signing.

## Apply the stop gates

Follow this order and stop at the first failed gate:

1. Inventory the affected roles, permissions, scopes, queries, DTOs, routes,
   native build prerequisites, and tests.
2. Complete a security review before installing dependencies.
3. Require durable per-device registration, rotating refresh credentials,
   replay detection, and per-device revocation. If the schema or durable store
   does not support them, write a separate approval request and stop.
4. Require one fail-closed server policy for patient access by branch, center,
   and assignment. If defining it changes operational access, write a separate
   functional request and stop.
5. Pin exact compatible Expo, React Native, native module, Gradle, and Android
   SDK versions. Run dependency, license, and vulnerability review before
   committing the lockfile.
6. Implement contracts and read-only APIs, then encrypted storage and sync,
   then screens.
7. Run all gates in `docs/MOBILE_ACCEPTANCE_MATRIX.md` before an APK is called
   acceptable.

Do not replace a failed gate with an in-memory registry, an unversioned JSON
file, a reused unrelated Prisma model, a mocked security claim, or a test that
does not exercise the native binary.

## Protect authentication and device state

- Keep the access credential short-lived and memory-only.
- Store only a rotating refresh credential in SecureStore/Keychain. Store only
  hashes server-side. Never store a password.
- Bind refresh rotation to one registered installation, reject reuse, and
  revoke the whole token family on replay.
- Retain only the hashes of consumed refresh generations until the family
  expires so exact replay remains detectable after restart. An unmatched random
  token must not revoke a family.
- Revalidate user activity, `authVersion`, permissions, and scope on every API
  request. Mobile-side routing is UX, not authorization.
- Rate-limit login, refresh, and sync. Audit registration, rotation, revocation,
  and aggregate sync results without usernames, patient identifiers, bodies,
  tokens, raw URLs, or clinical fields.
- Use only a proxy-minted, sanitized Request ID for error correlation.
- Give `/api/mobile/v1` an explicit proxy transport branch that preserves host
  validation and Request-ID replacement but never treats opaque bearer tokens
  as NextAuth JWTs. Keep endpoint authorization in the shared server guard and
  test that existing web cookie behavior is unchanged.
- Allow development cleartext only for the documented internal QA origin and
  synthetic QA accounts/data. Production builds must fail closed without
  trusted HTTPS and must not permit cleartext.

## Protect offline data

- Enable SQLCipher through the `expo-sqlite` config plugin and use a native
  development build; SQLCipher is not available in Expo Go.
- Generate a random 256-bit database key. Store it only in SecureStore/Keychain,
  apply it immediately after opening the database, and verify cipher support
  before reading schema data.
- Never use AsyncStorage, logs, crash reports, clipboard, screenshots, exported
  files, or unencrypted caches for medical data or credentials.
- Disable Android backup/device transfer for application data. Use
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` Keychain accessibility and an install
  sentinel on iOS; Phase 1 has no background sync.
- Cache the minimum fields and records needed for the user's current role and
  server-authorized scope. Attach `fetchedAt`, `expiresAt`, `scopeFingerprint`,
  and `recordVersion` to cached records or snapshots.
- On logout, expiry, refresh replay, revocation, account disablement, or scope
  invalidation, close the database, delete credentials and the encryption key,
  then remove the database, WAL/SHM, cache, and temporary files. Describe this
  as crypto-shredding, not guaranteed physical flash erasure.
- Make user-initiated logout wipe locally even when offline or server revocation
  fails. Never retain a refresh credential merely to retry logout later.

## Synchronize read-only data

- Keep Phase 1 business writes disabled. Reserved outbox metadata may exist only
  in the local SQLCipher schema for forward compatibility; it does not authorize
  a Prisma/server schema change. Enqueue and dispatch must reject every
  business-write type.
- Prefer an authoritative, bounded snapshot until the server has a reviewed
  change log and tombstone source. Stage and validate the complete snapshot,
  then swap it atomically; never replace a valid cache with a partial response.
- Include `snapshotId`, `generatedAt`, `expiresAt`, `scopeFingerprint`, schema
  version, and record versions. Delete cached records absent from the new
  authorized snapshot.
- Treat cursors as untrusted input, validate them with Zod, cap pages, sort
  deterministically, and reauthorize every page.
- Show connection state, last successful sync, staleness, and expiry. An offline
  lease cannot be extended without a successful server authorization.
- Do not use last-write-wins for future writes. Follow
  `docs/MOBILE_PHASE2_WRITE_PLAN.md` for idempotency, expected versions, and
  explicit conflict resolution.

## Add a screen or API safely

For each addition:

1. Identify the source web route/service, roles, permission keys, branch/center
   and assignment predicates, field sensitivity, record version, and TTL.
2. Add or revise a strict shared request/response schema first.
3. Add a server-only query that applies the access predicate inside the database
   query and selects only DTO fields.
4. Add the versioned Route Handler through the common mobile-auth wrapper.
5. Add contract, 401/403/503, scope, direct-ID, and response-projection tests.
6. Add the encrypted repository and expiry behavior before rendering the screen.
7. Add RTL, light/dark, phone/tablet, loading, empty, offline, stale, revoked,
   and retry states.
8. Run TypeScript, targeted web regression tests, mobile tests, native security
   tests, the route inventory, and network-destination checks.
9. Update only the relevant mobile architecture, sync, security, runbook, and
   acceptance sections.

## Prohibited without separate approval

- Production access, release, deployment, signing, or real medical data
- Prisma schema or migrations; role, permission, workflow, state-machine, or
  medical-field changes
- Offline dispensing, inventory, finance, approvals, user administration,
  deletion, override, final medical approval, or final file upload
- Copying PostgreSQL or a broad server dataset to the device
- DNS, Caddy, FRP, MikroTik, production services, or environment copying
- Cloud build/update/telemetry, external runtime endpoints, or remote fonts
- Secrets, credentials, signing keys, or fixed environment addresses in Git

Use synthetic QA data only. Keep commits phase-scoped and push only the feature
branch; never merge or deploy production without explicit approval.
