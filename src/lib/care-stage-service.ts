import type { Prisma, StageStatus, UserRole } from "@prisma/client";
import { loadPermissionsFromStore } from "@/lib/permission-store";
import { canAccessPatientRecord } from "@/lib/patient-access";
import { notifyRoleInTransaction, notifyUserInTransaction } from "@/lib/notify";
import { activeMembershipWhere, centerRoleForUserRole } from "@/lib/center-membership";

/** Confirmed and skipped stages are history and are never reopened. */
export const STAGE_TRANSITIONS: Record<StageStatus, readonly StageStatus[]> = {
  WAITING: ["IN_PROGRESS", "CONFIRMED", "SKIPPED"],
  IN_PROGRESS: ["WAITING", "CONFIRMED", "SKIPPED"],
  CONFIRMED: [],
  SKIPPED: [],
};

/** The station's own role confirms it; ADMIN/MANAGER may override; a stage without a role is open to any permitted user. */
export function canConfirmStage(userRole: string | undefined, stageRole: string | null | undefined): boolean {
  if (userRole === "ADMIN" || userRole === "MANAGER") return true;
  if (!stageRole) return true;
  return userRole === stageRole;
}

export type StageActor = { userId: string; role: UserRole; name?: string | null };

/**
 * Explicit clinical confirmation (or another legal status change) of ONE care stage.
 * Permission, patient scope and station responsibility are re-checked inside the transaction.
 * A repeat of the current status changes nothing. Handoff, queue and appointment states are never touched.
 */
export async function transitionCareStage(
  db: Prisma.TransactionClient,
  actor: StageActor,
  input: { patientId: string; stageId: string; to: StageStatus },
): Promise<{ changed: boolean; status: StageStatus }> {
  const permissions = await loadPermissionsFromStore(actor.userId, actor.role, {
    findRolePermissions: (role) => db.rolePermission.findMany({ where: { role } }),
    findUserPermissions: (userId) => db.userPermission.findMany({ where: { userId } }),
  });
  if (!permissions.has("journey.confirm")) throw new Error("غير مصرح");

  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { isActive: true, role: true } });
  if (!user?.isActive || user.role !== actor.role) throw new Error("غير مصرح");

  const stage = await db.careStage.findFirst({
    where: { id: input.stageId, patientId: input.patientId },
    select: { id: true, station: true, status: true, sequence: true, responsibleRole: true, responsibilityScope: true, responsibleCenterId: true, assignedUserId: true },
  });
  if (!stage) throw new Error("غير مصرح");
  const central = actor.role === "ADMIN" || (actor.role === "MANAGER" && permissions.has("centers.central.view"));
  if (stage.responsibilityScope === "CENTER") {
    // Approved CENTER rules: role (or the existing administrative override) + active membership of the stage center.
    if (!canConfirmStage(actor.role, stage.responsibleRole)) throw new Error("هذه المحطة يؤكّدها صاحب الدور المسؤول فقط");
    if (stage.responsibleCenterId == null) throw new Error("نطاق مسؤولية المحطة غير مكتمل");
    if (!central) {
      const membershipRole = centerRoleForUserRole(actor.role);
      const member = membershipRole ? await db.centerMembership.findFirst({
        where: { userId: actor.userId, centerId: stage.responsibleCenterId, ...activeMembershipWhere(membershipRole), center: { active: true } },
        select: { id: true },
      }) : null;
      if (!member) throw new Error("غير مصرح");
      // An exclusive assignment, when recorded, is respected; otherwise the work pool of the center applies.
      if (stage.assignedUserId && stage.assignedUserId !== actor.userId) throw new Error("المحطة مسندة لشخص آخر");
    }
  } else {
    // SERVICE and specialist stages: no role-only access and no administrative override; only the recorded assignee.
    if (!stage.assignedUserId) throw new Error("المحطة بانتظار الإسناد");
    if (stage.assignedUserId !== actor.userId) throw new Error("المحطة مسندة لشخص آخر");
    if (actor.role !== stage.responsibleRole) throw new Error("هذه المحطة يؤكّدها صاحب الدور المسؤول فقط");
    if (stage.responsibilityScope === "SPECIALIST_REVIEW") {
      // Authority is the referral that created the stage and its assigned reviewer, who must also be the acceptor.
      const referral = await db.referralRequest.findFirst({
        where: { careStageId: stage.id, destinationScope: "INTERNAL_SPECIALIST", assignedReviewerId: actor.userId, acceptedById: actor.userId },
        select: { id: true },
      });
      if (!referral) throw new Error("علاقة الإحالة بالمحطة غير مثبتة");
    } else if (stage.responsibilityScope !== "SERVICE") {
      // Unclassified (legacy) ownership never grants authority.
      throw new Error("ملكية المحطة غير مصنّفة؛ تتطلب تسوية صريحة قبل التأكيد");
    }
  }
  // Patient visibility uses the shared record scope (own branch, live handoff, referral, center relation, ADMIN).
  if (!(await canAccessPatientRecord(db as never, { userId: actor.userId, role: actor.role, permissions }, input.patientId))) {
    throw new Error("غير مصرح");
  }

  if (stage.status === input.to) return { changed: false, status: stage.status };
  if (!STAGE_TRANSITIONS[stage.status].includes(input.to)) throw new Error("انتقال غير مسموح للمحطة");

  const confirming = input.to === "CONFIRMED";
  const result = await db.careStage.updateMany({
    where: { id: stage.id, status: stage.status },
    data: confirming
      ? { status: "CONFIRMED", confirmedBy: actor.name ?? null, confirmedById: actor.userId, confirmedAt: new Date() }
      : { status: input.to, confirmedBy: null, confirmedById: null, confirmedAt: null },
  });
  if (result.count !== 1) throw new Error("تغيّرت حالة المحطة، حدّث الصفحة");

  // Resolve only the work notices linked to this stage; read/unread and history are untouched.
  const resolved = confirming
    ? await db.notification.updateMany({ where: { careStageId: stage.id, resolvedAt: null }, data: { resolvedAt: new Date() } })
    : { count: 0 };
  await db.auditLog.create({ data: {
    userId: actor.userId, action: "UPDATE", tableName: "care_stages", recordId: stage.id,
    oldValue: { status: stage.status }, newValue: { status: input.to, by: actor.role, resolvedNotifications: resolved.count },
  } });

  if (confirming) {
    // Existing rule: tell the next waiting station. Unrelated notifications and work items are left alone.
    const next = await db.careStage.findFirst({
      where: { patientId: input.patientId, sequence: { gt: stage.sequence }, status: { in: ["WAITING", "IN_PROGRESS"] } },
      orderBy: { sequence: "asc" },
      select: { id: true, station: true, responsibleRole: true },
    });
    if (next?.responsibleRole) {
      const patient = await db.patient.findUnique({ where: { id: input.patientId }, select: { fullName: true } });
      await notifyRoleInTransaction(db as never, next.responsibleRole, `مراجع بمحطتك: ${next.station}`, {
        body: patient?.fullName ?? "",
        link: `/patients/${input.patientId}`,
        careStageId: next.id,
      });
    }
  }
  return { changed: true, status: input.to };
}

