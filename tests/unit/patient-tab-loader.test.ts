import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPatientTabData,
  type PatientTabRepository,
  type TabDeps,
} from "@/lib/patient-tab-loader";

const findMany = () => vi.fn().mockResolvedValue([]);
const prisma = {
  attachment: { findMany: findMany() },
  progressMetric: { findMany: findMany() },
  vitalSign: { findMany: findMany() },
  residentReview: { findMany: findMany() },
  referralRequest: { findMany: findMany() },
  treatmentPlan: { findMany: findMany() },
  relative: { findMany: findMany() },
  auditLog: { findMany: findMany() },
  dressingRecord: { findMany: findMany() },
} satisfies PatientTabRepository;

const deps = (overrides: Partial<TabDeps> = {}): TabDeps => ({
  session: vi.fn().mockResolvedValue({ user: { id: "user-12345" } }),
  patientsView: vi.fn().mockResolvedValue(undefined),
  perms: vi.fn().mockResolvedValue(new Set(["patients.view", "referrals.view"])),
  memberships: vi.fn().mockResolvedValue([1]),
  prisma,
  ...overrides,
});

const expectNoRepositoryCalls = () => {
  for (const model of Object.values(prisma)) expect(model.findMany).not.toHaveBeenCalled();
};

describe("patient tab loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid patient IDs before any repository call", async () => {
    const d = deps();
    await expect(loadPatientTabData("invalid", "referrals", d)).rejects.toThrow("غير مصرح");
    expect(d.session).not.toHaveBeenCalled();
    expectNoRepositoryCalls();
  });

  it("rejects unknown tabs before any repository call", async () => {
    const d = deps();
    await expect(loadPatientTabData("patient-12345", "__unknown__", d)).rejects.toThrow("غير مصرح");
    expect(d.session).not.toHaveBeenCalled();
    expectNoRepositoryCalls();
  });

  it("rejects a missing session before any repository call", async () => {
    const d = deps({ session: vi.fn().mockResolvedValue(null) });
    await expect(loadPatientTabData("patient-12345", "referrals", d)).rejects.toThrow("غير مصرح");
    expect(d.patientsView).not.toHaveBeenCalled();
    expectNoRepositoryCalls();
  });

  it("rejects missing patients.view before any repository call", async () => {
    const d = deps({ patientsView: vi.fn().mockRejectedValue(new Error("غير مصرح")) });
    await expect(loadPatientTabData("patient-12345", "referrals", d)).rejects.toThrow("غير مصرح");
    expect(d.perms).not.toHaveBeenCalled();
    expectNoRepositoryCalls();
  });

  it("rejects a tab-specific authorization failure before any repository call", async () => {
    const d = deps({ perms: vi.fn().mockResolvedValue(new Set(["patients.view"])) });
    await expect(loadPatientTabData("patient-12345", "referrals", d)).rejects.toThrow("غير مصرح");
    expect(d.memberships).not.toHaveBeenCalled();
    expectNoRepositoryCalls();
  });

  it("preserves referral scope, relations, and ordering", async () => {
    const d = deps();
    await loadPatientTabData("patient-12345", "referrals", d);
    expect(prisma.referralRequest.findMany).toHaveBeenCalledWith({
      where: {
        patientId: "patient-12345",
        status: "ACCEPTED",
        destinationScope: "INTERNAL_CENTER",
        OR: [{ destinationCenterId: null }, { destinationCenterId: { in: [1] } }],
      },
      include: {
        destinationCenter: { select: { name: true } },
        assignedReviewer: { select: { fullName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("loads vitals through the resident authorization alias", async () => {
    const d = deps({ perms: vi.fn().mockResolvedValue(new Set(["patients.view", "clinical.view"])) });
    await loadPatientTabData("patient-12345", "vitals", d);
    expect(prisma.vitalSign.findMany).toHaveBeenCalledWith({
      where: { patientId: "patient-12345" },
      orderBy: { date: "asc" },
    });
  });

  it("applies the non-central treatment-plan predicate", async () => {
    const d = deps({ perms: vi.fn().mockResolvedValue(new Set(["patients.view", "therapy.view"])) });
    await loadPatientTabData("patient-12345", "plan", d);
    expect(prisma.treatmentPlan.findMany).toHaveBeenCalledWith({
      where: {
        patientId: "patient-12345",
        OR: [{ centerId: null }, { centerId: { in: [1] } }],
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("omits the centre predicate for central treatment-plan access", async () => {
    const d = deps({
      perms: vi.fn().mockResolvedValue(new Set(["patients.view", "therapy.view", "centers.central.view"])),
    });
    await loadPatientTabData("patient-12345", "plan", d);
    expect(d.memberships).not.toHaveBeenCalled();
    expect(prisma.treatmentPlan.findMany).toHaveBeenCalledWith({
      where: { patientId: "patient-12345" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("uses the exact minimal activity projection", async () => {
    const d = deps({ perms: vi.fn().mockResolvedValue(new Set(["patients.view", "audit.view"])) });
    await loadPatientTabData("patient-12345", "activity", d);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { tableName: "patients", recordId: "patient-12345" },
      select: { id: true, action: true, createdAt: true, user: { select: { fullName: true } } },
      take: 80,
      orderBy: { createdAt: "desc" },
    });
  });
});
