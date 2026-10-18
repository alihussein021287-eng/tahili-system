import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertPerm: vi.fn(), currentPerms: vi.fn(), getSession: vi.fn(),
  send: vi.fn(), accept: vi.fn(), returned: vi.fn(), finish: vi.fn(), cancel: vi.fn(), redirect: vi.fn(), targets: vi.fn(),
  patient: vi.fn(), center: vi.fn(), centers: vi.fn(), membership: vi.fn(), user: vi.fn(), actorUser: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/access", () => ({ assertPerm: mocks.assertPerm, currentPerms: mocks.currentPerms, getSession: mocks.getSession }));
vi.mock("@/lib/db", () => ({ prisma: {
  patient: { findUnique: mocks.patient }, center: { findFirst: mocks.center, findMany: mocks.centers },
  centerMembership: { findFirst: mocks.membership }, user: { findFirst: mocks.user, findUnique: mocks.actorUser },
  patientHandoff: { findFirst: vi.fn().mockResolvedValue({ id: "handoff-1", patientId: "patient-1", toCenterId: 2, status: "SENT" }) },
  visit: { findFirst: vi.fn().mockResolvedValue(null) },
} }));
vi.mock("@/lib/handoff-service", () => ({
  sendHandoff: mocks.send, acceptHandoff: mocks.accept, returnHandoff: mocks.returned, listTargets: mocks.targets,
  finishHandoff: mocks.finish, cancelHandoff: mocks.cancel, redirectHandoff: mocks.redirect,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { acceptHandoffAction, cancelHandoffAction, finishHandoffAction, listActiveCentersAction, listHandoffTargetsAction, redirectHandoffAction, returnHandoffAction, sendHandoffAction } from "@/app/(app)/handoffs/actions";

const input = { patientId: "patient-1", toCenterId: 2, toRole: "DOCTOR" as const, toUserId: "doctor-1" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentPerms.mockResolvedValue(new Set(["handoff.send", "handoff.receive", "patients.view"]));
  mocks.getSession.mockResolvedValue({ user: { id: "sender-1", role: "RESIDENT" } });
  mocks.patient.mockResolvedValue({ id: "patient-1", branchId: 1 });
  mocks.actorUser.mockResolvedValue({ branchId: 1 });
  mocks.center.mockResolvedValue({ id: 2 });
  mocks.membership.mockResolvedValue({ userId: "doctor-1" });
  mocks.send.mockResolvedValue({ id: "handoff-1", patientId: "patient-1" });
  mocks.accept.mockResolvedValue({ id: "handoff-1", patientId: "patient-1" });
  mocks.returned.mockResolvedValue({ id: "handoff-2", patientId: "patient-1" });
  mocks.finish.mockResolvedValue({ id: "handoff-1", patientId: "patient-1" });
  mocks.cancel.mockResolvedValue({ id: "handoff-1", patientId: "patient-1" });
  mocks.redirect.mockResolvedValue({ id: "handoff-2", patientId: "patient-1" });
});

describe("finish, cancel and redirect actions", () => {
  it("rejects a missing session token for every transition", async () => {
    for (const invoke of [
      () => finishHandoffAction("handoff-1"),
      () => cancelHandoffAction("handoff-1"),
      () => redirectHandoffAction("handoff-1", { toRole: "DOCTOR", toUserId: "doctor-1" }),
    ]) {
      mocks.getSession.mockResolvedValueOnce(null);
      expect((await invoke()).ok).toBe(false);
    }
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("rejects invalid ids and redirect fields before invoking the service", async () => {
    expect((await finishHandoffAction("../other")).ok).toBe(false);
    expect((await cancelHandoffAction("../other")).ok).toBe(false);
    expect((await redirectHandoffAction("handoff-1", { toRole: "DOCTOR", toCenterId: 999 } as never)).ok).toBe(false);
    expect((await redirectHandoffAction("handoff-1", { toRole: "DOCTOR", toUserId: "../other" })).ok).toBe(false);
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("finishes and cancels with trusted actor context and refreshes both views", async () => {
    expect(await finishHandoffAction("handoff-1")).toEqual({ ok: true });
    expect(await cancelHandoffAction("handoff-1")).toEqual({ ok: true });
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ userId: "sender-1" }), "handoff-1");
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ userId: "sender-1" }), "handoff-1");
    expect(mocks.revalidate).toHaveBeenCalledWith("/my-work");
    expect(mocks.revalidate).toHaveBeenCalledWith("/patients/patient-1");
  });

  it("redirects only a validated target and refreshes both views", async () => {
    const target = { toRole: "DOCTOR" as const, toUserId: "doctor-1" };
    expect(await redirectHandoffAction("handoff-1", target)).toEqual({ ok: true });
    expect(mocks.redirect).toHaveBeenCalledWith(expect.objectContaining({ userId: "sender-1" }), "handoff-1", target);
    expect(mocks.revalidate).toHaveBeenCalledWith("/my-work");
    expect(mocks.revalidate).toHaveBeenCalledWith("/patients/patient-1");
  });
});

