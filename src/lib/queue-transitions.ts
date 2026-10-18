import type { Prisma, QueueStatus, UserRole } from "@prisma/client";
import { activeMembershipWhere, centerRoleForUserRole } from "@/lib/center-membership";

/** Forward flow WAITING → CALLED → IN_SESSION → DONE; a call or session may be returned to the waiting list. DONE is terminal. */
export const QUEUE_TRANSITIONS: Record<QueueStatus, readonly QueueStatus[]> = {
  WAITING: ["CALLED"],
  CALLED: ["IN_SESSION", "WAITING"],
  IN_SESSION: ["DONE", "WAITING"],
  DONE: [],
};

export function isQueueStatus(value: unknown): value is QueueStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(QUEUE_TRANSITIONS, value);
}

export type QueueActor = { userId: string; role: UserRole; permissions: ReadonlySet<string> };
type QueueDb = Pick<Prisma.TransactionClient, "user" | "queueEntry" | "centerMembership" | "auditLog">;

/**
 * Who may operate a queue entry. Absence of a branch is NOT central authority.
 * - ADMIN is the only central actor (a viewing permission such as centers.central.view never modifies a queue).
 * - Staff work in their own active branch: the branch recorded on the entry when it was queued (explicit receiving
 *   branch) or, for entries without one, the patient's branch. An entry with neither is operable only by ADMIN or a member of its center.
 * - An active member of the entry's own center may operate it (roles that hold queue.manage and a membership role).
 * Pure so the page and the server share it.
 */
export function queueScopeAllows(input: {
  central: boolean;
  userBranchId: number | null;
  userBranchActive: boolean;
  /** patient.branchId ?? entry.branchId */
  entryBranchId: number | null;
  entryCenterId: number | null;
  memberCenterIds: readonly number[];
}): boolean {
  if (input.central) return true;
  if (input.entryCenterId != null && input.memberCenterIds.includes(input.entryCenterId)) return true;
  if (input.userBranchId == null || !input.userBranchActive) return false;
  if (input.entryBranchId == null) return false;
  return input.entryBranchId === input.userBranchId;
}

/** List visibility that matches queueScopeAllows. ADMIN may narrow by a requested branch; everyone else is fixed to their scope. */
export function queueVisibilityWhere(input: {
  central: boolean;
  requestedBranchId: number | null;
  userBranchId: number | null;
  userBranchActive: boolean;
  memberCenterIds: readonly number[];
}): Prisma.QueueEntryWhereInput {
  if (input.central) return input.requestedBranchId ? { OR: [{ branchId: input.requestedBranchId }, { branchId: null, patient: { branchId: input.requestedBranchId } }] } : {};
  const or: Prisma.QueueEntryWhereInput[] = [];
  if (input.userBranchId != null && input.userBranchActive) {
    // An explicitly recorded entry branch is authoritative; the patient's branch only applies when none was recorded.
    or.push({ branchId: input.userBranchId }, { branchId: null, patient: { branchId: input.userBranchId } });
  }
  if (input.memberCenterIds.length) or.push({ centerId: { in: [...input.memberCenterIds] } });
  return or.length ? { OR: or } : { id: "__no_scope__" };
}

/** Queue access follows the entry's own center (or the patient's branch for branch-level staff), never client input. */
export async function assertQueueScope(db: QueueDb, actor: QueueActor, entry: { centerId: number | null; branchId: number | null; patient: { branchId: number | null } }) {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { role: true, isActive: true, branchId: true, branch: { select: { isActive: true } } },
  });
  if (!user?.isActive || user.role !== actor.role) throw new Error("غير مصرح");
  const membershipRole = centerRoleForUserRole(user.role);
  let memberCenterIds: number[] = [];
  if (membershipRole && entry.centerId != null) {
    const member = await db.centerMembership.findFirst({
      where: { userId: actor.userId, centerId: entry.centerId, ...activeMembershipWhere(membershipRole), center: { active: true } },
      select: { id: true },
    });
    if (member) memberCenterIds = [entry.centerId];
  }
  if (queueScopeAllows({
    central: user.role === "ADMIN", userBranchId: user.branchId, userBranchActive: user.branch?.isActive === true,
    entryBranchId: entry.branchId ?? entry.patient.branchId, entryCenterId: entry.centerId, memberCenterIds,
  })) return;
  throw new Error("غير مصرح");
}

/**
 * Moves one queue entry. A repeat of the current status is a no-op without an audit entry; an illegal move is rejected.
 * The update is conditional on the status that was checked, so a concurrent change cannot bypass the matrix.
 */
export async function transitionQueueEntry(
  db: Prisma.TransactionClient,
  actor: QueueActor,
  id: string,
  to: QueueStatus,
): Promise<{ changed: boolean; status: QueueStatus }> {
  if (!actor.permissions.has("queue.manage")) throw new Error("غير مصرح");
  const entry = await db.queueEntry.findUnique({
    where: { id },
    select: { id: true, status: true, centerId: true, branchId: true, patient: { select: { branchId: true } } },
  });
  if (!entry) throw new Error("مدخل الطابور غير موجود");
  await assertQueueScope(db, actor, entry);
  if (entry.status === to) return { changed: false, status: entry.status };
  if (!QUEUE_TRANSITIONS[entry.status].includes(to)) throw new Error("انتقال غير مسموح في الطابور");
  const result = await db.queueEntry.updateMany({
    where: { id, status: entry.status },
    data: { status: to, ...(to === "CALLED" ? { calledAt: new Date() } : {}) },
  });
  if (result.count !== 1) throw new Error("تغيّر مدخل الطابور، حدّث الصفحة وحاول مجدداً");
  await db.auditLog.create({ data: {
    userId: actor.userId, action: "UPDATE", tableName: "queue_entries", recordId: id,
    oldValue: { status: entry.status }, newValue: { status: to },
  } });
  return { changed: true, status: to };
}
