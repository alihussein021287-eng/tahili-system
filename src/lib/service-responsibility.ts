import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { CENTER_STATIONS, centerStationByName } from "@/lib/stations";
import { currentTherapyActor } from "@/lib/therapy-session-lock";
import type { ClinicalActor } from "@/lib/clinical-review-service";
import { activeMembershipWhere, centerRoleForUserRole } from "@/lib/center-membership";

type Tx = Prisma.TransactionClient;
const denied = () => new Error("غير مصرح بعمل الخدمة أو تغيّر تفويضها");
async function branchLock(tx: Tx, branchId: number) {
  await tx.$queryRaw`SELECT id FROM branches WHERE id=${branchId} FOR UPDATE`;
  if (!(await tx.branch.findFirst({ where: { id: branchId, isActive: true } }))) throw denied();
}
async function current(tx: Tx, actor: ClinicalActor, permission: string, patientId?: string) {
  return currentTherapyActor(tx, { id: actor.userId, role: actor.role, authVersion: actor.authVersion }, permission, patientId);
}
async function eligible(tx: Tx, userId: string, branchId: number, serviceKey: string, permission: string, patientId?: string, centerId?: number | null) {
  const station = CENTER_STATIONS.find(s => s.key === serviceKey);
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, authVersion: true, branchId: true } });
  if (!station || !user || user.role !== station.role || user.branchId !== branchId) throw denied();
  await current(tx, { userId, role: user.role, authVersion: user.authVersion }, permission, patientId);
  if (centerId != null) {
    const role = centerRoleForUserRole(user.role);
    if (!role || !(await tx.centerMembership.findFirst({ where: { userId, centerId, ...activeMembershipWhere(role), center: { active: true } }, select: { id: true } }))) throw denied();
  }
  return station;
}

export async function designateServiceResponsibility(tx: Tx, actor: ClinicalActor, input: { branchId: number; serviceKey: string; responsibleId: string }) {
  await branchLock(tx, input.branchId);
  await current(tx, actor, "services.designate");
  if (actor.role !== "ADMIN") throw denied();
  await eligible(tx, input.responsibleId, input.branchId, input.serviceKey, "services.assign");
  const old = await tx.serviceResponsibility.findFirst({ where: { branchId: input.branchId, serviceKey: input.serviceKey, revokedAt: null } });
  if (old?.responsibleId === input.responsibleId) return old;
  if (old) await tx.serviceResponsibility.update({ where: { id: old.id }, data: { revokedAt: new Date(), revokedById: actor.userId, revocationReason: "استبدال صريح لمسؤول الخدمة" } });
  const row = await tx.serviceResponsibility.create({ data: { ...input, designatedById: actor.userId } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", tableName: "service_responsibilities", recordId: row.id,
    newValue: { ...input, designatedById: actor.userId, designatedAt: row.designatedAt.toISOString(), replacedId: old?.id ?? null } } });
  return row;
}
export async function revokeServiceResponsibility(tx: Tx, actor: ClinicalActor, id: string, reason: string) {
  const old = await tx.serviceResponsibility.findUnique({ where: { id } }); if (!old) throw denied();
  await branchLock(tx, old.branchId); await current(tx, actor, "services.designate");
  if (actor.role !== "ADMIN" || !reason.trim()) throw denied();
  const row = await tx.serviceResponsibility.findUniqueOrThrow({ where: { id } });
  if (row.revokedAt) return;
  await tx.serviceResponsibility.update({ where: { id }, data: { revokedAt: new Date(), revokedById: actor.userId, revocationReason: reason.trim() } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "service_responsibilities", recordId: id, newValue: { revoked: true, reason: reason.trim() } } });
}

export async function lockServiceStage(tx: Tx, patientId: string, stageId: string) {
  const pointer = await tx.careStage.findFirst({ where: { id: stageId, patientId }, select: { patient: { select: { branchId: true } } } });
  if (!pointer?.patient.branchId) throw denied();
  await branchLock(tx, pointer.patient.branchId);
  await tx.$queryRaw`SELECT id FROM "CareStage" WHERE id=${stageId} FOR UPDATE`;
  const stage = await tx.careStage.findFirst({ where: { id: stageId, patientId }, include: { patient: { select: { branchId: true, archivedAt: true } } } });
  const station = centerStationByName(stage?.station);
  if (!stage || stage.responsibilityScope !== "SERVICE" || !station || station.role !== stage.responsibleRole
    || stage.patient.archivedAt || stage.patient.branchId !== pointer.patient.branchId) throw denied();
  return { stage, station, branchId: pointer.patient.branchId };
}

