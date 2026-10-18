import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  centerActor: vi.fn(),
  accountFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  upsert: vi.fn(),
  auditCreate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/center-access", () => ({ centerActor: mocks.centerActor }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findFirst: mocks.accountFindFirst }, $transaction: async (callback: any) => callback({ user: { findFirst: mocks.userFindFirst }, centerMembership: { upsert: mocks.upsert }, auditLog: { create: mocks.auditCreate } }) } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveCenterMembership } from "@/app/(app)/centers/actions";

function form(role: string, userId = "fake-user") {
  const fd = new FormData();
  fd.set("role", role);
  fd.set("userId", userId);
  return fd;
}

describe("saveCenterMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.centerActor.mockResolvedValue({ userId: "fake-actor" });
    mocks.accountFindFirst.mockResolvedValue({ role: "SECRETARY" });
    mocks.userFindFirst.mockResolvedValue({ id: "fake-user" });
    mocks.upsert.mockResolvedValue({ id: "fake-membership", status: "ACTIVE" });
  });

  it.each(["SECRETARY", "RESIDENT", "SPECIALIST"])("persists %s with audited center ownership", async (role) => {
    mocks.accountFindFirst.mockResolvedValue({ role: role === "SPECIALIST" ? "DOCTOR" : role });
    await saveCenterMembership(7, form("ADMIN"));
    expect(mocks.centerActor).toHaveBeenCalledWith(7, "centers.memberships.manage");
    expect(mocks.accountFindFirst).toHaveBeenCalledWith({ where: { id: "fake-user", isActive: true }, select: { role: true } });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { centerId_userId_role: { centerId: 7, userId: "fake-user", role } } }));
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
  });

  it("rejects a role outside the enum before writing", async () => {
    mocks.accountFindFirst.mockResolvedValue({ role: "ADMIN" });
    await expect(saveCenterMembership(7, form("ADMIN"))).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects access to another center before reading or writing", async () => {
    mocks.centerActor.mockRejectedValue(new Error("لا تملك عضوية فعالة في هذا المركز"));
    await expect(saveCenterMembership(99, form("SECRETARY"))).rejects.toThrow();
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects a missing session before reading or writing", async () => {
    mocks.centerActor.mockRejectedValue(new Error("يجب تسجيل الدخول"));
    await expect(saveCenterMembership(7, form("SECRETARY"))).rejects.toThrow();
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects an inactive or nonexistent target user", async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    await expect(saveCenterMembership(7, form("SPECIALIST", "other-user"))).rejects.toThrow("المستخدم غير متاح");
    expect(mocks.userFindFirst).toHaveBeenCalledWith({ where: { id: "other-user", isActive: true }, select: { id: true } });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
