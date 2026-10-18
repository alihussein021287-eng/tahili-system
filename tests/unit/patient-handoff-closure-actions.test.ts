import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(), assertPerm: vi.fn(), close: vi.fn(), revalidate: vi.fn(), redirect: vi.fn(),
  transaction: vi.fn(), patientUpdate: vi.fn(), admissionRead: vi.fn(), admissionUpdate: vi.fn(),
  bedUpdate: vi.fn(), auditCreate: vi.fn(),
}));

vi.mock("@/lib/access", () => ({ requireSession: mocks.requireSession, assertPerm: mocks.assertPerm, currentPerms: vi.fn() }));
vi.mock("@/lib/patient-guard", () => ({ assertPatientActionScope: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/handoff-service", () => ({ closeOpenHandoffsForPatient: mocks.close }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { archivePatient, dischargeAdmission } from "@/app/(app)/patients/actions";

const tx = {
  patient: { update: mocks.patientUpdate },
  admission: { findUniqueOrThrow: mocks.admissionRead, updateMany: mocks.admissionUpdate },
  bed: { update: mocks.bedUpdate },
  auditLog: { create: mocks.auditCreate },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ user: { id: "staff-1", role: "MANAGER" } });
  mocks.admissionRead.mockResolvedValue({ id: "admission-1", patientId: "patient-1", status: "ADMITTED", bedId: 7 });
  mocks.transaction.mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
});

describe("closing handoffs with patient transitions", () => {
  it("archives and closes handoffs within one transaction, then writes the patient audit", async () => {
    const order: string[] = [];
    mocks.patientUpdate.mockImplementation(async () => { order.push("archive"); });
    mocks.close.mockImplementation(async () => { order.push("close"); });
    mocks.auditCreate.mockImplementation(async () => { order.push("audit"); });

    await archivePatient("patient-1");

    expect(mocks.assertPerm).toHaveBeenCalledWith("patients.archive");
    expect(mocks.patientUpdate).toHaveBeenCalledWith({ where: { id: "patient-1" }, data: { archivedAt: expect.any(Date) } });
    expect(mocks.close).toHaveBeenCalledWith(tx, "patient-1", "staff-1", "ARCHIVED");
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "staff-1", action: "UPDATE", tableName: "patients", recordId: "patient-1",
    }) });
    expect(order).toEqual(["archive", "close", "audit"]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledWith("/my-work");
  });

  it("discharges, frees the bed and closes handoffs within one transaction with an audit", async () => {
    const order: string[] = [];
    mocks.admissionUpdate.mockImplementation(async () => { order.push("discharge"); return { count: 1 }; });
    mocks.bedUpdate.mockImplementation(async () => { order.push("free-bed"); });
    mocks.close.mockImplementation(async () => { order.push("close"); });
    mocks.auditCreate.mockImplementation(async () => { order.push("audit"); });

    await dischargeAdmission("patient-1", "admission-1");

    expect(mocks.assertPerm).toHaveBeenCalledWith("clinical.admission");
    expect(mocks.admissionUpdate).toHaveBeenCalledWith({ where: { id: "admission-1", patientId: "patient-1", status: "ADMITTED" }, data: { status: "DISCHARGED", dischargeDate: expect.any(Date) } });
    expect(mocks.bedUpdate).toHaveBeenCalledWith({ where: { id: 7 }, data: { occupied: false } });
    expect(mocks.close).toHaveBeenCalledWith(tx, "patient-1", "staff-1", "DISCHARGED");
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "staff-1", tableName: "admissions", recordId: "admission-1",
      oldValue: { status: "ADMITTED" }, newValue: { status: "DISCHARGED" },
    }) });
    expect(order).toEqual(["discharge", "free-bed", "close", "audit"]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledWith("/my-work");
    expect(mocks.revalidate).toHaveBeenCalledWith("/patients/patient-1");
  });

  it("does nothing on an admission that was already discharged: no bed, no handoffs, no audit", async () => {
    mocks.admissionUpdate.mockResolvedValueOnce({ count: 0 });
    await expect(dischargeAdmission("patient-1", "admission-1")).rejects.toThrow("هذا الرقود مُخرَّج مسبقاً");
    expect(mocks.admissionUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "admission-1", patientId: "patient-1", status: "ADMITTED" } }));
    expect(mocks.bedUpdate).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("rejects discharge of an admission belonging to another patient before any write", async () => {
    mocks.admissionRead.mockResolvedValueOnce({ id: "admission-1", patientId: "patient-2", status: "ACTIVE", bedId: 7 });
    await expect(dischargeAdmission("patient-1", "admission-1")).rejects.toThrow("ملف المراجع غير متاح");
    expect(mocks.admissionUpdate).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("does not report success or write an audit when closure fails", async () => {
    mocks.close.mockRejectedValueOnce(new Error("closure conflict"));
    await expect(archivePatient("patient-1")).rejects.toThrow("closure conflict");
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
