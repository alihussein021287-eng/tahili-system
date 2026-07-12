import { describe, expect, it } from "vitest";
import {
  referralNeedsOfficialDocument,
  requiredPermissionForTransition,
  validateReferralDeletion,
  validateReferralPatch,
  validateReferralTransition,
  type ReferralActor,
  type ReferralRequestSnapshot,
  type ReferralRequestStatus,
  type TransitionInput,
} from "@/lib/referral-workflow";

const permissions = {
  update: ["referrals.updateStatus"],
  print: ["referrals.print"],
  result: ["referrals.recordResult"],
  review: ["referrals.reviewResult"],
  cancel: ["referrals.cancel"],
} as const;

function actor(role: string, perms: readonly string[], userId = role.toLowerCase()): ReferralActor {
  return { role, permissions: perms, userId };
}

function external(status: ReferralRequestStatus = "DRAFT"): ReferralRequestSnapshot {
  return {
    id: "request-1",
    patientId: "patient-1",
    createdById: "resident-1",
    type: "LAB",
    destinationScope: "EXTERNAL",
    externalEntity: "جهة خارجية",
    requestedService: "فحص مختبري",
    clinicalReason: "سبب سريري",
    assignedReviewerId: "doctor-1",
    destinationCenterId: null,
    officialDocumentId: status === "PENDING_PRINT" || status === "READY" || status === "SENT" || status === "RESULT_RECEIVED" ? "doc-1" : null,
    status,
  };
}

function internal(status: ReferralRequestStatus = "DRAFT"): ReferralRequestSnapshot {
  return {
    ...external(status),
    type: "SPECIALIST",
    destinationScope: "INTERNAL_SPECIALIST",
    externalEntity: null,
    requestedService: "اختصاص العظام",
    officialDocumentId: null,
  };
}

function internalCenter(status: ReferralRequestStatus = "DRAFT"): ReferralRequestSnapshot {
  return {
    ...internal(status),
    type: "TREATMENT_CENTER",
    destinationScope: "INTERNAL_CENTER",
    assignedReviewerId: null,
    destinationCenterId: 7,
    requestedService: "العلاج الطبيعي",
  };
}

function check(
  request: ReferralRequestSnapshot,
  who: ReferralActor,
  toStatus: ReferralRequestStatus,
  input: TransitionInput = {},
) {
  return validateReferralTransition({ request, actor: who, toStatus, input });
}

describe("referral workflow transitions", () => {
  it("allows every approved external transition and declares its permission", () => {
    const draft = check(external(), actor("RESIDENT", permissions.update, "resident-1"), "PENDING_PRINT");
    const ready = check(external("PENDING_PRINT"), actor("MANAGER", permissions.print), "READY");
    const sent = check(external("READY"), actor("DATA_ENTRY", permissions.update), "SENT");
    const received = check(external("SENT"), actor("RESIDENT", permissions.result), "RESULT_RECEIVED", { resultSummary: "نتيجة مختصرة" });
    const reviewed = check(external("RESULT_RECEIVED"), actor("DOCTOR", permissions.review, "doctor-1"), "REVIEWED");
    expect([draft.ok, ready.ok, sent.ok, received.ok, reviewed.ok]).toEqual([true, true, true, true, true]);
    expect([draft.requiredPermission, ready.requiredPermission, sent.requiredPermission, received.requiredPermission, reviewed.requiredPermission])
      .toEqual(["referrals.updateStatus", "referrals.print", "referrals.updateStatus", "referrals.recordResult", "referrals.reviewResult"]);
  });

  it("allows internal preparation then acceptance, but never internal SENT", () => {
    expect(check(internal(), actor("DOCTOR", permissions.update), "READY").ok).toBe(true);
    expect(check(internal("READY"), actor("DOCTOR", ["referrals.accept"], "doctor-1"), "ACCEPTED", { acceptedById: "doctor-1" }).ok).toBe(true);
    expect(check(internal("READY"), actor("MANAGER", permissions.update), "SENT").errors).toContain("TRANSITION_NOT_ALLOWED");
  });

  it("rejects unlisted transitions and skipped states", () => {
    expect(check(external(), actor("DOCTOR", permissions.update), "SENT").errors).toContain("TRANSITION_NOT_ALLOWED");
    expect(check(external("PENDING_PRINT"), actor("MANAGER", permissions.print), "SENT").errors).toContain("TRANSITION_NOT_ALLOWED");
    expect(check(external("READY"), actor("MANAGER", permissions.update), "REVIEWED").errors).toContain("TRANSITION_NOT_ALLOWED");
  });

  it("rejects results before SENT and review before RESULT_RECEIVED", () => {
    expect(check(external("READY"), actor("DOCTOR", permissions.result), "RESULT_RECEIVED", { resultSummary: "نتيجة" }).errors)
      .toContain("TRANSITION_NOT_ALLOWED");
    expect(check(external("SENT"), actor("DOCTOR", permissions.review), "REVIEWED").errors)
      .toContain("TRANSITION_NOT_ALLOWED");
  });

  it("treats REVIEWED and CANCELLED as terminal", () => {
    expect(check(external("REVIEWED"), actor("DOCTOR", permissions.cancel), "CANCELLED").errors).toContain("TRANSITION_NOT_ALLOWED");
    expect(check(external("CANCELLED"), actor("ADMIN", permissions.update), "SENT").errors).toContain("TRANSITION_NOT_ALLOWED");
  });

  it("treats ACCEPTED as terminal and forbids cancellation after acceptance", () => {
    expect(check(internal("ACCEPTED"), actor("DOCTOR", permissions.cancel, "doctor-1"), "CANCELLED", { cancellationReason: "سبب" }).errors)
      .toContain("TRANSITION_NOT_ALLOWED");
    expect(check(internal("ACCEPTED"), actor("DOCTOR", ["referrals.accept"], "doctor-1"), "READY").errors)
      .toContain("TRANSITION_NOT_ALLOWED");
  });
});