const OPEN_STAGE = ["WAITING", "IN_PROGRESS"] as const;

async function effectivePermissions(db: Prisma.TransactionClient, userId: string, role: UserRole) {
  return loadPermissionsFromStore(userId, role, {
    findRolePermissions: (r) => db.rolePermission.findMany({ where: { role: r } }),
    findUserPermissions: (id) => db.userPermission.findMany({ where: { userId: id } }),
  });
}

/**
 * Operational reassignment of an open CENTER stage by a manager. The manager gains no confirmation right.
 * Authority is proven only by an active CENTER_MANAGEMENT membership of the stage's own center (or the existing
 * central-manager permission). SERVICE and specialist stages are deliberately not reassignable here.
 */
export async function reassignCenterStage(
  db: Prisma.TransactionClient,
  actor: { userId: string; role: UserRole },
  input: { patientId: string; stageId: string; newAssigneeId: string; expectedAssigneeId: string | null; reason: string },
): Promise<{ former: string | null }> {
  const reason = input.reason?.trim();
  if (!reason) throw new Error("سبب إعادة الإسناد مطلوب");
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { isActive: true, role: true } });
  if (!user?.isActive || user.role !== actor.role || actor.role !== "MANAGER") throw new Error("غير مصرح");
  const perms = await effectivePermissions(db, actor.userId, actor.role);

  const stage = await db.careStage.findFirst({
    where: { id: input.stageId, patientId: input.patientId },
    select: { id: true, status: true, responsibleRole: true, responsibilityScope: true, responsibleCenterId: true, assignedUserId: true },
  });
  if (!stage || stage.responsibilityScope !== "CENTER" || stage.responsibleCenterId == null) throw new Error("غير مصرح");
  if (!(OPEN_STAGE as readonly string[]).includes(stage.status)) throw new Error("المحطة منتهية");

  // Viewing never implies mutation: a modification permission AND proven management of this stage's own center.
  // No cross-center (central) modification contract exists, so central view grants nothing here.
  if (!perms.has("journey.manage")) throw new Error("غير مصرح");
  const managing = await db.centerMembership.findFirst({
    where: { userId: actor.userId, centerId: stage.responsibleCenterId, ...activeMembershipWhere("CENTER_MANAGEMENT"), center: { active: true } },
    select: { id: true },
  });
  if (!managing) throw new Error("غير مصرح");

  if (stage.assignedUserId !== input.expectedAssigneeId) throw new Error("تغيّر إسناد المحطة، حدّث الصفحة");
  if (stage.assignedUserId === input.newAssigneeId) throw new Error("المحطة مسندة لهذا الشخص مسبقاً");

  const replacement = await db.user.findUnique({ where: { id: input.newAssigneeId }, select: { id: true, isActive: true, role: true } });
  if (!replacement?.isActive || replacement.role !== stage.responsibleRole) throw new Error("الشخص البديل غير مؤهل");
  const memberRole = centerRoleForUserRole(replacement.role);
  const member = memberRole ? await db.centerMembership.findFirst({
    where: { userId: replacement.id, centerId: stage.responsibleCenterId, ...activeMembershipWhere(memberRole), center: { active: true } },
    select: { id: true },
  }) : null;
  if (!member) throw new Error("الشخص البديل غير مؤهل");
  if (!(await effectivePermissions(db, replacement.id, replacement.role)).has("journey.confirm")) throw new Error("الشخص البديل غير مؤهل");

  const result = await db.careStage.updateMany({
    where: { id: stage.id, status: { in: [...OPEN_STAGE] }, assignedUserId: stage.assignedUserId },
    data: { assignedUserId: replacement.id, assignedAt: new Date() },
  });
  if (result.count !== 1) throw new Error("تغيّر إسناد المحطة، حدّث الصفحة");
  await db.auditLog.create({ data: {
    userId: actor.userId, action: "UPDATE", tableName: "care_stages", recordId: stage.id,
    oldValue: { assignedUserId: stage.assignedUserId }, newValue: { assignedUserId: replacement.id, reason, by: "MANAGER" },
  } });
  const link = `/patients/${input.patientId}`;
  if (stage.assignedUserId) {
    await notifyUserInTransaction(db as never, stage.assignedUserId, "أُعيد إسناد محطتك إلى زميل آخر", { link, careStageId: stage.id });
  }
  await notifyUserInTransaction(db as never, replacement.id, "أُسندت إليك محطة سريرية", { link, careStageId: stage.id });
  return { former: stage.assignedUserId };
}

