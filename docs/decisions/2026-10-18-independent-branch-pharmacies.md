# Decision 2026-10-18 — Every branch has its own independent pharmacy and medication stock

Status: owner-approved (Mission 08.7 directive). Supersedes the shared-stock implementation and the open "per-branch stock
location" question of `2026-10-17-pharmacy-v1-included.md` (that entry is not rewritten). Pharmacy dispensing stays INCLUDED in V1.

## Policy
- Each active branch owns its inventory: independent quantities, batches, expiry dates and stock movements.
- Dispensing in Branch B debits only Branch B. There is no borrowing, pooling, transfer or automatic rebalancing between branches,
  no central pool, no negative stock, no expired dispensing; FEFO applies inside the authorized branch's stock only.
- The patient's home branch is NOT the dispensing branch. A prescription's pharmacy is its ORIGIN branch: the receiving branch of
  the patient's visit of the same day when one exists, otherwise the issuing clinician's active branch. Nothing is guessed from
  `patient.branchId`, medication names, staff names or free text.
- Dispensing requires the pharmacist's verified ACTIVE branch to equal the prescription origin branch plus effective pharmacy
  permissions. ADMIN may VIEW all branches (read-only) but has no bypass for any stock-changing operation.
- Purchase orders carry a destination branch; only a pharmacist of that branch can receive, and received batches/movements belong
  to that branch.
- Every stock change records branch, actor, operation, quantity and reason.

## Model (additive migration `20261018090000_branch_pharmacy_stock`)
| Table | Added |
| --- | --- |
| `medication_batches` | `branchId` (NULL = UNASSIGNED legacy), index `(branchId, medicationId)`, CHECK `quantity >= 0` |
| `stock_movements` | `branchId`, `actorId`, index `(branchId, createdAt)` |
| `prescriptions` | `originBranchId`, `dispensingBranchId`, index `(originBranchId, status)` |
| `purchase_orders` | `branchId` (destination) |

`Medication` stays a shared catalog (name, unit, reorder threshold). `Medication.quantity` is kept only as a legacy all-branch
aggregate and is never shown to branch accounts; displayed quantities are sums of the viewer's branch batches.

## Legacy shared stock (no fabricated distribution)
Existing batches, prescriptions and purchase orders keep `NULL` branch = UNASSIGNED / REQUIRES_RECONCILIATION. They are not
dispensable by ordinary pharmacists and are not shown to branch accounts. They become branch stock only through the operator
procedure `scripts/pharmacy-branch-stock.cjs` (dry-run by default, verified physical count, audit record, movement reason
`OPENING_BALANCE` / `RECONCILIATION`). The software never assigns a quantity or splits a batch by guessing.

## Not approved (not built)
Central pharmacy pool, inter-branch transfer, central dispensing for branchless users, automatic rebalancing, dispensing another
branch's prescription, a procurement/accounting system.

## Minimal decisions still needed from the owner
1. Opening stock: verified physical counts per branch pharmacy before go-live (data, not software).
2. Branch manager approval of purchase orders is bound to the same branch; a branchless central manager cannot approve a branch
   order. Say if a central approver role is wanted (privilege-expanding, therefore not implemented).

## Addendum 2026-10-16 (Mission 08.7-F) — origin and care-consumption evidence rules
There is no explicit prescription→visit column; the stored evidence is combined fail-closed (`src/lib/pharmacy-scope.ts`):
1. Visits of the patient on the same day in exactly ONE receiving branch → that branch (also when the issuer belongs to another branch).
2. Same-day visits in SEVERAL branches → the issuer's active branch only if it is one of them; otherwise AMBIGUOUS → origin NULL.
3. No visit that day → the issuer's active branch (addPrescription is already guarded by `clinical.prescription` and the patient record scope).
4. Otherwise NULL (unassigned): not dispensable; the issuer receives a notification with the exact reason; audit records `originBasis`.
Care/dressing consumption debits the recorder's ACTIVE branch only when same-day visit evidence does not contradict it; a
contradiction, a branchless recorder, or a failure keeps the care record, touches no stock, and notifies the recorder (audit
`NOT_DEDUCTED` / `DEDUCTION_FAILED`). Movements carry `[dressing:<recordId>]`, branch and actor. Bulk patient import registers rows into
the importer's active branch (same rule as single registration).
