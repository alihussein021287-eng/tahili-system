import type { Prisma, UserRole } from "@prisma/client";
import { currentTherapyActor } from "@/lib/therapy-session-lock";
import { activeMembershipWhere, centerRoleForUserRole } from "@/lib/center-membership";
import { canAccessPatientRecord } from "@/lib/patient-access";
import { loadPermissionsFromStore } from "@/lib/permission-store";
import { CENTER_SPACES } from "@/lib/center-workspaces";

export type ClinicalActor = { userId: string; role: UserRole; authVersion: number };
export type ClinicalTarget = { kind: "STAGE" | "PROGRAM"; id: string };
type Tx = Prisma.TransactionClient;
const denied = () => new Error("غير مصرح بالمراجعة الطبية");

export async function lockClinicalTarget(tx: Tx, target: ClinicalTarget) {
  if (target.kind === "STAGE") {
    await tx.$queryRaw`SELECT id FROM "CareStage" WHERE id = ${target.id} FOR UPDATE`;
    const s = await tx.careStage.findUnique({ where: { id: target.id } });
    if (!s || s.responsibilityScope !== "CENTER" || s.responsibleCenterId == null
      || !["WAITING", "IN_PROGRESS"].includes(s.status)) throw denied();
    return { patientId: s.patientId, centerId: s.responsibleCenterId };
  }
  await tx.$queryRaw`SELECT id FROM center_programs WHERE id = ${target.id} FOR UPDATE`;
  const p = await tx.centerProgram.findUnique({ where: { id: target.id } });
  if (!p || p.status !== "ACTIVE") throw denied();
  return { patientId: p.patientId, centerId: p.centerId };
}

export async function clinicalActor(tx: Tx, actor: ClinicalActor, permission: string, patientId: string, centerId: number, role: UserRole) {
  const user = await currentTherapyActor(tx, { id: actor.userId, role: actor.role, authVersion: actor.authVersion }, permission, patientId);
  if (user.role !== role) throw denied();
  const membershipRole = centerRoleForUserRole(role);
  if (!membershipRole) throw denied();
  const membership = await tx.centerMembership.findFirst({ where: {
    centerId, userId: user.id, ...activeMembershipWhere(membershipRole), center: { active: true },
  }, select: { id: true } });
  if (!membership || !(await tx.patient.findFirst({ where: { id: patientId, archivedAt: null }, select: { id: true } }))) throw denied();
  return user;
}

async function nominationAuthority(tx: Tx, userId: string, patientId: string, centerId: number) {
  const account = await tx.user.findUnique({ where: { id: userId }, select: { role: true, authVersion: true } });
  if (account?.role !== "SECRETARY") throw denied();
  // A role template, journey routing, or ADMIN's ALL_PERMS cannot nominate.
  const grant = await tx.userPermission.findUnique({ where: { userId_permKey: { userId, permKey: "clinical.review.nominate" } } });
  if (!grant?.allowed) throw denied();
  return clinicalActor(tx, { userId, role: account.role, authVersion: account.authVersion }, "clinical.review.nominate", patientId, centerId, "SECRETARY");
}

const targetWhere = (target: ClinicalTarget) => target.kind === "STAGE" ? { careStageId: target.id } : { programId: target.id };

export async function nominateClinicalReviewer(tx: Tx, actor: ClinicalActor, target: ClinicalTarget, reviewerId: string) {
  const scope = await lockClinicalTarget(tx, target);
  await clinicalActor(tx, actor, "clinical.review.nominate", scope.patientId, scope.centerId, "SECRETARY");
  await nominationAuthority(tx, actor.userId, scope.patientId, scope.centerId);
  const doctor = await tx.user.findUnique({ where: { id: reviewerId }, select: { role: true, authVersion: true } });
  if (doctor?.role !== "DOCTOR") throw denied();
  await clinicalActor(tx, { userId: reviewerId, role: doctor.role, authVersion: doctor.authVersion }, "clinical.review.accept", scope.patientId, scope.centerId, "DOCTOR");
  const permission = target.kind === "STAGE" ? "journey.confirm" : "centers.programs.medicalConfirm";
  await clinicalActor(tx, { userId: reviewerId, role: doctor.role, authVersion: doctor.authVersion }, permission, scope.patientId, scope.centerId, "DOCTOR");
  const old = await tx.clinicalReviewAssignment.findMany({ where: { ...targetWhere(target), revokedAt: null } });
  if (old.length === 1 && old[0].reviewerId === reviewerId) return old[0];
  await tx.clinicalReviewAssignment.updateMany({ where: { ...targetWhere(target), revokedAt: null }, data: { revokedAt: new Date() } });
  const assignment = await tx.clinicalReviewAssignment.create({ data: { ...targetWhere(target), reviewerId, nominatedById: actor.userId } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", tableName: "clinical_review_assignments", recordId: assignment.id,
    newValue: { target: target.id, kind: target.kind, reviewerId, nominatedById: actor.userId, replacedIds: old.map(a => a.id) } } });
  let link = `/patients/${scope.patientId}?tab=journey`;
  if (target.kind === "STAGE") {
    const referral = await tx.referralRequest.findFirst({ where: { careStageId: target.id }, select: { id: true } });
    if (referral) link = `/referrals/${referral.id}`;
  } else {
    const center = await tx.center.findUniqueOrThrow({ where: { id: scope.centerId }, select: { name: true } });
    const slug = Object.entries(CENTER_SPACES).find(([, config]) => config.patterns.some(p => center.name.includes(p)))?.[0];
    if (slug) link = `/centers/${slug}/programs/${target.id}`;
  }
  await tx.notification.create({ data: { targetUserId: reviewerId, title: "ترشيح لمراجعة طبية — يتطلب قبولك", link } });
  return assignment;
}

