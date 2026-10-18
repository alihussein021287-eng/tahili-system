import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/access";
import { baghdadDayRange } from "@/lib/display-utils";

/**
 * Prescription → pharmacy relationship under INDEPENDENT BRANCH PHARMACIES.
 *
 * A prescription is dispensable only at the pharmacy of its ORIGIN branch (Prescription.originBranchId):
 *  - the receiving branch of the patient's verified visit of the same day when one exists, otherwise
 *  - the issuing clinician's active branch.
 * The patient's home branch is never used as a dispensing location. A prescription with no origin (legacy) is
 * UNASSIGNED and requires reconciliation. The acting pharmacist must belong to an ACTIVE branch equal to that origin;
 * an effective permission alone never authorizes, and ADMIN has no bypass for stock-changing operations.
 */
export type PharmacyActor = { userId: string; role: UserRole };

async function activeBranch(actor: PharmacyActor) {
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } },
  });
  if (!user?.isActive || user.role !== actor.role) return null;
  if (user.branchId == null || !user.branch?.isActive) return null;
  return user.branchId;
}

/** Patients with at least one prescription originating at the actor's branch (read visibility; ADMIN sees all, read-only). */
export async function pharmacyPatientWhere(actor: PharmacyActor): Promise<Prisma.PatientWhereInput> {
  const none: Prisma.PatientWhereInput = { id: "__no_pharmacy_scope__" };
  if (actor.role === "ADMIN") {
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { isActive: true, role: true } });
    return user?.isActive && user.role === "ADMIN" ? {} : none;
  }
  const branchId = await activeBranch(actor);
  if (branchId == null) return none;
  return { prescriptions: { some: { originBranchId: branchId } } };
}

export async function currentPharmacyActor(): Promise<PharmacyActor | null> {
  const session = await getSession();
  const user = session?.user as { id?: string; role?: UserRole } | undefined;
  return user?.id && user.role ? { userId: user.id, role: user.role } : null;
}

export async function currentPharmacyPatientWhere(): Promise<Prisma.PatientWhereInput> {
  const actor = await currentPharmacyActor();
  return actor ? pharmacyPatientWhere(actor) : { id: "__no_pharmacy_scope__" };
}

/** Prescription filter of the viewer's pharmacy queue/history (ADMIN: all, read-only). */
export async function pharmacyPrescriptionWhere(): Promise<Prisma.PrescriptionWhereInput> {
  const actor = await currentPharmacyActor();
  if (!actor) return { id: "__no_pharmacy_scope__" };
  if (actor.role === "ADMIN") return {};
  const branchId = await activeBranch(actor);
  if (branchId == null) return { id: "__no_pharmacy_scope__" };
  // Legacy EXTERNAL (print-only, no stock effect) prescriptions without origin stay visible to the patient's home branch;
  // INTERNAL ones without origin are unassigned and visible to nobody but ADMIN until reconciled.
  return { OR: [{ originBranchId: branchId }, { originBranchId: null, prescriptionType: { not: "INTERNAL" }, patient: { branchId } }] };
}

export async function canPharmacyActOnPatient(actor: PharmacyActor, patientId: string) {
  const where = await pharmacyPatientWhere(actor);
  return !!(await prisma.patient.findFirst({ where: { id: patientId, AND: [where] }, select: { id: true } }));
}

export const PHARMACY_SCOPE_ERROR = "هذه الوصفة خارج نطاق صيدلية فرعك";
export const PHARMACY_UNASSIGNED_ERROR = "الوصفة غير مرتبطة بفرع صيدلية (تحتاج مطابقة قبل الصرف)";

/** May this actor act (dispense / reject / reopen) on the prescription? Origin branch must equal the actor's active branch. */
export async function assertPharmacyPrescriptionScope(prescriptionId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const actor = await currentPharmacyActor();
  if (!actor) throw new Error("غير مصرّح");
  const rx = await db.prescription.findUnique({ where: { id: prescriptionId }, select: { originBranchId: true } });
  if (!rx) throw new Error("الوصفة غير موجودة");
  if (rx.originBranchId == null) throw new Error(PHARMACY_UNASSIGNED_ERROR);
  const branchId = await activeBranch(actor);
  if (branchId == null || branchId !== rx.originBranchId) throw new Error(PHARMACY_SCOPE_ERROR);
  return { branchId };
}

export type BranchResolution = { branchId: number | null; basis: string; detail: string };

async function activeBranchOfUser(tx: Prisma.TransactionClient | typeof prisma, userId: string | undefined) {
  if (!userId) return null;
  const u = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true, branchId: true, branch: { select: { isActive: true } } } });
  return u?.isActive && u.branchId != null && u.branch?.isActive ? u.branchId : null;
}

/** Distinct ACTIVE receiving branches of the patient's visits of the current (Baghdad) day. */
async function todaysVisitBranches(tx: Prisma.TransactionClient | typeof prisma, patientId: string) {
  const { start, end } = baghdadDayRange(new Date());
  const visits = await tx.visit.findMany({
    where: { patientId, visitDate: { gte: start, lt: end }, branchId: { not: null }, branch: { isActive: true } },
    select: { branchId: true },
  });
  return [...new Set(visits.map((v) => v.branchId as number))];
}

