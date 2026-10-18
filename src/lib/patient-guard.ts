import { prisma } from "@/lib/db";
import { currentPerms, getSession } from "@/lib/access";
import { canAccessPatientRecord, patientAdministrativeWhere, patientScopeWhere } from "@/lib/patient-access";

/**
 * Server-side patient-specific authorization for actions that take a patient id.
 * - "record": clinical/operational work on the record; any authorized relationship counts (own branch, registering
 *   user, live handoff, referral, center relation, ADMIN).
 * - "administrative": edit, archive, restore, portal token, relatives, official documents; a live handoff or referral
 *   does NOT authorize these, only own active branch, the registering user, or ADMIN/central manager.
 * An operation permission is always checked separately by the caller.
 */
export async function assertPatientActionScope(patientId: string, kind: "record" | "administrative" = "record") {
  const session = await getSession();
  const user = session?.user as { id?: string; role?: any } | undefined;
  if (!user?.id || !patientId) throw new Error("غير مصرح");
  const actor = { userId: user.id, role: user.role, permissions: await currentPerms() };
  if (kind === "administrative") {
    const where = await patientAdministrativeWhere(prisma, actor);
    const found = await prisma.patient.findFirst({ where: { id: patientId, AND: [where] }, select: { id: true } });
    if (!found) throw new Error("غير مصرح");
    return;
  }
  if (!(await canAccessPatientRecord(prisma, actor, patientId))) throw new Error("غير مصرح");
}

/** For server-rendered patient pages (print, edit, report): not-found when the viewer has no authorized relationship. */
export async function requirePatientPageScope(patientId: string, kind: "record" | "administrative" = "record") {
  const { notFound } = await import("next/navigation");
  try {
    await assertPatientActionScope(patientId, kind);
  } catch {
    notFound();
  }
}

/** The signed-in viewer's patient record scope, for server-rendered pickers and lists. */
export async function currentPatientScope() {
  const session = await getSession();
  const user = session?.user as { id?: string; role?: any } | undefined;
  return patientScopeWhere(prisma, { userId: user?.id ?? "", role: user?.role, permissions: await currentPerms() });
}

/** Administrative (branch / registrar / central) patient scope for finance-style operations and pickers. */
export async function currentAdministrativePatientScope() {
  const session = await getSession();
  const user = session?.user as { id?: string; role?: any } | undefined;
  return patientAdministrativeWhere(prisma, { userId: user?.id ?? "", role: user?.role, permissions: await currentPerms() });
}

/** Finance guard: the invoice's patient must be inside the actor's administrative scope. */
export async function assertInvoiceScope(invoiceId: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { patientId: true } });
  if (!inv) return;
  await assertPatientActionScope(inv.patientId, "administrative");
}

/** Action guard for an optional patient reference taken from a form or an owning record. */
export async function assertOptionalPatientScope(patientId: string | null | undefined) {
  if (!patientId) return;
  await assertPatientActionScope(patientId, "record");
}

/**
 * Financial MUTATION scope (invoices, payments, expenses and their approvals): the patient must belong to the actor's own ACTIVE
 * branch. Registrar ownership, handoffs and the central-view manager do NOT widen it; only ADMIN keeps system-wide authority.
 * Reading finance lists keeps the existing administrative scope.
 */
export async function assertFinanceMutationScope(patientId: string | null | undefined) {
  const session = await getSession();
  const sessionUser = session?.user as { id?: string; role?: any } | undefined;
  if (!sessionUser?.id || !patientId) throw new Error("غير مصرح");
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } } });
  if (!user?.isActive || user.role !== sessionUser.role) throw new Error("غير مصرح");
  if (user.role === "ADMIN") return;
  if (user.branchId == null || !user.branch?.isActive) throw new Error("غير مصرح: لا يوجد فرع فعّال للعملية المالية");
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { branchId: true } });
  if (!patient || patient.branchId !== user.branchId) throw new Error("غير مصرح: العملية المالية خارج فرعك");
}

/** Branch that financially owns an invoice: the visit's receiving branch when an explicit visit is attached, else the patient's home branch. */
export function invoiceOwnerBranch(inv: { visitId: string | null; visit?: { branchId: number | null } | null; patient?: { branchId: number | null } | null }) {
  return inv.visitId ? inv.visit?.branchId ?? null : inv.patient?.branchId ?? null;
}