export async function acceptClinicalReview(tx: Tx, actor: ClinicalActor, target: ClinicalTarget, assignmentId: string) {
  const scope = await lockClinicalTarget(tx, target);
  await clinicalActor(tx, actor, "clinical.review.accept", scope.patientId, scope.centerId, "DOCTOR");
  const a = await tx.clinicalReviewAssignment.findFirst({ where: { id: assignmentId, ...targetWhere(target), reviewerId: actor.userId, revokedAt: null } });
  if (!a) throw denied();
  await nominationAuthority(tx, a.nominatedById, scope.patientId, scope.centerId);
  if (a.acceptedAt) return a;
  const updated = await tx.clinicalReviewAssignment.update({ where: { id: a.id }, data: { acceptedById: actor.userId, acceptedAt: new Date() } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "clinical_review_assignments", recordId: a.id, newValue: { acceptedById: actor.userId, acceptedAt: updated.acceptedAt!.toISOString() } } });
  return updated;
}

export async function revokeClinicalReview(tx: Tx, actor: ClinicalActor, target: ClinicalTarget, assignmentId: string) {
  const scope = await lockClinicalTarget(tx, target);
  await clinicalActor(tx, actor, "clinical.review.nominate", scope.patientId, scope.centerId, "SECRETARY");
  await nominationAuthority(tx, actor.userId, scope.patientId, scope.centerId);
  const a = await tx.clinicalReviewAssignment.findFirst({ where: { id: assignmentId, ...targetWhere(target), revokedAt: null } });
  if (!a) throw denied();
  await tx.clinicalReviewAssignment.update({ where: { id: a.id }, data: { revokedAt: new Date() } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "clinical_review_assignments", recordId: a.id, newValue: { revoked: true } } });
}

/** Caller holds the target row lock. No role-only or referral-field fallback. */
export async function assertAcceptedClinicalReview(tx: Tx, actor: ClinicalActor, target: ClinicalTarget, patientId: string, centerId: number, expectedAssignmentId?: string) {
  if (!expectedAssignmentId) throw denied();
  await clinicalActor(tx, actor, target.kind === "STAGE" ? "journey.confirm" : "centers.programs.medicalConfirm", patientId, centerId, "DOCTOR");
  await clinicalActor(tx, actor, "clinical.review.accept", patientId, centerId, "DOCTOR");
  const a = await tx.clinicalReviewAssignment.findFirst({ where: { id: expectedAssignmentId, ...targetWhere(target), reviewerId: actor.userId, acceptedById: actor.userId, acceptedAt: { not: null }, revokedAt: null } });
  if (!a) throw denied();
  await nominationAuthority(tx, a.nominatedById, patientId, centerId);
  return a;
}

/** Minimal nomination UI data, never a patient list. Mutation repeats every guard. */
export async function clinicalReviewControls(tx: Tx, actor: ClinicalActor, target: ClinicalTarget) {
  const scope = target.kind === "STAGE"
    ? await tx.careStage.findUnique({ where: { id: target.id }, select: { patientId: true, responsibleCenterId: true } }).then(s => s?.responsibleCenterId == null ? null : { patientId: s.patientId, centerId: s.responsibleCenterId })
    : await tx.centerProgram.findUnique({ where: { id: target.id }, select: { patientId: true, centerId: true } });
  if (!scope) throw denied();
  const permissions = await loadPermissionsFromStore(actor.userId, actor.role, { findRolePermissions: role => tx.rolePermission.findMany({ where: { role } }), findUserPermissions: userId => tx.userPermission.findMany({ where: { userId } }) });
  if (!(await canAccessPatientRecord(tx, { ...actor, permissions }, scope.patientId))) throw denied();
  const assignment = await tx.clinicalReviewAssignment.findFirst({ where: { ...targetWhere(target), revokedAt: null }, select: { id: true, reviewerId: true, acceptedAt: true } });
  let canNominate = false;
  try { await clinicalActor(tx, actor, "clinical.review.nominate", scope.patientId, scope.centerId, "SECRETARY"); await nominationAuthority(tx, actor.userId, scope.patientId, scope.centerId); canNominate = true; } catch { /* fail closed */ }
  const candidates: { id: string; fullName: string }[] = [];
  if (canNominate) {
    const doctors = await tx.user.findMany({ where: { role: "DOCTOR", isActive: true, needsActivation: false, centerMemberships: { some: { centerId: scope.centerId, ...activeMembershipWhere("SPECIALIST"), center: { active: true } } } }, select: { id: true, fullName: true, authVersion: true } });
    for (const d of doctors) {
      try {
        const doctor = { userId: d.id, role: "DOCTOR" as const, authVersion: d.authVersion };
        await clinicalActor(tx, doctor, "clinical.review.accept", scope.patientId, scope.centerId, "DOCTOR");
        await clinicalActor(tx, doctor, target.kind === "STAGE" ? "journey.confirm" : "centers.programs.medicalConfirm", scope.patientId, scope.centerId, "DOCTOR");
        candidates.push({ id: d.id, fullName: d.fullName });
      } catch { /* not eligible */ }
    }
  }
  return { assignment, canNominate, candidates, canAccept: actor.role === "DOCTOR" && assignment?.reviewerId === actor.userId && !assignment.acceptedAt };
}
