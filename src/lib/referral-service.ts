import type { ReferralRequestStatus, ReferralRequestType, ReferralDestinationScope, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notifyRoleInTransaction, notifyUserInTransaction } from "@/lib/notify";
import { validateReferralPatch, validateReferralTransition } from "@/lib/referral-workflow";

export type ReferralActorContext = {
  userId: string;
  role: UserRole;
  permissions: Set<string>;
};

export type ReferralDraftInput = {
  patientId: string;
  residentReviewId?: string | null;
  type: ReferralRequestType;
  destinationScope: ReferralDestinationScope;
  externalEntity?: string | null;
  requestedService: string;
  clinicalReason: string;
  assignedReviewerId?: string | null;
  destinationCenterId?: number | null;
};

export type ReferralTransitionInput = {
  resultSummary?: string | null;
  resultAttachmentUrl?: string | null;
  cancellationReason?: string | null;
  acceptedById?: string | null;
  official?: { number: string; docDate: Date; subject: string; body?: string | null };
};

const clean = (value?: string | null) => value?.trim() || null;

function assertCreateActor(actor: ReferralActorContext) {
  if (!actor.permissions.has("referrals.create")) throw new Error("لا تملك صلاحية إنشاء طلب إحالة");
  if (actor.role !== "RESIDENT" && actor.role !== "DOCTOR") throw new Error("إنشاء القرار الطبي متاح للطبيب فقط");
}

function validateDraft(input: ReferralDraftInput) {
  if (!input.patientId || !input.type || !input.destinationScope) throw new Error("بيانات الطلب الأساسية مطلوبة");
  if (!clean(input.requestedService) || !clean(input.clinicalReason)) throw new Error("الخدمة المطلوبة والسبب السريري مطلوبان");
  if (input.destinationScope === "EXTERNAL") {
    if (!clean(input.externalEntity)) throw new Error("الجهة الخارجية مطلوبة");
    if (!input.assignedReviewerId) throw new Error("حدد الطبيب المراجع");
    if (input.destinationCenterId) throw new Error("لا يرتبط الطلب الخارجي بمركز داخلي");
  }
  if (input.destinationScope === "INTERNAL_SPECIALIST") {
    if (input.type !== "SPECIALIST" || !input.assignedReviewerId) throw new Error("حدد طبيب الاختصاص للإحالة الداخلية");
    if (input.externalEntity || input.destinationCenterId) throw new Error("وجهة إحالة الاختصاص الداخلية غير صالحة");
  }
  if (input.destinationScope === "INTERNAL_CENTER") {
    if (input.type !== "TREATMENT_CENTER" || !input.destinationCenterId) throw new Error("حدد المركز العلاجي الداخلي");
    if (input.externalEntity) throw new Error("لا تستخدم جهة خارجية للإحالة الداخلية");
  }
}

export async function createReferralRequest(input: ReferralDraftInput, actor: ReferralActorContext) {
  assertCreateActor(actor);
  validateDraft(input);
  return prisma.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true, archivedAt: true } });
    if (!patient || patient.archivedAt) throw new Error("ملف المراجع غير متاح");
    if (input.residentReviewId) {
      const review = await tx.residentReview.findFirst({ where: { id: input.residentReviewId, patientId: input.patientId }, select: { id: true } });
      if (!review) throw new Error("تقييم الطبيب المقيم لا يخص هذا المراجع");
    }
    const request = await tx.referralRequest.create({ data: {
      patientId: input.patientId,
      residentReviewId: input.residentReviewId || null,
      createdById: actor.userId,
      assignedReviewerId: input.assignedReviewerId || null,
      destinationCenterId: input.destinationCenterId || null,
      type: input.type,
      destinationScope: input.destinationScope,
      externalEntity: clean(input.externalEntity),
      requestedService: input.requestedService.trim(),
      clinicalReason: input.clinicalReason.trim(),
      statusChangedById: actor.userId,
    } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", tableName: "referral_requests", recordId: request.id, newValue: { status: "DRAFT", type: request.type, destinationScope: request.destinationScope } } });
    return request;
  });
}

export async function updateReferralDraft(id: string, patch: Partial<ReferralDraftInput>, actor: ReferralActorContext) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.referralRequest.findUnique({ where: { id } });
    if (!current) throw new Error("طلب الإحالة غير موجود");
    if (current.status !== "DRAFT") throw new Error("لا يمكن تعديل القرار الطبي بعد مغادرة المسودة");
    if (current.createdById !== actor.userId && actor.role !== "DOCTOR") throw new Error("لا يمكنك تعديل هذه المسودة");
    const lock = validateReferralPatch(current, patch as any);
    if (!lock.ok) throw new Error("يتضمن التعديل حقولاً مقفلة");
    const next = { ...current, ...patch } as ReferralDraftInput;
    validateDraft(next);
    const updated = await tx.referralRequest.update({ where: { id }, data: {
      type: patch.type,
      destinationScope: patch.destinationScope,
      externalEntity: patch.externalEntity === undefined ? undefined : clean(patch.externalEntity),
      requestedService: patch.requestedService?.trim(),
      clinicalReason: patch.clinicalReason?.trim(),
      assignedReviewerId: patch.assignedReviewerId,
      destinationCenterId: patch.destinationCenterId,
    } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "referral_requests", recordId: id, oldValue: { status: current.status }, newValue: { status: updated.status, draftUpdated: true } } });
    return updated;
  });
}

