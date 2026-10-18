import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { activeMembershipWhere, centerRoleForUserRole } from "@/lib/center-membership";
import { queueVisibilityWhere } from "@/lib/queue-transitions";

/**
 * Queue-entry filter for the signed-in viewer, identical to the queue screen: ADMIN may narrow by a requested branch;
 * everyone else is fixed to their own active branch (and centers they belong to). A request parameter, a missing
 * branch or an inactive branch never widens it.
 */
export async function queueViewerWhere(
  viewer: { userId: string | undefined; role: UserRole | string | undefined },
  requestedBranchId: number | null = null,
  db: typeof prisma = prisma,
): Promise<Prisma.QueueEntryWhereInput> {
  if (!viewer.userId || !viewer.role) return { id: "__no_scope__" };
  const role = viewer.role as UserRole;
  const me = await db.user.findUnique({ where: { id: viewer.userId }, select: { branchId: true, branch: { select: { isActive: true } } } });
  const memberRole = centerRoleForUserRole(role);
  const memberCenterIds = memberRole
    ? (await db.centerMembership.findMany({ where: { userId: viewer.userId, ...activeMembershipWhere(memberRole), center: { active: true } }, select: { centerId: true } })).map((m) => m.centerId)
    : [];
  return queueVisibilityWhere({
    central: role === "ADMIN", requestedBranchId,
    userBranchId: me?.branchId ?? null, userBranchActive: me?.branch?.isActive === true, memberCenterIds,
  });
}
