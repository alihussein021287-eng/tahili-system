import type { Prisma, UserRole } from "@prisma/client";
import { BRANCH_LEVEL_ROLES, CENTER_ROLE_FOR_TARGET } from "@/lib/handoff-rules";

/** Current organizational eligibility, shared by claim and patient visibility. A name is never authority. */
export function handoffRecipientScope(user: { id: string; role: UserRole; branchId: number | null }, centerIds: number[]): Prisma.PatientHandoffWhereInput {
  const selection: Prisma.PatientHandoffWhereInput = { OR: [{ toUserId: user.id }, { toUserId: null }] };
  if ((BRANCH_LEVEL_ROLES as readonly string[]).includes(user.role)) {
    if (user.branchId == null) return { id: "__no_recipient_scope__" };
    return { ...selection, toRole: user.role, toCenterId: null, patient: { branchId: user.branchId } };
  }
  if (!(user.role in CENTER_ROLE_FOR_TARGET) || !centerIds.length) return { id: "__no_recipient_scope__" };
  return { ...selection, toRole: user.role, toCenterId: { in: centerIds } };
}