export async function transitionReferralRequest(id: string, toStatus: ReferralRequestStatus, input: ReferralTransitionInput, actor: ReferralActorContext) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.referralRequest.findUnique({ where: { id }, include: { patient: { select: { fileNumber: true } }, destinationCenter: { select: { name: true } } } });
    if (!current) throw new Error("طلب الإحالة غير موجود");

    let officialDocumentId = current.officialDocumentId;
    if (current.status === "PENDING_PRINT" && toStatus === "READY") {
      if (!actor.permissions.has("referrals.print")) throw new Error("لا تملك صلاحية تجهيز كتاب الإرسال");
      if (!input.official?.number.trim() || !input.official.subject.trim()) throw new Error("رقم الكتاب والتاريخ والموضوع مطلوبة");
      const doc = await tx.officialDocument.create({ data: {
        patientId: current.patientId,
        docType: "REFERRAL",
        direction: "OUTGOING",
        number: input.official.number.trim(),
        docDate: input.official.docDate,
        subject: input.official.subject.trim(),
        entity: current.externalEntity,
        body: clean(input.official.body),
        createdById: actor.userId,
      } });
      officialDocumentId = doc.id;
    }

    const validation = validateReferralTransition({
      request: { ...current, officialDocumentId },
      actor: { userId: actor.userId, role: actor.role, permissions: [...actor.permissions] },
      toStatus,
      input: {
        resultSummary: input.resultSummary,
        resultAttachmentUrl: input.resultAttachmentUrl,
        cancellationReason: input.cancellationReason,
        officialDocumentId,
        acceptedById: input.acceptedById,
        centerMembershipVerified: current.destinationScope === "INTERNAL_CENTER" && actor.permissions.has("referrals.accept"),
      },
    });
    if (!validation.ok) throw new Error(`انتقال غير صالح: ${validation.errors.join(", ")}`);
    if (toStatus === "REVIEWED" && current.assignedReviewerId !== actor.userId) throw new Error("الطبيب المراجع المحدد فقط يستطيع اعتماد النتيجة");

    let careStageId = current.careStageId;
    if (validation.effects.createCareStage && !careStageId) {
      const last = await tx.careStage.aggregate({ where: { patientId: current.patientId }, _max: { sequence: true } });
      const stage = await tx.careStage.create({ data: {
        patientId: current.patientId,
        station: current.destinationCenter?.name || current.requestedService,
        responsibleRole: current.destinationScope === "INTERNAL_SPECIALIST" ? "DOCTOR" : "HEAD_THERAPIST",
        sequence: (last._max.sequence ?? -1) + 1,
        note: "ناتجة عن إحالة داخلية مقبولة",
        createdById: actor.userId,
      } });
      careStageId = stage.id;
    }

    const update: any = {
      status: toStatus,
      statusChangedById: actor.userId,
      statusChangedAt: new Date(),
      officialDocumentId,
      careStageId,
    };
    if (validation.effects.setSentAt) update.sentAt = new Date();
    if (validation.effects.setResultReceivedAt) {
      update.resultReceivedAt = new Date();
      update.resultSummary = input.resultSummary!.trim();
      update.resultAttachmentUrl = input.resultAttachmentUrl || null;
    }
    if (validation.effects.setReviewedAt) {
      update.reviewedAt = new Date();
      update.reviewedById = actor.userId;
    }
    if (validation.effects.setAcceptedAt) {
      update.acceptedAt = new Date();
      update.acceptedById = actor.userId;
    }
    if (toStatus === "CANCELLED") {
      update.cancellationReason = input.cancellationReason!.trim();
      update.cancelledById = actor.userId;
    }

    const updated = await tx.referralRequest.update({ where: { id }, data: update });
    const link = `/referrals/${id}`;
    for (const recipient of validation.notificationRecipients) {
      if (recipient.kind === "ROLE") await notifyRoleInTransaction(tx as any, recipient.role as UserRole, "طلب إحالة يحتاج المتابعة", { link });
      else await notifyUserInTransaction(tx as any, recipient.userId, toStatus === "ACCEPTED" ? "قُبلت الإحالة الداخلية" : "وصلت نتيجة طلب طبي", { link });
    }
    if (toStatus === "READY" && current.destinationScope === "EXTERNAL") await notifyUserInTransaction(tx as any, current.createdById, "كتاب الإرسال جاهز", { link });
    if (toStatus === "SENT") await notifyUserInTransaction(tx as any, current.createdById, "تم إرسال طلب الفحص أو الإحالة", { link });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "referral_requests", recordId: id, oldValue: { status: current.status }, newValue: { status: toStatus, officialDocumentId, careStageId, resultRecorded: toStatus === "RESULT_RECEIVED", cancellationReason: toStatus === "CANCELLED" ? input.cancellationReason : undefined } } });
    return updated;
  }, { isolationLevel: "Serializable" });
}
