import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  updateMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), logAudit: vi.fn(), assertPerm: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { appointment: { updateMany: m.updateMany, count: m.count, findUnique: m.findUnique } } }));
vi.mock("@/lib/audit", () => ({ logAudit: m.logAudit }));
vi.mock("@/lib/access", () => ({ assertPerm: m.assertPerm, assertAdminDelete: vi.fn() }));
vi.mock("@/lib/patient-guard", () => ({ assertPatientActionScope: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/admin-config", () => ({ getAdminConfig: vi.fn() }));

import { setAppointmentStatus } from "@/app/(app)/appointments/actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.findUnique.mockResolvedValue({ session: null });
  m.assertPerm.mockResolvedValue(undefined);
});

describe("setAppointmentStatus idempotency", () => {
  it("records one audit entry for a real completion", async () => {
    m.updateMany.mockResolvedValue({ count: 1 });
    await setAppointmentStatus("a1", "COMPLETED");
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: "a1", status: { not: "COMPLETED" } }, data: { status: "COMPLETED" } });
    expect(m.logAudit).toHaveBeenCalledTimes(1);
  });

  it("repeating the same status is a no-op with no audit", async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    m.count.mockResolvedValue(1);
    await setAppointmentStatus("a1", "COMPLETED");
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it("still rejects an unknown appointment and an invalid status", async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    m.count.mockResolvedValue(0);
    await expect(setAppointmentStatus("missing", "NOSHOW")).rejects.toThrow();
    await expect(setAppointmentStatus("a1", "BOGUS")).rejects.toThrow();
    expect(m.logAudit).not.toHaveBeenCalled();
  });
});