describe("referral workflow field requirements", () => {
  it("requires an external entity and rejects one on internal referrals", () => {
    expect(check({ ...external(), externalEntity: " " }, actor("RESIDENT", permissions.update, "resident-1"), "PENDING_PRINT").errors)
      .toContain("EXTERNAL_ENTITY_REQUIRED");
    expect(check({ ...internal(), externalEntity: "جهة خارجية" }, actor("DOCTOR", permissions.update), "READY").errors)
      .toContain("EXTERNAL_ENTITY_NOT_ALLOWED");
  });

  it("requires type, service, clinical reason, and assigned reviewer before leaving DRAFT", () => {
    const request = { ...external(), type: null, requestedService: "", clinicalReason: " ", assignedReviewerId: null };
    const result = check(request, actor("RESIDENT", permissions.update, "resident-1"), "PENDING_PRINT");
    expect(result.errors).toEqual(expect.arrayContaining([
      "TYPE_REQUIRED", "SERVICE_REQUIRED", "CLINICAL_REASON_REQUIRED", "ASSIGNED_REVIEWER_REQUIRED",
    ]));
  });

  it("requires an official document before external READY", () => {
    const result = check({ ...external("PENDING_PRINT"), officialDocumentId: null }, actor("MANAGER", permissions.print), "READY");
    expect(result.errors).toContain("OFFICIAL_DOCUMENT_REQUIRED");
  });

  it("forbids an official document on internal referrals", () => {
    expect(referralNeedsOfficialDocument("EXTERNAL")).toBe(true);
    expect(referralNeedsOfficialDocument("INTERNAL_CENTER")).toBe(false);
    const result = check({ ...internal(), officialDocumentId: "doc-1" }, actor("DOCTOR", permissions.update), "READY");
    expect(result.errors).toContain("OFFICIAL_DOCUMENT_NOT_ALLOWED");
  });

  it("enforces destination-specific type, reviewer, and center requirements", () => {
    expect(check({ ...internal(), type: "LAB" }, actor("DOCTOR", permissions.update), "READY").errors)
      .toContain("INTERNAL_SPECIALIST_TYPE_REQUIRED");
    expect(check({ ...internal(), assignedReviewerId: null }, actor("DOCTOR", permissions.update), "READY").errors)
      .toContain("ASSIGNED_REVIEWER_REQUIRED");
    expect(check({ ...internalCenter(), type: "OTHER" }, actor("DOCTOR", permissions.update), "READY").errors)
      .toContain("INTERNAL_CENTER_TYPE_REQUIRED");
    expect(check({ ...internalCenter(), destinationCenterId: null }, actor("DOCTOR", permissions.update), "READY").errors)
      .toContain("DESTINATION_CENTER_REQUIRED");
  });

  it("forbids destinationCenterId on external and specialist requests", () => {
    expect(check({ ...external(), destinationCenterId: 7 }, actor("DOCTOR", permissions.update), "PENDING_PRINT").errors)
      .toContain("DESTINATION_CENTER_NOT_ALLOWED");
    expect(check({ ...internal(), destinationCenterId: 7 }, actor("DOCTOR", permissions.update), "READY").errors)
      .toContain("DESTINATION_CENTER_NOT_ALLOWED");
  });

  it("requires a result summary even when an attachment is present", () => {
    const missing = check(external("SENT"), actor("DATA_ENTRY", permissions.result), "RESULT_RECEIVED", {
      resultSummary: " ", resultAttachmentUrl: "/api/files/result.pdf",
    });
    const optionalAttachment = check(external("SENT"), actor("DATA_ENTRY", permissions.result), "RESULT_RECEIVED", {
      resultSummary: "النتيجة ضمن الحدود المطلوبة",
    });
    expect(missing.errors).toContain("RESULT_SUMMARY_REQUIRED");
    expect(optionalAttachment.ok).toBe(true);
    expect(optionalAttachment.effects.setResultReceivedAt).toBe(true);
  });
});

