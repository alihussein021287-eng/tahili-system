import type { Prisma, UserRole } from "@prisma/client";
import { activeMembershipWhere, centerRoleForUserRole } from "@/lib/center-membership";

export type ReferralAccessActor = {
  userId: string;
  role: UserRole;
  permissions: ReadonlySet<string>;
};

type AccessDb = Pick<Prisma.TransactionClient, "user" | "centerMembership">;

/** Scope is derived from the current account and memberships, never from form fields. */
export async function referralAccessScope(db: AccessDb, actor: ReferralAccessActor) {
  if (!actor.permissions.has("referrals.view")) throw new Error("غير مصرح");
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, role: true, isActive: true, branchId: true, branch: { select: { isActive: true } } },
  });
  if (!user?.isActive || user.role !== actor.role) throw new Error("غير مصرح");

  const membershipRole = centerRoleForUserRole(user.role);
  const memberships = membershipRole ? await db.centerMembership.findMany({
    where: {
      userId: user.id,
      ...activeMembershipWhere(membershipRole ?? undefined),
      center: { active: true },
    },
    select: { centerId: true },
  }) : [];
  const centerIds = memberships.map((membership) => membership.centerId);
  if (user.role === "ADMIN" || (user.role === "MANAGER" && actor.permissions.has("centers.central.view"))) {
    return { where: {} as Prisma.ReferralRequestWhereInput, centerIds, branchId: user.branch?.isActive ? user.branchId : null };
  }

  const or: Prisma.ReferralRequestWhereInput[] = [
    { createdById: user.id },
    { assignedReviewerId: user.id },
  ];
  if (centerIds.length) or.push({ destinationScope: "INTERNAL_CENTER", destinationCenterId: { in: centerIds } });
  if (user.branchId && user.branch?.isActive && ["RECEPTION", "DATA_ENTRY", "SECRETARY", "RESIDENT", "DOCTOR"].includes(user.role)) {
    or.push({ patient: { branchId: user.branchId } });
  }
  return { where: { OR: or } as Prisma.ReferralRequestWhereInput, centerIds, branchId: user.branch?.isActive ? user.branchId : null };
}