export async function assignServiceStage(tx: Tx, actor: ClinicalActor, input: { patientId: string; stageId: string; workerId: string; expectedUpdatedAt: string; authorityId: string; reason?: string }) {
  const { stage, station, branchId } = await lockServiceStage(tx, input.patientId, input.stageId);
  await current(tx, actor, "services.assign", input.patientId);
  // A branch mutex alone cannot refresh a Serializable snapshot started before
  // a wait. Lock the provenance tuple too, so a committed revocation aborts it.
  await tx.$queryRaw`SELECT id FROM service_responsibilities WHERE id=${input.authorityId}::uuid FOR SHARE`;
  const authority = await tx.serviceResponsibility.findFirst({ where: { id: input.authorityId, serviceKey: station.key, branchId, responsibleId: actor.userId, revokedAt: null } });
  if (!authority || stage.operationalCompletedAt || !["WAITING", "IN_PROGRESS"].includes(stage.status)
    || stage.updatedAt.toISOString() !== input.expectedUpdatedAt || input.workerId === actor.userId) throw denied();
  await eligible(tx, actor.userId, branchId, station.key, "services.assign", input.patientId, stage.responsibleCenterId);
  await eligible(tx, input.workerId, branchId, station.key, "services.execute", input.patientId, stage.responsibleCenterId);
  if (stage.assignedUserId) {
    const former = stage.serviceAuthorityId ? await tx.serviceResponsibility.findUnique({ where: { id: stage.serviceAuthorityId } }) : null;
    if (former && !former.revokedAt) throw denied();
    if (!input.reason?.trim()) throw new Error("سبب تسوية الإسناد السابق مطلوب");
  }
  const assignmentId = randomUUID(), at = new Date();
  await tx.careStage.update({ where: { id: stage.id }, data: { assignedUserId: input.workerId, assignedAt: at,
    serviceAuthorityId: authority.id, serviceAssignmentId: assignmentId, serviceAssignedById: actor.userId } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "care_stages", recordId: stage.id,
    oldValue: { assignedUserId: stage.assignedUserId, serviceAssignmentId: stage.serviceAssignmentId },
    newValue: { assignedUserId: input.workerId, assignedById: actor.userId, assignedAt: at.toISOString(), serviceAuthorityId: authority.id, serviceAssignmentId: assignmentId, serviceKey: station.key, branchId, reason: input.reason?.trim() ?? null } } });
  await tx.notification.create({ data: { targetUserId: input.workerId, title: "عمل خدمة مسند إليك", link: `/patients/${input.patientId}`, careStageId: stage.id } });
  return assignmentId;
}

export async function assertServiceWorkAuthority(tx: Tx, actor: ClinicalActor, patientId: string, stageId: string, expectedAssignmentId?: string) {
  const pointer = await tx.careStage.findFirst({ where: { id: stageId, patientId }, select: { serviceAuthorityId: true } });
  if (!pointer?.serviceAuthorityId) throw denied();
  await tx.$queryRaw`SELECT id FROM service_responsibilities WHERE id=${pointer.serviceAuthorityId}::uuid FOR SHARE`;
  const stage = await tx.careStage.findFirst({ where: { id: stageId, patientId }, include: { patient: { select: { branchId: true, archivedAt: true } }, serviceAuthority: true } });
  const station = centerStationByName(stage?.station), a = stage?.serviceAuthority;
  if (!stage || !station || stage.responsibilityScope !== "SERVICE" || stage.responsibleRole !== station.role
    || stage.patient.archivedAt || !a || a.revokedAt || a.branchId !== stage.patient.branchId || a.serviceKey !== station.key
    || stage.assignedUserId !== actor.userId || !expectedAssignmentId || stage.serviceAssignmentId !== expectedAssignmentId
    || stage.serviceAssignedById !== a.responsibleId) throw denied();
  const user = await current(tx, actor, "services.execute", patientId);
  await eligible(tx, actor.userId, a.branchId, station.key, "services.execute", patientId, stage.responsibleCenterId);
  await eligible(tx, a.responsibleId, a.branchId, station.key, "services.assign", patientId, stage.responsibleCenterId);
  return { stage, station, user };
}

export async function executeServiceStage(tx: Tx, actor: ClinicalActor, input: { patientId: string; stageId: string; assignmentId: string; complete: boolean }) {
  await lockServiceStage(tx, input.patientId, input.stageId);
  const { stage, station, user } = await assertServiceWorkAuthority(tx, actor, input.patientId, input.stageId, input.assignmentId);
  if (stage.operationalCompletedAt && stage.operationalCompletedById === actor.userId) return { changed: false };
  if (!["WAITING", "IN_PROGRESS"].includes(stage.status)) throw denied();
  const nonclinical = stage.requiresPhysicianConfirmation === false && ["RECEPTION", "ACCOUNTANT"].includes(station.role);
  const at = new Date(), completionId = randomUUID();
  const status = input.complete && nonclinical ? "CONFIRMED" : "IN_PROGRESS";
  if (!input.complete && stage.status === status) return { changed: false };
  await tx.careStage.update({ where: { id: stage.id }, data: { status,
    ...(input.complete ? { operationalCompletedById: actor.userId, operationalCompletedAt: at, operationalCompletionId: completionId } : {}),
    ...(status === "CONFIRMED" ? { confirmedById: actor.userId, confirmedBy: user.fullName, confirmedAt: at } : {}),
  } });
  if (input.complete) await tx.notification.updateMany({ where: { careStageId: stage.id, resolvedAt: null }, data: { resolvedAt: at } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "care_stages", recordId: stage.id,
    newValue: { status, serviceAssignmentId: input.assignmentId, serviceAuthorityId: stage.serviceAuthorityId, operationalCompletion: input.complete,
      ...(input.complete ? { operationalCompletedById: actor.userId, operationalCompletedAt: at.toISOString(), operationalCompletionId: completionId } : {}) } } });
  return { changed: true };
}
