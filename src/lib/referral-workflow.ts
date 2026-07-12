export const REFERRAL_REQUEST_TYPES = [
  "LAB",
  "RADIOLOGY",
  "IMAGING",
  "SPECIALIST",
  "TREATMENT_CENTER",
  "HOSPITAL",
  "OTHER",
] as const;

export const REFERRAL_DESTINATION_SCOPES = [
  "INTERNAL_SPECIALIST",
  "INTERNAL_CENTER",
  "EXTERNAL",
] as const;

export const REFERRAL_REQUEST_STATUSES = [
  "DRAFT",
  "PENDING_PRINT",
  "READY",
  "SENT",
  "RESULT_RECEIVED",
  "REVIEWED",
  "ACCEPTED",
  "CANCELLED",
] as const;

export type ReferralRequestType = (typeof REFERRAL_REQUEST_TYPES)[number];
export type ReferralDestinationScope = (typeof REFERRAL_DESTINATION_SCOPES)[number];
export type ReferralRequestStatus = (typeof REFERRAL_REQUEST_STATUSES)[number];

export type ReferralActorRole =
  | "ADMIN"
  | "MANAGER"
  | "DATA_ENTRY"
  | "RESIDENT"
  | "DOCTOR"
  | string;

export type ReferralPermission =
  | "referrals.view"
  | "referrals.create"
  | "referrals.print"
  | "referrals.updateStatus"
  | "referrals.recordResult"
  | "referrals.reviewResult"
  | "referrals.accept"
  | "referrals.cancel";

export type ReferralRequestSnapshot = {
  id?: string;
  patientId: string;
  createdById: string;
  type?: ReferralRequestType | null;
  destinationScope: ReferralDestinationScope;
  externalEntity?: string | null;
  requestedService?: string | null;
  clinicalReason?: string | null;
  assignedReviewerId?: string | null;
  destinationCenterId?: number | null;
  officialDocumentId?: string | null;
  resultSummary?: string | null;
  resultAttachmentUrl?: string | null;
  status: ReferralRequestStatus;
};

export type ReferralActor = {
  userId: string;
  role: ReferralActorRole;
  permissions: readonly string[];
};

export type TransitionInput = {
  resultSummary?: string | null;
  resultAttachmentUrl?: string | null;
  cancellationReason?: string | null;
  officialDocumentId?: string | null;
  acceptedById?: string | null;
  centerMembershipVerified?: boolean;
};

export type ReferralValidationCode =
  | "TRANSITION_NOT_ALLOWED"
  | "ROLE_NOT_ALLOWED"
  | "PERMISSION_REQUIRED"
  | "TYPE_REQUIRED"
  | "EXTERNAL_ENTITY_REQUIRED"
  | "EXTERNAL_ENTITY_NOT_ALLOWED"
  | "SERVICE_REQUIRED"
  | "CLINICAL_REASON_REQUIRED"
  | "ASSIGNED_REVIEWER_REQUIRED"
  | "DESTINATION_CENTER_REQUIRED"
  | "DESTINATION_CENTER_NOT_ALLOWED"
  | "INTERNAL_SPECIALIST_TYPE_REQUIRED"
  | "INTERNAL_CENTER_TYPE_REQUIRED"
  | "OFFICIAL_DOCUMENT_REQUIRED"
  | "OFFICIAL_DOCUMENT_NOT_ALLOWED"
  | "RESULT_SUMMARY_REQUIRED"
  | "CANCELLATION_REASON_REQUIRED"
  | "REVIEWED_BY_REQUIRED"
  | "ACCEPTED_BY_REQUIRED"
  | "ACCEPTED_BY_MISMATCH"
  | "ASSIGNED_REVIEWER_MUST_ACCEPT"
  | "CENTER_MEMBERSHIP_VERIFICATION_REQUIRED"
  | "CANCELLED_BY_REQUIRED"
  | "FIELD_LOCKED"
  | "DELETE_NOT_ALLOWED";

export type NotificationRecipient =
  | { kind: "ROLE"; role: "MANAGER" | "DOCTOR" }
  | { kind: "USER"; userId: string; purpose: "ASSIGNED_REVIEWER" | "CREATOR" };

