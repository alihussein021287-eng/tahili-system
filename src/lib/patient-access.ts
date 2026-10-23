import { handoffRecipientScope } from '@/lib/handoff-recipient-scope';
import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { activeMembershipWhere, centerRoleForUserRole } from "@/lib/center-membership";
import { referralAccessScope } from "@/lib/referral-access";

export type PatientAccessActor = { userId: string; role: UserRole; permissions: ReadonlySet<string> };

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Who may open or list a patient RECORD (not mere identity lookup). Stored relationships only:
 * - ADMIN, or a manager holding the existing central view permission (existing administrative rule);
 * - the patient's branch is the viewer's own ACTIVE branch;
 * - the staff member who registered the patient (a patient with no branch is reachable only through this or a relation below);
 * - a live handoff (SENT/ACCEPTED) addressed to the viewer, accepted by the viewer, or to the viewer's center and role;
 * - a referral the viewer is authorized for (existing referral scope);
 * - an appointment or treatment plan at a center the viewer actively belongs to.
 * A missing branch, a matching role or a name never widens access.
 */
export async function patientScopeWhere(db: Db, actor: PatientAccessActor): Promise<Prisma.PatientWhereInput> {
  if (!actor.permissions.has("patients.view")) return { id: "__no_scope__" };
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } },
  });
  if (!user?.isActive || user.role !== actor.role) return { id: "__no_scope__" };
  if (actor.role === "ADMIN" || (actor.role === "MANAGER" && actor.permissions.has("centers.central.view"))) return {};

  const memberRole = centerRoleForUserRole(actor.role);
  const centerIds = memberRole
    ? (await db.centerMembership.findMany({ where: { userId: actor.userId, ...activeMembershipWhere(memberRole), center: { active: true } }, select: { centerId: true } })).map((m) => m.centerId)
    : [];

  // The staff member who registered the patient keeps access to that record (stored createdById).
  const or: Prisma.PatientWhereInput[] = [{ createdById: actor.userId }];
  if (user.branchId != null && user.branch?.isActive) or.push({ branchId: user.branchId });
  if (actor.permissions.has("handoff.receive")) {
    const eligible = handoffRecipientScope({ id: actor.userId, role: actor.role, branchId: user.branch?.isActive ? user.branchId : null }, centerIds);
    or.push({ handoffs: { some: { status: { in: ["SENT", "ACCEPTED"] }, AND: [eligible] } } });
  }
  if (actor.permissions.has("referrals.view")) {
    try {
      const referral = await referralAccessScope(db as typeof prisma, actor);
      or.push({ referralRequests: { some: referral.where } });
    } catch { /* no referral scope for this account */ }
  }
  if (centerIds.length) {
    or.push({ appointments: { some: { centerId: { in: centerIds } } } }, { treatmentPlans: { some: { centerId: { in: centerIds } } } });
  }
  return { OR: or };
}

export async function canAccessPatientRecord(db: Db, actor: PatientAccessActor, patientId: string): Promise<boolean> {
  const scope = await patientScopeWhere(db, actor);
  return !!(await db.patient.findFirst({ where: { id: patientId, AND: [scope] }, select: { id: true } }));
}

/** Identity lookup outside the viewer's scope: exact file number or exact phone only, minimal fields. */
export async function exactIdentifierLookup(db: Db, term: string, scope: Prisma.PatientWhereInput) {
  const value = term.trim();
  if (!value) return [];
  const asNumber = /^\d+$/.test(value) ? Number(value) : null;
  const identifiers: Prisma.PatientWhereInput[] = [{ phone: value }];
  if (asNumber != null && asNumber <= 2_147_483_647) identifiers.push({ fileNumber: asNumber });
  // NOT over nullable columns would silently drop rows with NULLs, so candidates are subtracted explicitly.
  const candidates = await db.patient.findMany({
    where: { archivedAt: null, OR: identifiers },
    select: { id: true, fullName: true, fileNumber: true },
    take: 10,
  });
  if (!candidates.length) return [];
  const inScope = new Set((await db.patient.findMany({
    where: { id: { in: candidates.map((c) => c.id) }, AND: [scope] },
    select: { id: true },
  })).map((r) => r.id));
  return candidates.filter((c) => !inScope.has(c.id)).slice(0, 5);
}

/**
 * Administrative operations on an existing patient (edit, archive, portal, relatives, official documents).
 * A live handoff or referral gives clinical visibility but not administrative authority.
 */
export async function patientAdministrativeWhere(db: Db, actor: PatientAccessActor): Promise<Prisma.PatientWhereInput> {
  if (!actor.permissions.has("patients.view")) return { id: "__no_scope__" };
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } },
  });
  if (!user?.isActive || user.role !== actor.role) return { id: "__no_scope__" };
  if (actor.role === "ADMIN" || (actor.role === "MANAGER" && actor.permissions.has("centers.central.view"))) return {};
  const or: Prisma.PatientWhereInput[] = [{ createdById: actor.userId }];
  if (user.branchId != null && user.branch?.isActive) or.push({ branchId: user.branchId });
  return { OR: or };
}

/**
 * Visits the viewer may see in operational lists and counters. A visit with a recorded receiving branch belongs to
 * that branch (including a verified cross-branch visit); a historical visit without one follows the patient scope.
 * Visibility of a visit never opens the patient record.
 */
export async function visitScopeWhere(db: Db, actor: PatientAccessActor): Promise<Prisma.VisitWhereInput> {
  if (!actor.permissions.has("patients.view") && !actor.permissions.has("visits.view")) return { id: "__no_scope__" };
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } },
  });
  if (!user?.isActive || user.role !== actor.role) return { id: "__no_scope__" };
  if (actor.role === "ADMIN" || (actor.role === "MANAGER" && actor.permissions.has("centers.central.view"))) return {};
  const patientScope = await patientScopeWhere(db, { ...actor, permissions: new Set([...actor.permissions, "patients.view"]) });
  const or: Prisma.VisitWhereInput[] = [{ branchId: null, patient: patientScope }];
  if (user.branchId != null && user.branch?.isActive) or.push({ branchId: user.branchId });
  return { OR: or };
}

/**
 * Role-wide notices (no named recipient) that point at a patient record are shown only to viewers who can access
 * that patient. Notices addressed to a named user, and notices with no patient link, are never filtered here.
 */
export async function filterRoleNoticesToPatientScope<T extends { targetUserId: string | null; link: string | null }>(
  db: Db, actor: PatientAccessActor, rows: T[],
): Promise<T[]> {
  const idOf = (row: T) => (row.targetUserId == null ? /^\/patients\/([^/?#]+)/.exec(row.link ?? "")?.[1] ?? null : null);
  const ids = [...new Set(rows.map(idOf).filter((id): id is string => !!id))];
  if (!ids.length) return rows;
  const scope = await patientScopeWhere(db, actor);
  const allowed = new Set((await db.patient.findMany({ where: { id: { in: ids }, AND: [scope] }, select: { id: true } })).map((p) => p.id));
  return rows.filter((row) => {
    const id = idOf(row);
    return id == null || allowed.has(id);
  });
}
