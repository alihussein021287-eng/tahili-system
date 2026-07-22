# ADR-002: Tokenized theme and approved reference-data synchronization

**Status:** Accepted
**Date:** 2026-07-23
**Affects:** AppShell, shared UI, print/viewers, settings lookups, pharmacy catalog, deployment

## Context

Dark mode currently depends on incomplete overrides for individual Tailwind colors. The two databases also differ in reference lookups, and development contains acceptance fixtures that cannot be promoted. Numeric IDs differ between environments and medicine quantities have no trusted transferable ledger.

## Decision

Use semantic CSS variables as the theme contract, with a bounded compatibility layer for existing utility classes. Store `light`, `dark`, or `system`, resolve it before hydration, and keep print/document surfaces explicitly white.

Use versioned TypeScript reference definitions and an idempotent operator script. Match simple lookups by normalized name and center halls by center + hall names. Create missing medicine catalog rows at zero stock, preserve all existing stock fields, reject QA-like source names, and record one counts-only audit event per apply.

## Options Considered

| Option | Pros | Cons | Operational impact |
| --- | --- | --- | --- |
| Edit every route color | Precise per screen | Large regression surface and duplication | Slow rollout |
| Token layer plus legacy compatibility | Central, incremental, covers all routes | Compatibility selectors remain temporarily | No schema change |
| Copy development database rows/IDs | Simple transfer | Copies QA and breaks ID independence | Rejected |
| Approved natural-key sync | Repeatable and reviewable | Renames require explicit catalog review | Dry-run then transaction |

## Consequences

- Positive: consistent themes, no hydration flash, deterministic cross-environment reference subset.
- Negative: legacy utility mappings remain until screens migrate fully to semantic classes.
- Follow-up: import real branches and stock only from an approved source; never infer quantities.

## Validation

- Theme unit tests, shared-color guard, TypeScript, Vitest, build, and LAN-IP Playwright on desktop/mobile.
- Reference dry-run, apply, repeat dry-run, final counts, QA exclusion, and zero-created-stock checks in both environments.
