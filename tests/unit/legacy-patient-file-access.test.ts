import { beforeEach, describe, expect, it, vi } from "vitest";
import { canReadLegacyPatientFile } from "@/lib/legacy-patient-file-access";

const actor = (role: any = "DOCTOR", permissions = new Set(["patients.view"])) => ({ userId: "viewer", role, permissions });
const db = {
  user: { findUnique: vi.fn() },
  patient: { findUnique: vi.fn() },
  centerMembership: { findMany: vi.fn() },
  appointment: { findFirst: vi.fn() },
  referralRequest: { findFirst: vi.fn() },
  treatmentPlan: { findFirst: vi.fn() },
  patientHandoff: { findFirst: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ role: "DOCTOR", isActive: true, branchId: 1, branch: { isActive: true } });
  db.patient.findUnique.mockResolvedValue({ branchId: 1, branch: { isActive: true } });
  db.centerMembership.findMany.mockResolvedValue([]);
  for (const model of [db.appointment, db.referralRequest, db.treatmentPlan, db.patientHandoff]) model.findFirst.mockResolvedValue(null);
});

describe("legacy patient file scope", () => {
  it("allows an active clinician in the patient's active branch", async () => {
    expect(await canReadLegacyPatientFile(db as any, actor(), "patient")).toBe(true);
  });

  it("denies another branch even when the doctor has central center permission", async () => {
    db.patient.findUnique.mockResolvedValue({ branchId: 2, branch: { isActive: true } });
    expect(await canReadLegacyPatientFile(db as any, actor("DOCTOR", new Set(["patients.view", "centers.central.view"])), "patient")).toBe(false);
  });

  it("denies inactive accounts, inactive branches and missing effective permission", async () => {
    db.user.findUnique.mockResolvedValue({ role: "DOCTOR", isActive: false, branchId: 1, branch: { isActive: true } });
    expect(await canReadLegacyPatientFile(db as any, actor(), "patient")).toBe(false);
    db.user.findUnique.mockResolvedValue({ role: "DOCTOR", isActive: true, branchId: 1, branch: { isActive: false } });
    expect(await canReadLegacyPatientFile(db as any, actor(), "patient")).toBe(false);
    expect(await canReadLegacyPatientFile(db as any, actor("DOCTOR", new Set()), "patient")).toBe(false);
  });

  it("requires active, role-matched center membership and a patient care link for branchless staff", async () => {
    db.user.findUnique.mockResolvedValue({ role: "THERAPIST", isActive: true, branchId: null, branch: null });
    const therapist = actor("THERAPIST");
    expect(await canReadLegacyPatientFile(db as any, therapist, "patient")).toBe(false);
    db.centerMembership.findMany.mockResolvedValue([{ centerId: 7 }]);
    expect(await canReadLegacyPatientFile(db as any, therapist, "patient")).toBe(false);
    db.appointment.findFirst.mockResolvedValue({ id: "appointment" });
    expect(await canReadLegacyPatientFile(db as any, therapist, "patient")).toBe(true);
    expect(db.centerMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: "THERAPIST", status: "ACTIVE", center: { active: true } }) }));
  });

  it("does not allow an inactive center membership even with a patient care link", async () => {
    db.user.findUnique.mockResolvedValue({ role: "THERAPIST", isActive: true, branchId: null, branch: null });
    db.centerMembership.findMany.mockResolvedValue([]);
    db.appointment.findFirst.mockResolvedValue({ id: "appointment" });
    expect(await canReadLegacyPatientFile(db as any, actor("THERAPIST"), "patient")).toBe(false);
    expect(db.appointment.findFirst).not.toHaveBeenCalled();
  });
});
