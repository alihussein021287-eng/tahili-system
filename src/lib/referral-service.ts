import type { Prisma, ReferralRequestStatus, ReferralRequestType, ReferralDestinationScope, UserRole } from "@prisma/client";
import { withSerializableRetry } from "@/lib/serializable-retry";
import { prisma } from "@/lib/db";
import { notifyRoleInTransaction, notifyUserInTransaction } from "@/lib/notify";
import { validateReferralPatch, validateReferralTransition } from "@/lib/referral-workflow";
import { referralAccessScope } from "@/lib/referral-access";
import { loadPermissionsFromStore } from "@/lib/permission-store";

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
  /** Optional therapist the doctor suggests for an internal-centre referral; the head therapist still decides. */
  suggestedTherapistId?: string | null;
};

export type ReferralTransitionInput = {
  resultSummary?: string | null;
  resultAttachmentUrl?: string | null;
  cancellationReason?: string | null;
  acceptedById?: string | null;
  official?: { number: string; docDate: Date; subject: string; body?: string | null };
};

const clean = (value?: string | null) => value?.trim() || null;

async function currentTransactionActor(tx: Prisma.TransactionClient, actor: ReferralActorContext): Promise<ReferralActorContext> {
  const permissions = await loadPermissionsFromStore(actor.userId, actor.role, {
    findRolePermissions: (role) => tx.rolePermission.findMany({ where: { role } }),
    findUserPermissions: (userId) => tx.userPermission.findMany({ where: { userId } }),
  });
  return { ...actor, permissions };
}

function assertCreateActor(actor: ReferralActorContext) {
  if (!actor.permissions.has("referrals.create")) throw new Error("لا تملك صلاحية إنشاء طلب إحالة");
  if (actor.role !== "RESIDENT" && actor.role !== "DOCTOR") throw new Error("إنشاء القرار الطبي متاح للطبيب فقط");
}

// A suggested therapist must be an active therapist of the destination centre.
async function assertSuggestedTherapist(tx: any, therapistId: string, centerId?: number | null) {
  const therapist = centerId ? await tx.user.findFirst({ where: { id: therapistId, isActive: true, role: "THERAPIST", centerMemberships: { some: { centerId, role: "THERAPIST", status: "ACTIVE" } } }, select: { id: true } }) : null;
  if (!therapist) throw new Error("المعالج المقترح ليس معالجاً فعالاً في هذا المركز");
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
  if (input.suggestedTherapistId && input.destinationScope !== "INTERNAL_CENTER") throw new Error("اقتراح المعالج للإحالة إلى مركز داخلي فقط");
}

export async function createReferralRequest(input: ReferralDraftInput, actor: ReferralActorContext) {
  validateDraft(input);
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    actor = await currentTransactionActor(tx, actor);
    assertCreateActor(actor);
    const access = await referralAccessScope(tx, actor);
    const patient = await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true, branchId: true, archivedAt: true } });
    if (!patient || patient.archivedAt) throw new Error("ملف المراجع غير متاح");
    if (!access.branchId || patient.branchId !== access.branchId) throw new Error("غير مصرح");
    if (input.residentReviewId) {
      const review = await tx.residentReview.findFirst({ where: { id: input.residentReviewId, patientId: input.patientId }, select: { id: true } });
      if (!review) throw new Error("تقييم الطبيب المقيم لا يخص هذا المراجع");
    }
    if (input.suggestedTherapistId) await assertSuggestedTherapist(tx, input.suggestedTherapistId, input.destinationCenterId);
    const request = await tx.referralRequest.create({ data: {
      patientId: input.patientId,
      residentReviewId: input.residentReviewId || null,
      createdById: actor.userId,
      assignedReviewerId: input.assignedReviewerId || null,
      destinationCenterId: input.destinationCenterId || null,
      suggestedTherapistId: input.suggestedTherapistId || null,
      type: input.type,
      destinationScope: input.destinationScope,
      externalEntity: clean(input.externalEntity),
      requestedService: input.requestedService.trim(),
      clinicalReason: input.clinicalReason.trim(),
      statusChangedById: actor.userId,
    } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", tableName: "referral_requests", recordId: request.id, newValue: { status: "DRAFT", type: request.type, destinationScope: request.destinationScope } } });
    return request;
  }, { isolationLevel: "Serializable" }));
}