describe("referral workflow roles and permissions", () => {
  it("allows RESIDENT medical preparation and optional result recording, but not printing or review", () => {
    expect(check(external(), actor("RESIDENT", permissions.update, "resident-1"), "PENDING_PRINT").ok).toBe(true);
    expect(check(internal(), actor("RESIDENT", permissions.update, "resident-1"), "READY").ok).toBe(true);
    expect(check(external("SENT"), actor("RESIDENT", permissions.result), "RESULT_RECEIVED", { resultSummary: "نتيجة" }).ok).toBe(true);
    expect(check(external("PENDING_PRINT"), actor("RESIDENT", permissions.print), "READY").errors).toContain("ROLE_NOT_ALLOWED");
    expect(check(external("RESULT_RECEIVED"), actor("RESIDENT", permissions.review), "REVIEWED").errors).toContain("ROLE_NOT_ALLOWED");
  });

  it("allows DOCTOR medical preparation, result recording, review, and post-send cancellation", () => {
    expect(check(external(), actor("DOCTOR", permissions.update), "PENDING_PRINT").ok).toBe(true);
    expect(check(external("SENT"), actor("DOCTOR", permissions.result), "RESULT_RECEIVED", { resultSummary: "نتيجة" }).ok).toBe(true);
    const review = check(external("RESULT_RECEIVED"), actor("DOCTOR", permissions.review, "doctor-2"), "REVIEWED");
    expect(review.ok).toBe(true);
    expect(review.effects.reviewedById).toBe("doctor-2");
    expect(check(external("SENT"), actor("DOCTOR", permissions.cancel), "CANCELLED", { cancellationReason: "سبب طبي ملزم" }).ok).toBe(true);
  });

  it("limits DATA_ENTRY to printing, sending, and result recording when permission is present", () => {
    expect(check(external("PENDING_PRINT"), actor("DATA_ENTRY", permissions.print), "READY").ok).toBe(true);
    expect(check(external("READY"), actor("DATA_ENTRY", permissions.update), "SENT").ok).toBe(true);
    expect(check(external("SENT"), actor("DATA_ENTRY", permissions.result), "RESULT_RECEIVED", { resultSummary: "نتيجة" }).ok).toBe(true);
    expect(check(external(), actor("DATA_ENTRY", permissions.update), "PENDING_PRINT").errors).toContain("ROLE_NOT_ALLOWED");
    expect(check(external("RESULT_RECEIVED"), actor("DATA_ENTRY", permissions.review), "REVIEWED").errors).toContain("ROLE_NOT_ALLOWED");
  });

  it("limits MANAGER to administrative readiness and sending", () => {
    expect(check(external("PENDING_PRINT"), actor("MANAGER", permissions.print), "READY").ok).toBe(true);
    expect(check(external("READY"), actor("MANAGER", permissions.update), "SENT").ok).toBe(true);
    expect(check(external(), actor("MANAGER", permissions.update), "PENDING_PRINT").errors).toContain("ROLE_NOT_ALLOWED");
    expect(check(external("RESULT_RECEIVED"), actor("MANAGER", permissions.review), "REVIEWED").errors).toContain("ROLE_NOT_ALLOWED");
  });

  it("keeps ADMIN subject to state order, required fields, and administrative role boundaries", () => {
    const missingDoc = check({ ...external("PENDING_PRINT"), officialDocumentId: null }, actor("ADMIN", permissions.print), "READY");
    expect(missingDoc.errors).toContain("OFFICIAL_DOCUMENT_REQUIRED");
    expect(check(external(), actor("ADMIN", permissions.update), "SENT").errors).toContain("TRANSITION_NOT_ALLOWED");
    expect(check(external("RESULT_RECEIVED"), actor("ADMIN", permissions.review), "REVIEWED").errors).toContain("ROLE_NOT_ALLOWED");
  });

  it("requires the declared permission even for an allowed role", () => {
    expect(requiredPermissionForTransition("READY", "SENT")).toBe("referrals.updateStatus");
    expect(check(external("READY"), actor("MANAGER", []), "SENT").errors).toContain("PERMISSION_REQUIRED");
  });
});

