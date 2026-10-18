# Decision 2026-10-17 — Pharmacy operations and dispensing are part of V1

Status: owner-approved (Mission 08.6 directive). Supersedes, for the approved existing pharmacy and dispensing workflows only,
earlier statements that treated pharmacy fulfilment as outside V1. Earlier decision entries are not rewritten.

## In V1
Eligible internal prescription processing; authorized dispensing; correct stock quantities; dispensing lifecycle (PENDING →
PARTIAL → DISPENSED, REJECTED); reject; medication history with authorized visibility; audit and transactional integrity;
branch/organizational authorization; workflow notifications and stock handling.

## Not decided by this entry (kept as before, classified separately)
Cross-branch dispensing as a general capability; a per-branch stock location model; returns; purchasing/accounting extensions;
any pharmacy capability not already approved and implemented.

## Implemented authorization contract (minimum, restrictive)
An effective `pharmacy.*` permission alone no longer authorizes acting on a prescription. The actor must be an ACTIVE pharmacist
(or ADMIN) whose ACTIVE branch equals the patient's home branch or the receiving branch recorded on one of the patient's
visits. Branchless, inactive-branch, other-branch and role-mismatched sessions are refused; ADMIN keeps administrative access.
Evidence: `src/lib/pharmacy-scope.ts`, `tests/integration/pharmacy-scope-db.test.ts`, `release-evidence/e2e-pharmacy-v1.cjs`.

## Open owner decision (privilege-expanding, therefore NOT implemented)
`Prescription` carries no visit or branch link and `MedicationBatch` carries no stock location, so stock is one shared store and
a prescription is tied to a pharmacy only through its patient. If stock must be owned per branch/pharmacy, a stock-location
relation and a data migration of existing batches are required; a central pharmacy serving several branches needs an explicit
authority record. Neither is invented here.