export type TransitionEffects = {
  setSentAt: boolean;
  setResultReceivedAt: boolean;
  setReviewedAt: boolean;
  setAcceptedAt: boolean;
  reviewedById?: string;
  acceptedById?: string;
  cancelledById?: string;
  createCareStage: null | {
    patientId: string;
    referralRequestId?: string;
    destinationScope: "INTERNAL_SPECIALIST" | "INTERNAL_CENTER";
    destinationCenterId?: number;
  };
};

export type TransitionValidation = {
  ok: boolean;
  errors: ReferralValidationCode[];
  requiredPermission: ReferralPermission | null;
  notificationRecipients: NotificationRecipient[];
  effects: TransitionEffects;
};

const blank = (value: string | null | undefined) => !value?.trim();
const isInternal = (scope: ReferralDestinationScope) => scope !== "EXTERNAL";

export function referralNeedsOfficialDocument(scope: ReferralDestinationScope) {
  return scope === "EXTERNAL";
}

export function requiredPermissionForTransition(
  from: ReferralRequestStatus,
  to: ReferralRequestStatus,
): ReferralPermission | null {
  if (to === "CANCELLED" && from !== "CANCELLED" && from !== "REVIEWED") return "referrals.cancel";
  if (from === "DRAFT" && (to === "PENDING_PRINT" || to === "READY")) return "referrals.updateStatus";
  if (from === "PENDING_PRINT" && to === "READY") return "referrals.print";
  if (from === "READY" && to === "SENT") return "referrals.updateStatus";
  if (from === "SENT" && to === "RESULT_RECEIVED") return "referrals.recordResult";
  if (from === "RESULT_RECEIVED" && to === "REVIEWED") return "referrals.reviewResult";
  if (from === "READY" && to === "ACCEPTED") return "referrals.accept";
  return null;
}

function transitionExists(request: ReferralRequestSnapshot, to: ReferralRequestStatus) {
  const from = request.status;
  if (from === "REVIEWED" || from === "CANCELLED") return false;
  if (to === "CANCELLED") return ["DRAFT", "PENDING_PRINT", "READY", "SENT"].includes(from);
  if (request.destinationScope === "EXTERNAL") {
    return (
      (from === "DRAFT" && to === "PENDING_PRINT") ||
      (from === "PENDING_PRINT" && to === "READY") ||
      (from === "READY" && to === "SENT") ||
      (from === "SENT" && to === "RESULT_RECEIVED") ||
      (from === "RESULT_RECEIVED" && to === "REVIEWED")
    );
  }
  return (from === "DRAFT" && to === "READY") || (from === "READY" && to === "ACCEPTED");
}

function roleAllowsTransition(
  request: ReferralRequestSnapshot,
  actor: ReferralActor,
  to: ReferralRequestStatus,
) {
  const from = request.status;
  const role = actor.role;
  if (to === "CANCELLED") {
    if (from === "SENT") return role === "DOCTOR" || role === "ADMIN";
    const isMedicalCreator = actor.userId === request.createdById && (role === "RESIDENT" || role === "DOCTOR");
    return isMedicalCreator || role === "DOCTOR";
  }
  if (from === "DRAFT") return role === "RESIDENT" || role === "DOCTOR";
  if (from === "PENDING_PRINT" && to === "READY") {
    return role === "MANAGER" || role === "DATA_ENTRY" || role === "ADMIN";
  }
  if (from === "READY" && to === "SENT") {
    return role === "MANAGER" || role === "DATA_ENTRY" || role === "ADMIN";
  }
  if (from === "SENT" && to === "RESULT_RECEIVED") {
    return role === "DATA_ENTRY" || role === "RESIDENT" || role === "DOCTOR";
  }
  if (from === "RESULT_RECEIVED" && to === "REVIEWED") return role === "DOCTOR";
  if (from === "READY" && to === "ACCEPTED") {
    if (request.destinationScope === "INTERNAL_SPECIALIST") {
      return role === "DOCTOR" && actor.userId === request.assignedReviewerId;
    }
    return request.destinationScope === "INTERNAL_CENTER";
  }
  return false;
}

