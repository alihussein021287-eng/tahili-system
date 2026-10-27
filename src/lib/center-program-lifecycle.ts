import { randomUUID } from "node:crypto";
import type { Prisma, CenterSessionStatus } from "@prisma/client";
import { clinicalActor, assertAcceptedClinicalReview, type ClinicalActor } from "@/lib/clinical-review-service";
import { handOverInTransaction } from "@/lib/handoff-service";
import { currentTherapyActor } from "@/lib/therapy-session-lock";

export async function lockEditableCenterProgram(tx: Prisma.TransactionClient, actor: ClinicalActor, centerId: number, programId: string, permission: string) {
  await tx.$queryRaw`SELECT id FROM center_programs WHERE id = ${programId} FOR UPDATE`;
  const p = await tx.centerProgram.findFirst({ where: { id: programId, centerId } });
  if (!p || p.status !== "ACTIVE" || p.operationalCompletedAt) throw new Error("البرنامج مقفل بعد إكمال العمل؛ لا تعديل جلسات أو جدولة");
  const current = await currentTherapyActor(tx, { id: actor.userId, role: actor.role, authVersion: actor.authVersion }, permission, p.patientId);
  // Preserve the pre-existing central scheduling authority, never finalization.
  const centralScheduling = permission === "centers.programs.manage"
    && (current.role === "ADMIN" || (current.role === "MANAGER" && current.permissions.has("centers.central.view")));
  const user = centralScheduling ? current : await clinicalActor(tx, actor, permission, p.patientId, centerId, actor.role);
  return { ...p, actorPermissions: user.permissions };
}

/** Same program lock as scheduling and both END steps; no resident/ADMIN exception after completion. */
export async function recordCenterSessionInTransaction(tx: Prisma.TransactionClient, actor: ClinicalActor, centerId: number, sessionId: string, input: {
  status: CenterSessionStatus; attended: boolean; procedure?: string | null; result?: string | null; progress?: string | null; notes?: string | null; sensitiveNotes?: string | null;
}) {
  if (!["SCHEDULED", "ATTENDED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(input.status)) throw new Error("حالة جلسة غير صالحة");
  const pointer = await tx.centerSession.findFirst({ where: { id: sessionId, centerId }, select: { programId: true } });
  if (!pointer) throw new Error("غير مصرح");
  const p = await lockEditableCenterProgram(tx, actor, centerId, pointer.programId, "centers.sessions.record");
  await tx.$queryRaw`SELECT id FROM center_sessions WHERE id=${sessionId} FOR UPDATE`;
  const current = await tx.centerSession.findFirst({ where: { id: sessionId, centerId, programId: p.id } });
  if (!current || current.assignedToId !== actor.userId) throw new Error("المسؤول المسند فقط يستطيع تسجيل الجلسة");
  if (current.status === "COMPLETED" && input.status === "COMPLETED") return;
  await tx.centerSession.update({ where: { id: sessionId }, data: { status: input.status, attended: input.attended,
    procedure: input.procedure, result: input.result, progress: input.progress, notes: input.notes,
    sensitiveNotes: p.serviceType === "PSYCHOLOGICAL" && p.actorPermissions.has("centers.psych.sensitive") ? input.sensitiveNotes : undefined,
    completedAt: input.status === "COMPLETED" ? new Date() : null } });
  if (current.appointmentId) await tx.appointment.update({ where: { id: current.appointmentId }, data: {
    status: input.status === "COMPLETED" ? "COMPLETED" : input.status === "NO_SHOW" ? "NOSHOW" : input.status === "CANCELLED" ? "CANCELLED" : "SCHEDULED",
  } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "center_sessions", recordId: sessionId,
    newValue: { status: input.status, attended: input.attended } } });
}

export async function completeCenterProgramWork(tx: Prisma.TransactionClient, actor: ClinicalActor, centerId: number, programId: string, input: {
  finalSummary: string; improvementLevel: string; recommendation: string; returnToConsultancy: boolean; sensitiveNotes?: string | null;
}) {
  const p = await lockEditableCenterProgram(tx, actor, centerId, programId, "centers.programs.finalize");
  await clinicalActor(tx, actor, "centers.programs.finalize", p.patientId, centerId, "HEAD_THERAPIST");
  if (!input.finalSummary.trim() || !input.improvementLevel.trim() || !input.recommendation.trim()) throw new Error("التقييم النهائي والتحسن والتوصية مطلوبة");
  const pending = await tx.centerSession.count({ where: { programId, status: { in: ["SCHEDULED", "ATTENDED"] } } });
  const completed = await tx.centerSession.count({ where: { programId, status: "COMPLETED", completedAt: { not: null } } });
  if (pending || !completed) throw new Error("يلزم جلسة مكتملة وألا توجد جلسات معلقة");
  const user = await clinicalActor(tx, actor, "centers.programs.finalize", p.patientId, centerId, "HEAD_THERAPIST");
  const at = new Date(), completionId = randomUUID();
  await tx.centerAssessment.create({ data: { programId, patientId: p.patientId, kind: "FINAL", summary: input.finalSummary,
    improvementLevel: input.improvementLevel, recommendation: input.recommendation,
    sensitiveNotes: p.serviceType === "PSYCHOLOGICAL" && user.permissions.has("centers.psych.sensitive") ? input.sensitiveNotes : null, createdById: actor.userId } });
  await tx.centerProgram.update({ where: { id: programId }, data: { finalSummary: input.finalSummary, improvementLevel: input.improvementLevel,
    recommendation: input.recommendation, returnToConsultancy: input.returnToConsultancy,
    operationalCompletedById: actor.userId, operationalCompletedAt: at, operationalCompletionId: completionId } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "center_programs", recordId: programId,
    newValue: { operationalCompletedById: actor.userId, operationalCompletedAt: at.toISOString(), operationalCompletionId: completionId, status: "ACTIVE" } } });
  const reviewer = await tx.clinicalReviewAssignment.findFirst({ where: { programId, revokedAt: null, acceptedAt: { not: null } } });
  if (reviewer) await tx.notification.create({ data: { targetUserId: reviewer.reviewerId, title: "برنامج مكتمل تشغيلياً ينتظر مراجعتك الطبية", link: p.referralRequestId ? `/referrals/${p.referralRequestId}` : `/patients/${p.patientId}` } });
  if (input.returnToConsultancy && reviewer) {
    // Preserve the operational return, using accepted designation instead of a
    // referral creator/role fallback. This handoff confers no clinical approval.
    const doctor = await tx.user.findUniqueOrThrow({ where: { id: reviewer.reviewerId }, select: { authVersion: true } });
    let eligible = false;
    try {
      await assertAcceptedClinicalReview(tx, { userId: reviewer.reviewerId, role: "DOCTOR", authVersion: doctor.authVersion }, { kind: "PROGRAM", id: p.id }, p.patientId, centerId, reviewer.id);
      eligible = true;
    } catch (error) {
      // Revoked medical responsibility cannot strand independently valid work.
      // Infrastructure/serialization failures still abort the entire transaction.
      if (!(error instanceof Error) || !error.message.startsWith("غير مصرح")) throw error;
    }
    if (eligible) await handOverInTransaction(tx as never, { patientId: p.patientId, actorId: actor.userId, actorRole: "HEAD_THERAPIST", toRole: "DOCTOR", toUserId: reviewer.reviewerId, toCenterId: centerId, note: "إكمال البرنامج تشغيلياً؛ بانتظار المراجعة الطبية الصريحة" });
  }
  return completionId;
}

