import { beforeEach, describe, expect, it, vi } from "vitest";
import { referralAccessScope } from "@/lib/referral-access";
import { createReferralRequest, transitionReferralRequest } from "@/lib/referral-service";

const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { $transaction: transaction } }));

function db(role: string, centerIds: number[] = [], branchId: number | null = 4, active = true) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ id: "actor-1", role, isActive: active, branchId, branch: branchId ? { isActive: true } : null }) },
    centerMembership: { findMany: vi.fn().mockResolvedValue(centerIds.map((centerId) => ({ centerId }))) },
  };
}

const actor = (role: string, permissions = ["referrals.view", "referrals.accept", "centers.central.view"]) => ({
  userId: "actor-1", role: role as any, permissions: new Set(permissions),
});

describe("referral record scope", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies inactive accounts before any referral query", async () => {
    const repo = db("HEAD_THERAPIST", [53], 4, false);
    await expect(referralAccessScope(repo as any, actor("HEAD_THERAPIST"))).rejects.toThrow("غير مصرح");
    expect(repo.centerMembership.findMany).not.toHaveBeenCalled();
  });

  it("uses active, time-bounded destination membership and ignores the wrong center", async () => {
    const repo = db("HEAD_THERAPIST", [53]);
    const scope = await referralAccessScope(repo as any, actor("HEAD_THERAPIST"));
    expect(scope.centerIds).toEqual([53]);
    expect(scope.where).toEqual({ OR: [
      { createdById: "actor-1" }, { assignedReviewerId: "actor-1" },
      { destinationScope: "INTERNAL_CENTER", destinationCenterId: { in: [53] } },
    ] });
    expect(repo.centerMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "actor-1", status: "ACTIVE", role: "HEAD_THERAPIST", startDate: { lte: expect.any(Date) }, center: { active: true } }),
    }));
  });

  it("preserves assigned cross-center doctor access without global doctor visibility", async () => {
    const scope = await referralAccessScope(db("DOCTOR", [], 4) as any, actor("DOCTOR"));
    expect(scope.where).toEqual({ OR: [
      { createdById: "actor-1" }, { assignedReviewerId: "actor-1" }, { patient: { branchId: 4 } },
    ] });
  });

  it("retains central administrator access", async () => {
    expect((await referralAccessScope(db("ADMIN") as any, actor("ADMIN"))).where).toEqual({});
  });

  it("checks detail scope within the transaction and performs no write for an unrelated referral", async () => {
    const repo = db("HEAD_THERAPIST", [53]);
    const tx = {
      ...repo,
      rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
      userPermission: { findMany: vi.fn().mockResolvedValue([]) },
      referralRequest: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
      careStage: { create: vi.fn() },
    };
    transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(tx));
    await expect(transitionReferralRequest("referral-38", "ACCEPTED", { acceptedById: "actor-1" }, actor("HEAD_THERAPIST"))).rejects.toThrow("غير مصرح");
    expect(tx.referralRequest.findFirst).toHaveBeenCalledWith({ where: {
      id: "referral-38", AND: [{ OR: [
        { createdById: "actor-1" }, { assignedReviewerId: "actor-1" },
        { destinationScope: "INTERNAL_CENTER", destinationCenterId: { in: [53] } },
      ] }],
    }, include: expect.any(Object) });
    expect(tx.referralRequest.update).not.toHaveBeenCalled();
    expect(tx.careStage.create).not.toHaveBeenCalled();
  });

  it("does not treat a creator's unrelated center membership as acceptance authority", async () => {
    const repo = db("HEAD_THERAPIST", [53]);
    const tx = {
      ...repo,
      rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
      userPermission: { findMany: vi.fn().mockResolvedValue([]) },
      referralRequest: { findFirst: vi.fn().mockResolvedValue({ id: "referral-38", destinationScope: "INTERNAL_CENTER", destinationCenterId: 38 }), update: vi.fn() },
      careStage: { create: vi.fn() },
    };
    transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(tx));
    await expect(transitionReferralRequest("referral-38", "ACCEPTED", { acceptedById: "actor-1" }, actor("HEAD_THERAPIST"))).rejects.toThrow("غير مصرح");
    expect(tx.referralRequest.update).not.toHaveBeenCalled();
    expect(tx.careStage.create).not.toHaveBeenCalled();
  });

  it("rejects referral creation for a patient in another branch before a database write", async () => {
    const repo = db("DOCTOR", [], 4);
    const tx = {
      ...repo,
      rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
      userPermission: { findMany: vi.fn().mockResolvedValue([]) },
      patient: { findUnique: vi.fn().mockResolvedValue({ id: "patient-1", branchId: 9, archivedAt: null }) },
      referralRequest: { create: vi.fn() },
    };
    transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(tx));
    await expect(createReferralRequest({ patientId: "patient-1", type: "TREATMENT_CENTER", destinationScope: "INTERNAL_CENTER", destinationCenterId: 38, requestedService: "service", clinicalReason: "reason" }, actor("DOCTOR"))).rejects.toThrow("غير مصرح");
    expect(tx.referralRequest.create).not.toHaveBeenCalled();
  });

  it("rechecks effective permission overrides within the mutation transaction", async () => {
    const repo = db("HEAD_THERAPIST", [38]);
    const tx = {
      ...repo,
      rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
      userPermission: { findMany: vi.fn().mockResolvedValue([{ permKey: "referrals.view", allowed: false }]) },
      referralRequest: { findFirst: vi.fn(), update: vi.fn() },
      careStage: { create: vi.fn() },
    };
    transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(tx));
    await expect(transitionReferralRequest("referral-38", "ACCEPTED", { acceptedById: "actor-1" }, actor("HEAD_THERAPIST"))).rejects.toThrow("غير مصرح");
    expect(tx.referralRequest.findFirst).not.toHaveBeenCalled();
    expect(tx.referralRequest.update).not.toHaveBeenCalled();
  });
});