export async function assertInvoiceMutationScope(invoiceId: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { patientId: true, visitId: true, visit: { select: { branchId: true } }, patient: { select: { branchId: true } } } });
  if (!inv) throw new Error("الفاتورة غير موجودة");
  const session = await getSession();
  const sessionUser = session?.user as { id?: string; role?: any } | undefined;
  if (!sessionUser?.id) throw new Error("غير مصرح");
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } } });
  if (!user?.isActive || user.role !== sessionUser.role) throw new Error("غير مصرح");
  if (user.role === "ADMIN") return;
  const owner = invoiceOwnerBranch(inv);
  if (user.branchId == null || !user.branch?.isActive || owner == null || owner !== user.branchId) throw new Error("غير مصرح: الفاتورة تتبع فرعاً آخر");
}

/** Billing a specific visit: the visit must be received by the actor's own active branch (ADMIN excepted). Returns the visit's patient. */
export async function assertVisitBillingScope(visitId: string) {
  const session = await getSession();
  const sessionUser = session?.user as { id?: string; role?: any } | undefined;
  if (!sessionUser?.id || !visitId) throw new Error("غير مصرح");
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } } });
  if (!user?.isActive || user.role !== sessionUser.role) throw new Error("غير مصرح");
  const visit = await prisma.visit.findUnique({ where: { id: visitId }, select: { id: true, patientId: true, branchId: true, branch: { select: { isActive: true } } } });
  if (!visit || visit.branchId == null || !visit.branch?.isActive) throw new Error("الزيارة غير صالحة للفوترة");
  if (user.role !== "ADMIN" && (user.branchId == null || !user.branch?.isActive || user.branchId !== visit.branchId)) throw new Error("غير مصرح: الزيارة مسجلة في فرع آخر");
  return { visitId: visit.id, patientId: visit.patientId, branchId: visit.branchId };
}

/**
 * Which invoices the viewer may SEE. Central/ADMIN keep the existing administrative reading scope. Everyone else sees invoices owned
 * by their own active branch: visit invoices whose visit was received there, and visit-less invoices of patients inside their
 * administrative scope. An invoice for a visit at another branch stays invisible even for the patient's home branch.
 */
export async function invoiceViewWhere(): Promise<import("@prisma/client").Prisma.InvoiceWhereInput> {
  const session = await getSession();
  const u = session?.user as { id?: string; role?: any } | undefined;
  if (!u?.id) return { id: "__no_scope__" };
  const actor = { userId: u.id, role: u.role, permissions: await currentPerms() };
  const adminWhere = await patientAdministrativeWhere(prisma, actor);
  if (Object.keys(adminWhere).length === 0) return {};
  const me = await prisma.user.findUnique({ where: { id: u.id }, select: { isActive: true, branchId: true, branch: { select: { isActive: true } } } });
  const branchId = me?.isActive && me.branchId != null && me.branch?.isActive ? me.branchId : null;
  return { OR: [{ visitId: null, patient: adminWhere }, ...(branchId != null ? [{ visit: { branchId } }] : [])] };
}

export async function requireInvoiceReadScope(invoiceId: string) {
  const { notFound } = await import("next/navigation");
  const found = await prisma.invoice.findFirst({ where: { id: invoiceId, AND: [await invoiceViewWhere()] }, select: { id: true } });
  if (!found) notFound();
}

export async function assertExpenseMutationScope(expenseId: string) {
  const row = await prisma.woundedExpense.findUnique({ where: { id: expenseId }, select: { patientId: true } });
  if (!row) throw new Error("الصرفية غير موجودة");
  await assertFinanceMutationScope(row.patientId);
}

/**
 * Record scope WITHOUT the central-manager shortcut: used where a manager must be tied to a branch or an explicit operational
 * relationship (medical-report print/approval). ADMIN keeps system-wide access; everyone else needs own-branch patients,
 * the registering user, a live handoff/referral/center relation.
 */
export async function assertBranchBoundRecordScope(patientId: string) {
  const session = await getSession();
  const user = session?.user as { id?: string; role?: any } | undefined;
  if (!user?.id || !patientId) throw new Error("غير مصرح");
  const permissions = new Set(await currentPerms());
  if (user.role === "MANAGER") permissions.delete("centers.central.view");
  if (!(await canAccessPatientRecord(prisma, { userId: user.id, role: user.role, permissions }, patientId))) throw new Error("غير مصرح");
}

export async function requireBranchBoundPageScope(patientId: string) {
  const { notFound } = await import("next/navigation");
  try { await assertBranchBoundRecordScope(patientId); } catch { notFound(); }
}