function notificationRecipients(
  request: ReferralRequestSnapshot,
  to: ReferralRequestStatus,
): NotificationRecipient[] {
  if (to === "PENDING_PRINT") return [{ kind: "ROLE", role: "MANAGER" }];
  if (to === "READY" && isInternal(request.destinationScope)) {
    return request.destinationScope === "INTERNAL_SPECIALIST"
      ? [{ kind: "ROLE", role: "DOCTOR" }]
      : [];
  }
  if (to !== "RESULT_RECEIVED") return [];
  const recipients: NotificationRecipient[] = [];
  if (request.assignedReviewerId) {
    recipients.push({ kind: "USER", userId: request.assignedReviewerId, purpose: "ASSIGNED_REVIEWER" });
  }
  if (request.createdById && request.createdById !== request.assignedReviewerId) {
    recipients.push({ kind: "USER", userId: request.createdById, purpose: "CREATOR" });
  }
  return recipients;
}

function acceptanceNotification(request: ReferralRequestSnapshot): NotificationRecipient[] {
  return request.createdById
    ? [{ kind: "USER", userId: request.createdById, purpose: "CREATOR" }]
    : [];
}

export function validateReferralTransition(args: {
  request: ReferralRequestSnapshot;
  actor: ReferralActor;
  toStatus: ReferralRequestStatus;
  input?: TransitionInput;
}): TransitionValidation {
  const { request, actor, toStatus } = args;
  const input = args.input ?? {};
  const errors: ReferralValidationCode[] = [];
  const requiredPermission = requiredPermissionForTransition(request.status, toStatus);

  if (!transitionExists(request, toStatus)) errors.push("TRANSITION_NOT_ALLOWED");
  if (requiredPermission && !actor.permissions.includes(requiredPermission)) errors.push("PERMISSION_REQUIRED");
  if (transitionExists(request, toStatus) && !roleAllowsTransition(request, actor, toStatus)) errors.push("ROLE_NOT_ALLOWED");

  if (request.status === "DRAFT" && (toStatus === "PENDING_PRINT" || toStatus === "READY")) {
    if (!request.type) errors.push("TYPE_REQUIRED");
    if (blank(request.requestedService)) errors.push("SERVICE_REQUIRED");
    if (blank(request.clinicalReason)) errors.push("CLINICAL_REASON_REQUIRED");
    if (request.destinationScope === "EXTERNAL" && blank(request.externalEntity)) errors.push("EXTERNAL_ENTITY_REQUIRED");
    if (isInternal(request.destinationScope) && !blank(request.externalEntity)) errors.push("EXTERNAL_ENTITY_NOT_ALLOWED");
    if (request.destinationScope === "EXTERNAL" && blank(request.assignedReviewerId)) errors.push("ASSIGNED_REVIEWER_REQUIRED");
    if (request.destinationScope === "EXTERNAL" && request.destinationCenterId != null) errors.push("DESTINATION_CENTER_NOT_ALLOWED");
    if (request.destinationScope === "INTERNAL_SPECIALIST") {
      if (request.type !== "SPECIALIST") errors.push("INTERNAL_SPECIALIST_TYPE_REQUIRED");
      if (blank(request.assignedReviewerId)) errors.push("ASSIGNED_REVIEWER_REQUIRED");
      if (request.destinationCenterId != null) errors.push("DESTINATION_CENTER_NOT_ALLOWED");
    }
    if (request.destinationScope === "INTERNAL_CENTER") {
      if (request.type !== "TREATMENT_CENTER") errors.push("INTERNAL_CENTER_TYPE_REQUIRED");
      if (request.destinationCenterId == null) errors.push("DESTINATION_CENTER_REQUIRED");
    }
  }

  const officialDocumentId = input.officialDocumentId ?? request.officialDocumentId;
  if (request.destinationScope === "EXTERNAL" && request.status === "PENDING_PRINT" && toStatus === "READY" && blank(officialDocumentId)) {
    errors.push("OFFICIAL_DOCUMENT_REQUIRED");
  }
  if (isInternal(request.destinationScope) && !blank(officialDocumentId)) errors.push("OFFICIAL_DOCUMENT_NOT_ALLOWED");

  if (toStatus === "RESULT_RECEIVED" && blank(input.resultSummary)) errors.push("RESULT_SUMMARY_REQUIRED");
  if (toStatus === "CANCELLED" && blank(input.cancellationReason)) errors.push("CANCELLATION_REASON_REQUIRED");
  if (toStatus === "ACCEPTED") {
    if (blank(input.acceptedById)) errors.push("ACCEPTED_BY_REQUIRED");
    if (!blank(input.acceptedById) && input.acceptedById !== actor.userId) errors.push("ACCEPTED_BY_MISMATCH");
    if (request.destinationScope === "INTERNAL_SPECIALIST" && actor.userId !== request.assignedReviewerId) {
      errors.push("ASSIGNED_REVIEWER_MUST_ACCEPT");
    }
    if (request.destinationScope === "INTERNAL_CENTER" && input.centerMembershipVerified !== true) {
      errors.push("CENTER_MEMBERSHIP_VERIFICATION_REQUIRED");
    }
  }

  const effects: TransitionEffects = {
    setSentAt: request.status === "READY" && toStatus === "SENT",
    setResultReceivedAt: request.status === "SENT" && toStatus === "RESULT_RECEIVED",
    setReviewedAt: request.status === "RESULT_RECEIVED" && toStatus === "REVIEWED",
    setAcceptedAt: request.status === "READY" && toStatus === "ACCEPTED",
    createCareStage: null,
  };
  if (effects.setReviewedAt && actor.role === "DOCTOR") effects.reviewedById = actor.userId;
  if (effects.setAcceptedAt && input.acceptedById === actor.userId) {
    effects.acceptedById = actor.userId;
    if (isInternal(request.destinationScope)) {
      effects.createCareStage = {
        patientId: request.patientId,
        referralRequestId: request.id,
        destinationScope: request.destinationScope,
        ...(request.destinationCenterId == null ? {} : { destinationCenterId: request.destinationCenterId }),
      };
    }
  }
  if (toStatus === "CANCELLED" && transitionExists(request, toStatus)) effects.cancelledById = actor.userId;

  if (effects.setReviewedAt && !effects.reviewedById) errors.push("REVIEWED_BY_REQUIRED");
  if (effects.setAcceptedAt && !effects.acceptedById) errors.push("ACCEPTED_BY_REQUIRED");
  if (toStatus === "CANCELLED" && transitionExists(request, toStatus) && !effects.cancelledById) errors.push("CANCELLED_BY_REQUIRED");

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    requiredPermission,
    notificationRecipients: errors.length === 0
      ? (toStatus === "ACCEPTED" ? acceptanceNotification(request) : notificationRecipients(request, toStatus))
      : [],
    effects,
  };
}

