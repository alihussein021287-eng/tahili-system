import type { Prisma, UserRole } from "@prisma/client";
import { activeMembershipWhere, centerRoleForUserRole } from "@/lib/center-membership";

type AccessDb = Pick<Prisma.TransactionClient,
  "user" | "patient" | "centerMembership" | "appointment" | "referralRequest" | "treatmentPlan" | "patientHandoff">;

/** Patient files require an active account, effective permission and a current care scope. */
export async function canReadLegacyPatientFile(
  db: AccessDb,
  actor: { userId: string; role: UserRole; permissions: ReadonlySet<string> },
  patientId: string,
): Promise<boolean> {
  if (!actor.permissions.has("patients.view")) return false;
  const [user, patient] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { role: true, isActive: true, branchId: true, branch: { select: { isActive: true } } } }),
    db.patient.findUnique({ where: { id: patientId }, select: { branchId: true, branch: { select: { isActive: true } } } }),
  ]);
  if (!user?.isActive || user.role !== actor.role || !patient) return false;
  if (user.role === "ADMIN" || (user.role === "MANAGER" && actor.permissions.has("centers.central.view"))) return true;
  if (user.branchId != null) {
    return user.branch?.isActive === true && patient.branch?.isActive === true && user.branchId === patient.branchId;
  }

  const membershipRole = centerRoleForUserRole(user.role);
  if (!membershipRole) return false;
  const memberships = await db.centerMembership.findMany({
    where: { userId: actor.userId, ...activeMembershipWhere(membershipRole), center: { active: true } },
    select: { centerId: true },
  });
  const centerIds = memberships.map((membership) => membership.centerId);
  if (!centerIds.length) return false;
  const center = { in: centerIds };
  const [appointment, referral, plan, handoff] = await Promise.all([
    db.appointment.findFirst({ where: { patientId, centerId: center }, select: { id: true } }),
    db.referralRequest.findFirst({ where: { patientId, destinationCenterId: center }, select: { id: true } }),
    db.treatmentPlan.findFirst({ where: { patientId, centerId: center }, select: { id: true } }),
    db.patientHandoff.findFirst({ where: { patientId, toCenterId: center, status: { in: ["SENT", "ACCEPTED"] } }, select: { id: true } }),
  ]);
  return !!(appointment || referral || plan || handoff);
}
