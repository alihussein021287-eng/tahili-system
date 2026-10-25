import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: vi.fn(), account: vi.fn(), raw: vi.fn(), membership: vi.fn(),
  update: vi.fn(), upsert: vi.fn(), audit: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/access", () => ({ requireSession: h.session }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: h.raw, centerMembership: { findFirst: h.membership, update: h.update, upsert: h.upsert }, auditLog: { create: h.audit } };
  return { prisma: { user: { findFirst: h.account }, $transaction: async (work: (db: typeof tx) => Promise<unknown>) => work(tx) } };
});
import { updateUserCenterMembership } from "@/app/(app)/users/actions";

const adminId = "synthetic-authenticated-admin";
const operatorId = "synthetic-affected-operator";
function transfer() {
  const fd = new FormData();
  fd.set("centerId", "2"); fd.set("role", "DEVICE_OPERATOR");
  fd.set("actorId", operatorId); // Untrusted metadata must never become the audit actor.
  return updateUserCenterMembership(operatorId, "synthetic-membership-a", fd);
}
beforeEach(() => {
  vi.clearAllMocks();
  h.session.mockResolvedValue({ user: { id: adminId, role: "ADMIN", authVersion: 0 } });
  h.account.mockResolvedValue({ role: "PROSTHETICS" });
  h.raw.mockResolvedValue([]);
  h.membership.mockResolvedValue({ id: "synthetic-membership-a", userId: operatorId, centerId: 1, role: "DEVICE_OPERATOR" });
  h.update.mockResolvedValue({}); h.upsert.mockResolvedValue({ id: "synthetic-membership-b" });
  h.audit.mockResolvedValue({ id: "synthetic-audit" });
});
describe("membership transfer audit actor", () => {
  it("attributes the transactional event to the trusted ADMIN, separately from its target and client actorId", async () => {
    await transfer();
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit).toHaveBeenCalledWith({ data: {
      userId: adminId, action: "UPDATE", tableName: "center_memberships", recordId: "synthetic-membership-b",
      newValue: { userId: operatorId, centerId: 2, role: "DEVICE_OPERATOR", placement: "updated" },
    } });
  });
  it("rejects a non-ADMIN before any mutation or success audit", async () => {
    h.session.mockResolvedValue({ user: { id: operatorId, role: "PROSTHETICS", authVersion: 0 } });
    await expect(transfer()).rejects.toThrow("غير مصرّح");
    expect(h.raw).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled();
  });
  it("fails closed when the trusted session has no actor ID", async () => {
    h.session.mockResolvedValue({ user: { role: "ADMIN", authVersion: 0 } });
    await expect(transfer()).rejects.toThrow("غير مصرّح");
    expect(h.raw).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled();
  });
  it("propagates a required transactional audit failure without a success refresh", async () => {
    const failure = new Error("synthetic required audit failure"); h.audit.mockRejectedValueOnce(failure);
    await expect(transfer()).rejects.toBe(failure);
    expect(h.update).toHaveBeenCalledTimes(1); expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("does not create a success event for a rejected missing membership", async () => {
    h.membership.mockResolvedValue(null);
    await expect(transfer()).rejects.toThrow("عضوية المركز غير موجودة");
    expect(h.update).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled();
  });
});
