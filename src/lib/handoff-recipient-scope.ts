import type { Prisma, UserRole } from "@prisma/client";
import { BRANCH_LEVEL_ROLES, CENTER_ROLE_FOR_TARGET } from "@/lib/handoff-rules";

/** Current organizational eligibility, shared by claim and patient visibility. A name is never authority. */
export function handoffRecipientScope(user: { id: string; role: UserRole; branchId: number | null }, centerIds: number[]): Prisma.PatientHandoffWhereInput {
  const selection: Prisma.PatientHandoffWhereInput = { OR: [{ toUserId: user.id }, { toUserId: null }] };
  if ((BRANCH_LEVEL_ROLES as readonly string[]).includes(user.role)) {
    if (user.branchId == null) return { id: "__no_recipient_scope__" };
    return { toRole: user.role, toCenterId: null, OR: [
      { AND: [selection], patient: { branchId: user.branchId } },
      // Only a return to this original sender may use the verified receiving branch.
      { toUserId: user.id, careStageId: null,
        previousHandoff: { is: { status: "RETURNED", fromUserId: user.id, fromRole: user.role } },
        patient: { visits: { some: { branchId: user.branchId, branch: { isActive: true },
          verifiedAt: { not: null }, verificationMethod: "PHYSICAL_DOCUMENT_ATTESTED" } } } },
    ] };
  }
  if (user.role === "DOCTOR") return { OR: [
    ...(centerIds.length ? [{ ...selection, toRole: user.role, toCenterId: { in: centerIds } }] : []),
    // Program finalizers alone create root, centerless physician follow-ups. A name alone is insufficient.
    { toUserId: user.id, toRole: "DOCTOR", toCenterId: null, previousHandoffId: null, careStageId: null,
      patient: { OR: [
        { treatmentPlans: { some: { status: "COMPLETED", finalDecision: "END", closedAt: { not: null },
          evaluatedAt: { not: null }, specialistDoctorId: user.id } } },
        { centerPrograms: { some: { status: "COMPLETED", returnToConsultancy: true, closedAt: { not: null },
          referralRequest: { is: { OR: [{ assignedReviewerId: user.id }, { createdById: user.id }] } } } } },
      ] } },
  ] };
  if (!(user.role in CENTER_ROLE_FOR_TARGET) || !centerIds.length) return { id: "__no_recipient_scope__" };
  return { ...selection, toRole: user.role, toCenterId: { in: centerIds } };
}