export async function confirmCenterProgramMedical(tx: Prisma.TransactionClient, actor: ClinicalActor, centerId: number, programId: string, expectedCompletionId: string, expectedAssignmentId: string) {
  await tx.$queryRaw`SELECT id FROM center_programs WHERE id = ${programId} FOR UPDATE`;
  const p = await tx.centerProgram.findFirst({ where: { id: programId, centerId } });
  if (!p || !p.operationalCompletedAt || !p.operationalCompletedById || p.operationalCompletedById === actor.userId
    || !expectedCompletionId || p.operationalCompletionId !== expectedCompletionId) throw new Error("إكمال العمل غير موثق أو تغيّر");
  const a = await assertAcceptedClinicalReview(tx, actor, { kind: "PROGRAM", id: p.id }, p.patientId, centerId, expectedAssignmentId);
  if (p.status === "COMPLETED" && p.medicalClosedById === actor.userId) return;
  if (p.status !== "ACTIVE") throw new Error("البرنامج غير متاح");
  if (await tx.centerSession.count({ where: { programId, status: { in: ["SCHEDULED", "ATTENDED"] } } })) throw new Error("توجد جلسات معلقة");
  const at = new Date();
  await tx.centerProgram.update({ where: { id: programId }, data: { status: "COMPLETED", closedAt: at, medicalClosedAt: at, medicalClosedById: actor.userId } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "center_programs", recordId: programId,
    newValue: { status: "COMPLETED", medicalClosedById: actor.userId, medicalClosedAt: at.toISOString(), assignmentId: a.id, operationalCompletionId: expectedCompletionId } } });
}