describe("handoff action authorization", () => {
  it("rejects send without handoff.send before reading or creating a record", async () => {
    mocks.assertPerm.mockRejectedValueOnce(new Error("غير مصرّح بهذا الإجراء"));
    expect(await sendHandoffAction(input)).toEqual({ ok: false, error: "غير مصرّح بهذا الإجراء" });
    expect(mocks.patient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects a missing session token before checking permissions or reading records", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect(await sendHandoffAction(input)).toEqual({ ok: false, error: "غير مصرح" });
    expect(mocks.assertPerm).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("requires handoff.receive to accept, before touching a handoff", async () => {
    mocks.assertPerm.mockRejectedValueOnce(new Error("غير مصرّح بهذا الإجراء"));
    expect(await acceptHandoffAction("handoff-1")).toEqual({ ok: false, error: "غير مصرّح بهذا الإجراء" });
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("validates input and named recipients within the selected center", async () => {
    expect((await sendHandoffAction({ ...input, untrusted: true } as never)).ok).toBe(false);
    expect((await sendHandoffAction({ ...input, patientId: "../other" })).ok).toBe(false);
    mocks.membership.mockResolvedValueOnce(null);
    expect((await sendHandoffAction(input)).ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects a forged source center before reading or creating records", async () => {
    expect(await sendHandoffAction({ ...input, fromCenterId: 999 } as never)).toEqual({ ok: false, error: "البيانات المدخلة غير صالحة" });
    expect(mocks.patient).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("checks the named recipient's membership dates and active account", async () => {
    const before = new Date();
    expect(await sendHandoffAction(input)).toEqual({ ok: true });
    const { where } = mocks.membership.mock.calls[0][0];
    expect(where).toEqual({
      centerId: 2, userId: "doctor-1", role: "SPECIALIST", status: "ACTIVE",
      startDate: { lte: expect.any(Date) },
      OR: [{ endDate: null }, { endDate: { gte: expect.any(Date) } }],
      user: { is: { isActive: true } },
    });
    expect(where.startDate.lte.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(where.startDate.lte.getTime()).toBeLessThanOrEqual(Date.now());
    expect(where.OR[1].endDate.gte).toEqual(where.startDate.lte);
  });

  it.each(["RECEPTION", "DATA_ENTRY"] as const)("explains a missing branch for %s with or without a named target", async (toRole) => {
    mocks.patient.mockResolvedValue({ id: "patient-1", branchId: null });
    mocks.actorUser.mockResolvedValue({ branchId: null });
    for (const toUserId of [undefined, "recipient-1"]) {
      expect(await sendHandoffAction({ patientId: "patient-1", toRole, toUserId })).toEqual({
        ok: false, error: "المراجع بلا فرع؛ حدّد فرعه أولاً قبل التحويل للاستقبال أو إدخال البيانات",
      });
    }
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("checks patient access before disclosing a missing branch", async () => {
    mocks.patient.mockResolvedValue({ id: "patient-1", branchId: null });
    expect(await sendHandoffAction({ patientId: "patient-1", toRole: "RECEPTION" })).toEqual({ ok: false, error: "ملف المراجع غير متاح" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    "المريض حالياً عند علي حسين – مركز اختباري",
    "المراجع بلا فرع؛ حدّد فرعه أولاً قبل التحويل للاستقبال أو إدخال البيانات",
  ])("passes the operational error to the caller: %s", async (error) => {
    mocks.send.mockRejectedValueOnce(new Error(error));
    expect(await sendHandoffAction(input)).toEqual({ ok: false, error });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("keeps unexpected service errors private", async () => {
    mocks.send.mockRejectedValueOnce(new Error("database connection failure"));
    expect(await sendHandoffAction(input)).toEqual({ ok: false, error: "تعذر إكمال الإجراء، حاول مرة أخرى" });
  });

  it("does not send another branch's patient without central access", async () => {
    mocks.patient.mockResolvedValueOnce({ id: "patient-2", branchId: 2 });
    expect(await sendHandoffAction({ ...input, patientId: "patient-2" })).toEqual({ ok: false, error: "ملف المراجع غير متاح" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends an eligible handoff and refreshes work and patient views", async () => {
    expect(await sendHandoffAction(input)).toEqual({ ok: true });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ userId: "sender-1" }), input);
    expect(mocks.revalidate).toHaveBeenCalledWith("/my-work");
    expect(mocks.revalidate).toHaveBeenCalledWith("/patients/patient-1");
  });

  it("requires handoff.send to return and passes a validated reason", async () => {
    mocks.assertPerm.mockRejectedValueOnce(new Error("غير مصرّح بهذا الإجراء"));
    expect((await returnHandoffAction("handoff-1", "سبب")).ok).toBe(false);
    expect(mocks.returned).not.toHaveBeenCalled();
    expect((await returnHandoffAction("handoff-1", "  سبب  ")).ok).toBe(true);
    expect(mocks.returned).toHaveBeenCalledWith(expect.anything(), "handoff-1", "سبب");
  });

  it("rejects an empty return reason on the server before changing the handoff", async () => {
    expect(await returnHandoffAction("handoff-1", "  ")).toEqual({ ok: false, error: "سبب الإرجاع مطلوب" });
    expect(mocks.returned).not.toHaveBeenCalled();
  });
});

describe("handoff target lists", () => {
  it("reads active centers from the database", async () => {
    mocks.centers.mockResolvedValueOnce([{ id: 2, name: "مركز اختباري" }]);
    expect(await listActiveCentersAction()).toEqual({ ok: true, data: [{ id: 2, name: "مركز اختباري" }] });
    expect(mocks.centers).toHaveBeenCalledWith({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  });

  it("rejects unauthorized and invalid target queries", async () => {
    mocks.assertPerm.mockRejectedValueOnce(new Error("غير مصرّح بهذا الإجراء"));
    expect((await listActiveCentersAction()).ok).toBe(false);
    expect(mocks.centers).not.toHaveBeenCalled();
    expect((await listHandoffTargetsAction(-1, "DOCTOR")).ok).toBe(false);
    expect(mocks.targets).not.toHaveBeenCalled();
  });
});