describe("referral workflow locking, cancellation, and deletion", () => {
  it("locks medical fields after DRAFT", () => {
    const result = validateReferralPatch(external("READY"), { clinicalReason: "سبب جديد", requestedService: "خدمة أخرى" });
    expect(result.errors).toContain("FIELD_LOCKED");
    expect(result.lockedFields).toEqual(expect.arrayContaining(["clinicalReason", "requestedService"]));
  });

  it("always locks patientId and createdById", () => {
    const result = validateReferralPatch(external(), { patientId: "patient-2", createdById: "doctor-2" });
    expect(result.lockedFields).toEqual(["patientId", "createdById"]);
  });

  it("locks assignedReviewerId once the result has arrived", () => {
    expect(validateReferralPatch(external("RESULT_RECEIVED"), { assignedReviewerId: "doctor-2" }).lockedFields)
      .toContain("assignedReviewerId");
  });

  it("allows cancellation before send only to the medical creator or a doctor", () => {
    const byCreator = check(external(), actor("RESIDENT", permissions.cancel, "resident-1"), "CANCELLED", { cancellationReason: "لم يعد مطلوباً" });
    const byDoctor = check(external("READY"), actor("DOCTOR", permissions.cancel), "CANCELLED", { cancellationReason: "تغير القرار الطبي" });
    const byOtherResident = check(external(), actor("RESIDENT", permissions.cancel, "resident-2"), "CANCELLED", { cancellationReason: "سبب" });
    expect(byCreator.effects.cancelledById).toBe("resident-1");
    expect(byCreator.ok).toBe(true);
    expect(byDoctor.ok).toBe(true);
    expect(byOtherResident.errors).toContain("ROLE_NOT_ALLOWED");
  });

  it("allows post-send cancellation only to DOCTOR or ADMIN", () => {
    const doctor = check(external("SENT"), actor("DOCTOR", permissions.cancel, "doctor-1"), "CANCELLED", { cancellationReason: "مانع طبي" });
    const admin = check(external("SENT"), actor("ADMIN", permissions.cancel, "admin-1"), "CANCELLED", { cancellationReason: "إلغاء موثق" });
    const dataEntry = check(external("SENT"), actor("DATA_ENTRY", permissions.cancel), "CANCELLED", { cancellationReason: "سبب" });
    expect(doctor.ok).toBe(true);
    expect(admin.effects.cancelledById).toBe("admin-1");
    expect(dataEntry.errors).toContain("ROLE_NOT_ALLOWED");
  });

  it("requires a cancellation reason and records the cancelledById requirement", () => {
    const result = check(external(), actor("RESIDENT", permissions.cancel, "resident-1"), "CANCELLED", { cancellationReason: " " });
    expect(result.errors).toContain("CANCELLATION_REASON_REQUIRED");
    expect(result.effects.cancelledById).toBe("resident-1");
  });

  it("records reviewedById only for an authorized doctor review", () => {
    const result = check(external("RESULT_RECEIVED"), actor("DOCTOR", permissions.review, "doctor-9"), "REVIEWED");
    expect(result.effects).toMatchObject({ setReviewedAt: true, reviewedById: "doctor-9" });
  });

  it("forbids physical deletion in every status", () => {
    for (const status of ["DRAFT", "PENDING_PRINT", "READY", "SENT", "RESULT_RECEIVED", "REVIEWED", "ACCEPTED", "CANCELLED"] as const) {
      expect(validateReferralDeletion(status)).toEqual({ ok: false, errors: ["DELETE_NOT_ALLOWED"] });
    }
  });
});