export async function updateReferralDraft(id: string, patch: Partial<ReferralDraftInput>, actor: ReferralActorContext) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    actor = await currentTransactionActor(tx, actor);
    const access = await referralAccessScope(tx, actor);
    const current = await tx.referralRequest.findFirst({ where: { id, AND: [access.where] } });
    if (!current) throw new Error("غير مصرح");
    if (!actor.permissions.has("referrals.create")) throw new Error("غير مصرح");
    if (current.status !== "DRAFT") throw new Error("لا يمكن تعديل القرار الطبي بعد مغادرة المسودة");
    if (current.createdById !== actor.userId && actor.role !== "DOCTOR") throw new Error("لا يمكنك تعديل هذه المسودة");
    const lock = validateReferralPatch(current, patch as any);
    if (!lock.ok) throw new Error("يتضمن التعديل حقولاً مقفلة");
    const next = { ...current, ...patch } as ReferralDraftInput;
    validateDraft(next);
    if (patch.suggestedTherapistId) await assertSuggestedTherapist(tx, patch.suggestedTherapistId, next.destinationCenterId);
    const updated = await tx.referralRequest.update({ where: { id }, data: {
      type: patch.type,
      destinationScope: patch.destinationScope,
      externalEntity: patch.externalEntity === undefined ? undefined : clean(patch.externalEntity),
      requestedService: patch.requestedService?.trim(),
      clinicalReason: patch.clinicalReason?.trim(),
      assignedReviewerId: patch.assignedReviewerId,
      destinationCenterId: patch.destinationCenterId,
      suggestedTherapistId: patch.suggestedTherapistId === undefined ? undefined : patch.suggestedTherapistId || null,
    } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "referral_requests", recordId: id, oldValue: { status: current.status }, newValue: { status: updated.status, draftUpdated: true } } });
    return updated;
  }, { isolationLevel: "Serializable" }));
}

export async function transitionReferralRequest(id: string, toStatus: ReferralRequestStatus, input: ReferralTransitionInput, actor: ReferralActorContext) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    actor = await currentTransactionActor(tx, actor);
    const access = await referralAccessScope(tx, actor);
    const current = await tx.referralRequest.findFirst({ where: { id, AND: [access.where] }, include: { patient: { select: { fileNumber: true } }, destinationCenter: { select: { name: true } } } });
    if (!current) throw new Error("غير مصرح");

    // The destination center owns acceptance; a generic permission or a
    // different center membership does not establish destination eligibility.
    const destinationMembershipVerified = current.destinationScope === "INTERNAL_CENTER"
      && current.destinationCenterId != null
      && access.centerIds.includes(current.destinationCenterId);
    if (toStatus === "ACCEPTED" && current.destinationScope === "INTERNAL_CENTER"
      && !destinationMembershipVerified && actor.role !== "ADMIN") throw new Error("غير مصرح");

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
        centerMembershipVerified: destinationMembershipVerified || actor.role === "ADMIN",
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
        ...(current.destinationScope === "INTERNAL_CENTER" && current.destinationCenterId != null
          ? { responsibilityScope: "CENTER" as const, responsibleCenterId: current.destinationCenterId }
          : {}),
        sequence: (last._max.sequence ?? -1) + 1,
        note: "ناتجة عن إحالة داخلية مقبولة",
        createdById: actor.userId,
        // Bound to the authenticated assigned reviewer, who must be the acceptor (validated above).
        ...(current.destinationScope === "INTERNAL_SPECIALIST"
          ? { responsibilityScope: "SPECIALIST_REVIEW" as const, assignedUserId: actor.userId, assignedAt: new Date() }
          : {}),
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
  }, { isolationLevel: "Serializable" }));
}
