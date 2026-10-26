import type { Prisma, UserRole } from "@prisma/client";
import { activeMembershipWhere } from "@/lib/center-membership";

/** Narrow transaction surface so handoff-service test doubles stay small. */
export type StageAssignmentTx = {
  centerMembership?: { findFirst(args: Prisma.CenterMembershipFindFirstArgs): Promise<{ id: string } | null> };
  careStage: {
    findUnique(args: Prisma.CareStageFindUniqueArgs): Promise<StageRow | null>;
    updateMany(args: Prisma.CareStageUpdateManyArgs): Promise<{ count: number }>;
  };
  auditLog: { create(args: Prisma.AuditLogCreateArgs): Promise<unknown> };
  notification?: { updateMany(args: Prisma.NotificationUpdateManyArgs): Promise<{ count: number }> };
};

type StageRow = {
  id: string; patientId: string; status: string; responsibleRole: UserRole | null;
  responsibilityScope: "CENTER" | "SERVICE" | "SPECIALIST_REVIEW" | null; responsibleCenterId: number | null; assignedUserId: string | null;
};

const stageSelect = {
  id: true, patientId: true, status: true, responsibleRole: true,
  responsibilityScope: true, responsibleCenterId: true, assignedUserId: true,
} as const;
const ACTIVE = ["WAITING", "IN_PROGRESS"];
const denied = () => new Error("غير مصرح");

async function loadLinkedStage(tx: StageAssignmentTx, stageId: string, patientId: string, toRole: UserRole, toCenterId: number | null) {
  const stage = await tx.careStage.findUnique({ where: { id: stageId }, select: stageSelect });
  if (!stage || stage.patientId !== patientId) throw denied();
  if (!ACTIVE.includes(stage.status)) throw new Error("المحطة منتهية ولا يمكن إسنادها");
  // Unclassified ownership is never made assignable through a handoff.
  if (!stage.responsibilityScope) throw new Error("ملكية المحطة غير مصنّفة");
  // Specialist review stages belong to the referral reviewer and are not assignable by handoff.
  if (stage.responsibilityScope === "SPECIALIST_REVIEW") throw denied();
  if (stage.responsibleRole !== toRole) throw denied();
  if (stage.responsibilityScope === "CENTER" && stage.responsibleCenterId !== toCenterId) throw denied();
  return stage;
}

/** Validates a stage reference on a new handoff. Only the current assignee may hand an assigned stage over, with a reason. */
export async function assertStageLinkOnSend(
  tx: StageAssignmentTx,
  input: {
    stageId: string; patientId: string; senderId: string; senderPermissions: ReadonlySet<string>;
    toUserId?: string | null; toRole: UserRole; toCenterId: number | null; note?: string | null;
  },
) {
  // A stage cannot be claimed by its own sender: first assignment needs a second, authorized party.
  if (input.toUserId && input.toUserId === input.senderId) throw denied();
  const stage = await loadLinkedStage(tx, input.stageId, input.patientId, input.toRole, input.toCenterId);
  if (stage.assignedUserId) {
    // Hand-over: only the current assignee, with a reason.
    if (stage.assignedUserId !== input.senderId) throw denied();
    if (!input.note?.trim()) throw new Error("سبب إعادة الإسناد مطلوب");
    return;
  }
  // First assignment needs proven authority over this stage's work.
  // SERVICE stages: no stored relation links an actor to a service/station, so this is blocked (fail closed).
  if (stage.responsibilityScope !== "CENTER") throw new Error("لا توجد جهة مخوّلة بإسناد هذه المحطة بعد؛ تتطلب تحديد صلاحية الإسناد");
  // CENTER stages: stage-modification permission AND active membership of the stage's own center.
  if (!input.senderPermissions.has("journey.manage") || !tx.centerMembership || stage.responsibleCenterId == null) throw denied();
  const member = await tx.centerMembership.findFirst({
    where: { userId: input.senderId, centerId: stage.responsibleCenterId, ...activeMembershipWhere(), center: { active: true } },
    select: { id: true },
  });
  if (!member) throw denied();
}

/**
 * On acceptance of a stage-linked handoff, assigns (or hands over) exactly that stage inside the same transaction.
 * Compare-and-set on the previous assignee prevents stale or conflicting assignments.
 * Returns the former assignee when this was a reassignment.
 */
export async function assignStageOnAccept(
  tx: StageAssignmentTx,
  handoff: { id: string; patientId: string; careStageId: string; fromUserId: string; toRole: UserRole; toCenterId: number | null; note: string | null },
  acceptor: { id: string; role: UserRole },
): Promise<{ former: string | null; changed: boolean }> {
  if (acceptor.role !== handoff.toRole) throw denied();
  if (acceptor.id === handoff.fromUserId) throw denied();
  const stage = await loadLinkedStage(tx, handoff.careStageId, handoff.patientId, handoff.toRole, handoff.toCenterId);
  if (stage.assignedUserId === acceptor.id) return { former: null, changed: false };
  const former = stage.assignedUserId;
  if (former && former !== handoff.fromUserId) throw new Error("المحطة مسندة لشخص آخر");
  if (former && !handoff.note?.trim()) throw new Error("سبب إعادة الإسناد مطلوب");
  const now = new Date();
  const result = await tx.careStage.updateMany({
    where: { id: stage.id, status: { in: ACTIVE as never }, assignedUserId: former },
    data: { assignedUserId: acceptor.id, assignedAt: now, operationalCompletedById: null, operationalCompletedAt: null, operationalCompletionId: null },
  });
  if (result.count !== 1) throw new Error("تغيّر إسناد المحطة، حدّث الصفحة");
  if (tx.notification) await tx.notification.updateMany({ where: { careStageId: stage.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
  await tx.auditLog.create({ data: {
    userId: acceptor.id, action: "UPDATE", tableName: "care_stages", recordId: stage.id,
    oldValue: { assignedUserId: former }, newValue: { assignedUserId: acceptor.id, handoffId: handoff.id, ...(former ? { reason: handoff.note } : {}) },
  } });
  return { former, changed: true };
}