describe("internal referral acceptance", () => {
  it("accepts an internal specialist referral only by its assigned reviewer", () => {
    const accepted = check(internal("READY"), actor("DOCTOR", ["referrals.accept"], "doctor-1"), "ACCEPTED", { acceptedById: "doctor-1" });
    const otherDoctor = check(internal("READY"), actor("DOCTOR", ["referrals.accept"], "doctor-2"), "ACCEPTED", { acceptedById: "doctor-2" });
    expect(accepted.ok).toBe(true);
    expect(otherDoctor.errors).toEqual(expect.arrayContaining(["ROLE_NOT_ALLOWED", "ASSIGNED_REVIEWER_MUST_ACCEPT"]));
  });

  it("accepts an internal center referral after service-layer membership verification", () => {
    const accepted = check(internalCenter("READY"), actor("THERAPIST", ["referrals.accept"], "therapist-1"), "ACCEPTED", {
      acceptedById: "therapist-1",
      centerMembershipVerified: true,
    });
    expect(accepted.ok).toBe(true);
  });

  it("requires center membership verification instead of inferring membership from role", () => {
    const result = check(internalCenter("READY"), actor("THERAPIST", ["referrals.accept"], "therapist-1"), "ACCEPTED", {
      acceptedById: "therapist-1",
    });
    expect(result.errors).toContain("CENTER_MEMBERSHIP_VERIFICATION_REQUIRED");
  });

  it("rejects acceptance without acceptedById or with a different actor id", () => {
    const missing = check(internal("READY"), actor("DOCTOR", ["referrals.accept"], "doctor-1"), "ACCEPTED");
    const mismatch = check(internal("READY"), actor("DOCTOR", ["referrals.accept"], "doctor-1"), "ACCEPTED", { acceptedById: "doctor-2" });
    expect(missing.errors).toContain("ACCEPTED_BY_REQUIRED");
    expect(mismatch.errors).toContain("ACCEPTED_BY_MISMATCH");
  });

  it("records acceptance effects and describes one transactional CareStage creation", () => {
    const result = check(internalCenter("READY"), actor("THERAPIST", ["referrals.accept"], "therapist-1"), "ACCEPTED", {
      acceptedById: "therapist-1",
      centerMembershipVerified: true,
    });
    expect(result.effects).toMatchObject({
      setAcceptedAt: true,
      acceptedById: "therapist-1",
      createCareStage: {
        patientId: "patient-1",
        referralRequestId: "request-1",
        destinationScope: "INTERNAL_CENTER",
        destinationCenterId: 7,
      },
    });
  });

  it("never allows ACCEPTED for an external request", () => {
    expect(check(external("READY"), actor("DOCTOR", ["referrals.accept"], "doctor-1"), "ACCEPTED", { acceptedById: "doctor-1" }).errors)
      .toContain("TRANSITION_NOT_ALLOWED");
  });

  it("notifies only the creator identifier and excludes the referral reason", () => {
    const request = { ...internal("READY"), clinicalReason: "سبب إحالة سري" };
    const result = check(request, actor("DOCTOR", ["referrals.accept"], "doctor-1"), "ACCEPTED", { acceptedById: "doctor-1" });
    expect(result.notificationRecipients).toEqual([{ kind: "USER", userId: "resident-1", purpose: "CREATOR" }]);
    expect(JSON.stringify(result.notificationRecipients)).not.toContain(request.clinicalReason);
  });
});

describe("referral workflow notification design", () => {
  it("returns recipient identifiers only and never medical reason or result content", () => {
    const request = { ...external("SENT"), clinicalReason: "بيانات طبية سرية" };
    const result = check(request, actor("DATA_ENTRY", permissions.result), "RESULT_RECEIVED", { resultSummary: "نتيجة طبية سرية" });
    expect(result.notificationRecipients).toEqual([
      { kind: "USER", userId: "doctor-1", purpose: "ASSIGNED_REVIEWER" },
      { kind: "USER", userId: "resident-1", purpose: "CREATOR" },
    ]);
    const serialized = JSON.stringify(result.notificationRecipients);
    expect(serialized).not.toContain(request.clinicalReason);
    expect(serialized).not.toContain("نتيجة طبية سرية");
  });
});