/**
 * Provenance of a NEW prescription. There is no explicit prescription→visit column, so evidence is combined fail-closed:
 *  1. visits of the patient today in exactly ONE receiving branch  -> that branch (a clinician of another branch who documents an
 *     authorized visit there still originates at the visit's branch);
 *  2. visits today in SEVERAL branches -> the issuer's active branch only if it is one of them, otherwise AMBIGUOUS (null);
 *  3. no visit today -> the issuer's active branch (addPrescription is already guarded by clinical.prescription and the patient
 *     record scope of that branch), else null.
 * The patient's home branch is never used. Null = unassigned: not dispensable until reconciled.
 */
export async function resolvePrescriptionOriginDetailed(
  tx: Prisma.TransactionClient | typeof prisma, patientId: string, issuerId: string | undefined,
): Promise<BranchResolution> {
  const [visitBranches, issuerBranch] = await Promise.all([todaysVisitBranches(tx, patientId), activeBranchOfUser(tx, issuerId)]);
  if (visitBranches.length === 1) return { branchId: visitBranches[0], basis: "VISIT_RECEIVING_BRANCH", detail: "زيارة اليوم في فرع استقبال واحد" };
  if (visitBranches.length > 1) {
    if (issuerBranch != null && visitBranches.includes(issuerBranch)) return { branchId: issuerBranch, basis: "ISSUER_BRANCH_AMONG_VISITS", detail: "زيارات اليوم في أكثر من فرع؛ فرع الطبيب المُصدِر أحدها" };
    return { branchId: null, basis: "AMBIGUOUS_MULTI_BRANCH_VISITS", detail: "للمراجع زيارات اليوم في أكثر من فرع وفرع الطبيب ليس بينها؛ لا يمكن تحديد صيدلية المنشأ" };
  }
  if (issuerBranch != null) return { branchId: issuerBranch, basis: "ISSUER_ACTIVE_BRANCH", detail: "لا زيارة اليوم؛ فرع الطبيب المُصدِر الفعّال" };
  return { branchId: null, basis: "NO_EVIDENCE", detail: "لا زيارة اليوم والطبيب بلا فرع فعّال؛ لا يمكن تحديد صيدلية المنشأ" };
}

export async function resolvePrescriptionOrigin(
  tx: Prisma.TransactionClient | typeof prisma, patientId: string, issuerId: string | undefined,
): Promise<number | null> {
  return (await resolvePrescriptionOriginDetailed(tx, patientId, issuerId)).branchId;
}

/**
 * Branch whose stock a care/dressing consumption may debit: the recorder's ACTIVE branch, only when no reliable service-location
 * evidence contradicts it (today's visits of the patient do not exclude that branch). A contradiction or a missing branch yields
 * null (fail closed: the care record is kept, stock is not touched, the recorder is told why).
 */
export async function resolveCareExecutionBranch(
  tx: Prisma.TransactionClient | typeof prisma, patientId: string, recorderId: string | undefined,
): Promise<BranchResolution> {
  const [visitBranches, recorderBranch] = await Promise.all([todaysVisitBranches(tx, patientId), activeBranchOfUser(tx, recorderId)]);
  if (recorderBranch == null) return { branchId: null, basis: "RECORDER_WITHOUT_ACTIVE_BRANCH", detail: "المستخدم بلا فرع فعّال؛ لم يُخصم من المخزون" };
  if (visitBranches.length > 0 && !visitBranches.includes(recorderBranch)) {
    return { branchId: null, basis: "SERVICE_LOCATION_CONTRADICTS_RECORDER_BRANCH", detail: "زيارة المراجع اليوم في فرع آخر غير فرع المسجِّل؛ لم يُخصم من مخزون أي فرع" };
  }
  return { branchId: recorderBranch, basis: visitBranches.length ? "VISIT_BRANCH_MATCHES_RECORDER" : "RECORDER_ACTIVE_BRANCH", detail: "فرع المسجِّل الفعّال" };
}

type MovementLike = { patientId: string | null; patientName: string | null };

/**
 * Stock movements keep a patient name snapshot. Patient identity is shown only for prescriptions of the viewer's own
 * pharmacy (ADMIN sees all). With `dropOutOfScope` the row is removed instead (used for patient-name searches).
 */
export async function maskOutOfScopeMovements<T extends MovementLike>(rows: T[], dropOutOfScope = false): Promise<T[]> {
  const actor = await currentPharmacyActor();
  if (!actor) return rows.map((r) => ({ ...r, patientId: null, patientName: null }));
  if (actor.role === "ADMIN") return rows;
  const ids = [...new Set(rows.map((r) => r.patientId).filter((id): id is string => !!id))];
  if (!ids.length) return rows;
  const where = await pharmacyPatientWhere(actor);
  const allowed = new Set((await prisma.patient.findMany({ where: { id: { in: ids }, AND: [where] }, select: { id: true } })).map((p) => p.id));
  const out: T[] = [];
  for (const row of rows) {
    if (!row.patientId || allowed.has(row.patientId)) { out.push(row); continue; }
    if (dropOutOfScope) continue;
    out.push({ ...row, patientId: null, patientName: null });
  }
  return out;
}

