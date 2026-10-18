# Decision 2026-10-20 — Prescription Visit eligibility without a time cutoff; cross-branch finance by Visit (Mission 08.9)

Supersedes the 2-day Visit age rule of `2026-10-19-approved-v1-policies.md` (E) and the home-branch-only finance rule (C) for services
rendered in another branch. Everything else in that entry stands.

## Prescription Visit eligibility (no age cutoff, no invented replacement)
`Visit` has no completed/cancelled state, so eligibility rests on lifecycle states that exist (`evaluatePrescriptionVisit`):
1. the exact Visit ID of the SAME patient, with a trusted (active) receiving branch;
2. an authorized prescriber: own active branch = the visit's branch, or a LIVE handoff (SENT/ACCEPTED) of this patient to the prescriber (explicit clinical responsibility, also across branches);
3. the encounter is in force: it is today's check-in encounter, OR responsibility is live (live handoff, or an ADMITTED stay at the prescriber's branch) AND no newer visit of the patient exists at that branch (a superseded visit is historical).
A finished (DONE/cancelled) handoff or a discharged stay ends the ongoing context — the supported way forward is a follow-up Visit.
Treatment that continues for weeks therefore remains prescribable under its live responsibility; an old visit never becomes valid by itself.
Origin pharmacy = the visit's branch; dispensing revalidates visit, origin, pharmacist branch and local stock (unchanged).
**Genuine ambiguity kept fail-closed:** an explicit completed/cancelled state of a Visit does not exist. If the owner wants such states
(e.g. a visit closed at the end of the encounter) they need a field and a rule; until then closed handoffs/discharges are the only "completed" signal.

## Finance by Visit
`invoices.visitId` (additive, nullable; composite FK to `visits(id, patientId)`). An invoice that references a Visit is financially
owned by the visit's receiving branch; a visit-less invoice (legacy / patient-only) follows the patient's home branch — never guessed.
- Create: finance staff of the visit's branch pick a visit received in THEIR branch (the patient comes from the visit); a patient-only invoice still requires the patient's home branch.
- Mutate (payment, full payment, date change): only the owning branch (ADMIN excepted). Central managers and other branches are denied.
- See: an invoice is listed/printed/aggregated only for its owning branch (central/ADMIN keep the existing administrative reading scope). The home branch does not see invoices of services given elsewhere, and the accountant of the receiving branch gets no access to the patient's record or to the home branch's invoices.
- Expenses (wounded aid) are patient-level, not service-level: they remain scoped to the patient's home branch, with manager approval and separation of duties unchanged.