/** Open, unassigned CENTER/SERVICE stages the viewer's own scope covers (their branch, or a center they belong to). */
export async function listStagesAwaitingAssignment(
  db: Prisma.TransactionClient | typeof import("@/lib/db").prisma,
  actor: { userId: string; role: UserRole; permissions: ReadonlySet<string> },
  limit = 20,
) {
  if (!actor.permissions.has("journey.view") || !actor.permissions.has("handoff.send") || !actor.permissions.has("journey.manage")) return [];
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } } });
  if (!user?.isActive || user.role !== actor.role) return [];
  const memberRole = centerRoleForUserRole(actor.role);
  const centerIds = memberRole
    ? (await db.centerMembership.findMany({ where: { userId: actor.userId, ...activeMembershipWhere(memberRole), center: { active: true } }, select: { centerId: true } })).map((m) => m.centerId)
    : [];
  // Only CENTER stages of centers the viewer actively belongs to: no authority relation exists for SERVICE stages.
  if (!centerIds.length) return [];
  return db.careStage.findMany({
    where: {
      status: { in: [...OPEN_STAGE] }, assignedUserId: null, responsibilityScope: "CENTER",
      responsibleCenterId: { in: centerIds }, patient: { archivedAt: null },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, station: true, responsibleRole: true, patientId: true, patient: { select: { fullName: true, fileNumber: true } } },
  });
}