export type VerifiedVisit = { visitId: string; branchId: number; basis: string };
export type VisitEvaluation = ({ ok: true } & VerifiedVisit) | { ok: false; reason: string };

/**
 * Is this exact Visit a valid clinical context for a NEW dispensable prescription by this prescriber? (owner decision: explicit
 * Visit, no arbitrary age cutoff). The Visit table has no completed/cancelled state, so eligibility rests on the lifecycle states
 * that DO exist:
 *  - exact Visit of the SAME patient with a trusted (active) receiving branch;
 *  - authorized prescriber: the prescriber's active branch is the visit's branch, or the prescriber holds a LIVE handoff
 *    (SENT/ACCEPTED) of this patient (explicit clinical responsibility, also across branches);
 *  - and the encounter is in force: it is today's encounter (check-in day), OR responsibility is live (live handoff, or an
 *    ADMITTED stay at the prescriber's branch) AND no newer visit of the patient exists at that branch (a superseded visit is
 *    historical). A finished handoff (DONE/cancelled) ends the ongoing context; the way forward is a follow-up Visit.
 * Origin pharmacy = the visit's branch. Nothing is inferred from patient + date.
 */
export async function evaluatePrescriptionVisit(
  tx: Prisma.TransactionClient | typeof prisma, patientId: string, visitId: string | null | undefined, issuerId: string | undefined,
): Promise<VisitEvaluation> {
  const no = (reason: string): VisitEvaluation => ({ ok: false, reason });
  if (!visitId) return no("اختر الزيارة التي تخص هذه الوصفة؛ إن لم توجد زيارة مناسبة سجّل زيارة متابعة أولاً");
  if (!issuerId) return no("غير مصرّح");
  const visit = await tx.visit.findFirst({ where: { id: visitId, patientId }, select: { id: true, visitDate: true, branchId: true, branch: { select: { isActive: true } } } });
  if (!visit) return no("الزيارة المختارة لا تخص هذا المراجع");
  if (visit.branchId == null || !visit.branch?.isActive) return no("الزيارة بلا فرع استقبال فعّال؛ سجّل زيارة متابعة");
  const issuerBranch = await activeBranchOfUser(tx, issuerId);
  const liveHandoff = !!(await tx.patientHandoff.findFirst({ where: { patientId, status: { in: ["SENT", "ACCEPTED"] }, OR: [{ toUserId: issuerId }, { acceptedById: issuerId }] }, select: { id: true } }));
  if (issuerBranch !== visit.branchId && !liveHandoff) return no("الزيارة خارج سياقك السريري المصرّح به (فرع آخر دون إسناد قائم لك)");
  const { start, end } = baghdadDayRange(new Date());
  if (visit.visitDate >= start && visit.visitDate < end) return { ok: true, visitId: visit.id, branchId: visit.branchId, basis: "ENCOUNTER_TODAY" };
  const admitted = issuerBranch === visit.branchId && !!(await tx.admission.findFirst({ where: { patientId, status: "ADMITTED" }, select: { id: true } }));
  if (!liveHandoff && !admitted) return no("لا مسؤولية سريرية قائمة عن هذه الزيارة (التسليم مكتمل أو غير موجود)؛ سجّل زيارة متابعة");
  const latest = await tx.visit.findFirst({ where: { patientId, branchId: visit.branchId }, orderBy: [{ visitDate: "desc" }, { id: "desc" }], select: { id: true } });
  if (latest?.id !== visit.id) return no("توجد زيارة أحدث لهذا المراجع في الفرع نفسه؛ الزيارة المختارة صارت تاريخية");
  return { ok: true, visitId: visit.id, branchId: visit.branchId, basis: liveHandoff ? "ONGOING_LIVE_HANDOFF" : "ONGOING_ADMISSION" };
}

export async function verifyPrescriptionVisit(
  tx: Prisma.TransactionClient | typeof prisma, patientId: string, visitId: string | null | undefined, issuerId: string | undefined,
): Promise<VerifiedVisit> {
  const r = await evaluatePrescriptionVisit(tx, patientId, visitId, issuerId);
  if (r.ok === false) throw new Error(r.reason);
  return r;
}

/** Visits of the patient that currently qualify as a prescription context for this prescriber (for the form's selector). */
export async function eligiblePrescriptionVisitIds(tx: Prisma.TransactionClient | typeof prisma, patientId: string, issuerId: string | undefined) {
  const visits = await tx.visit.findMany({ where: { patientId }, orderBy: [{ visitDate: "desc" }, { id: "desc" }], take: 30, select: { id: true } });
  const out: string[] = [];
  for (const v of visits) if ((await evaluatePrescriptionVisit(tx, patientId, v.id, issuerId)).ok) out.push(v.id);
  return out;
}
