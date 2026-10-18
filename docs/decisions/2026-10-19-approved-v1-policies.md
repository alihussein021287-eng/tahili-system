# Decision 2026-10-19 — Approved V1 policies (Mission 08.8)

Status: owner-approved. Earlier decision entries are not rewritten; where they conflict, this entry wins for the topics below.

## B. Medical report printing
Role families allowed to PRINT a patient's medical report: treating doctor/consultant (DOCTOR), RESIDENT, medical SECRETARY, authorized
MANAGER, ADMIN (THERAPIST keeps the print permission it already had). `reports.print` is necessary, never sufficient:
- the patient must be inside the actor's branch/relationship scope (**the central-manager shortcut does not apply**: a manager of
  another branch cannot print), ADMIN excepted;
- only a `READY_TO_PRINT` or `PRINTED_APPROVED` report opens; drafts and cancelled reports never print;
- every successful open is audited (`PRINT_VIEW`);
- printing grants no editing and no approval: marking a report printed/approved needs the separate permission
  `reports.medical.approve` (default MANAGER, ADMIN), a `READY_TO_PRINT` report, branch scope and a conditional state change.
Roles that could previously approve through `reports.print` alone (THERAPIST, RESIDENT) no longer can.

## C. Operational finance
Accountants record operations in their branch; the authorized branch manager approves. Every financial MUTATION (invoice, payment,
expense create/submit/approve/ready/pay/cancel/correct) now requires the patient to belong to the actor's own ACTIVE branch
(`assertFinanceMutationScope`); registrar ownership, handoffs and the central-view manager do not widen it (ADMIN keeps system
authority). Existing safeguards kept: creator cannot approve, distinct approvers per level, state checks, immutable approval rows,
audit, idempotent payment. Reading finance lists keeps the existing administrative scope (see open items).

## D. Historical clinician records
After a PatientHandoff in which the clinician took part is DONE, `/my-work/authored` lets the clinician READ ONLY records whose
stored author id equals their user id: `MedicalReport.doctorId`, `Prescription.createdById`, `SickLeave.createdById`. No patient file
opens, nothing is editable, authorship is never inferred from names, roles, branches or timing. Record families without a trustworthy
author column (Diagnosis, wounds, resident reviews, vitals, dressing/care, admissions, ...) stay fail-closed.

## E. Prescription belongs to a specific Visit
`prescriptions.visitId` (additive, nullable; composite FK `(visitId, patientId)` → `visits(id, patientId)`). A NEW internal
(dispensable) prescription must reference an explicit Visit chosen by the prescriber: same patient, active receiving branch, at most
2 days old, inside the prescriber's clinical context (own branch, or a live handoff of that patient). The pharmacy origin is the
visit's branch, never the home or issuer branch; no visit → no dispensable prescription (a follow-up Visit is the way to create
context). Dispensing revalidates visit, origin = visit branch = pharmacist's branch, pharmacist authorization and local stock.
Legacy prescriptions keep `visitId = NULL`: preserved, listed in history, never dispensable, reconcilable only with the audited CLI
`assign-prescription-visit`. No guessed backfill. External (print-only) prescriptions need no visit.

## F. Pharmacy purchase approval
Same-branch pharmacist creates; a manager of the SAME branch approves or rejects (rejection = cancellation with a mandatory reason,
recorded as an approver decision); the requester can neither approve nor see the approve control; decisions are conditional on the
current status (concurrent approvals produce one decision) and audited. Approval never changes stock; only a valid receipt by branch
staff creates the branch batch (batch, expiry, quantity, actor, movement). The approval request notice goes to the branch's managers.

## G/H/I. Staff, patients and Excel scope
Employee records and login accounts are separate; accounts are staged INACTIVE and only after approval. Patient duplicates require
name + phone + birth year; shared phones and missing birth years never merge or invent identity; every source row receives a
disposition. Appointments, sessions and Excel stock are excluded. Tooling: `scripts/import-preflight/` (read-only preflight,
guarded apply with plan-hash/database/branch approval). Nothing was imported.

## Open owner inputs
Canonical branch record "مجمع الرسول الاعظم التاهيلي" does not exist in the rehearsal databases (it must be created exactly once before
any import); the real Excel files were not available in the authorized workspace; central read access to finance lists; the
2-day visit freshness window (default chosen, owner may change `PRESCRIPTION_VISIT_MAX_AGE_DAYS`).