const ALWAYS_LOCKED_FIELDS = ["patientId", "createdById"] as const;
const MEDICAL_FIELDS = ["type", "destinationScope", "externalEntity", "requestedService", "clinicalReason"] as const;

export function validateReferralPatch(
  current: ReferralRequestSnapshot,
  patch: Partial<ReferralRequestSnapshot>,
) {
  const lockedFields: string[] = [];
  for (const field of ALWAYS_LOCKED_FIELDS) {
    if (field in patch && patch[field] !== current[field]) lockedFields.push(field);
  }
  if (current.status !== "DRAFT") {
    for (const field of MEDICAL_FIELDS) {
      if (field in patch && patch[field] !== current[field]) lockedFields.push(field);
    }
  }
  if (["RESULT_RECEIVED", "REVIEWED"].includes(current.status)) {
    if ("assignedReviewerId" in patch && patch.assignedReviewerId !== current.assignedReviewerId) {
      lockedFields.push("assignedReviewerId");
    }
  }
  return {
    ok: lockedFields.length === 0,
    errors: lockedFields.length ? (["FIELD_LOCKED"] as ReferralValidationCode[]) : [],
    lockedFields,
  };
}

export function validateReferralDeletion(_status: ReferralRequestStatus) {
  return {
    ok: false as const,
    errors: ["DELETE_NOT_ALLOWED"] as ReferralValidationCode[],
  };
}
