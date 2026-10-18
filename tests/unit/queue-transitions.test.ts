import { describe, expect, it, vi } from "vitest";
import { QUEUE_TRANSITIONS, transitionQueueEntry } from "@/lib/queue-transitions";

const perms = new Set(["queue.manage"]);
const actor = (role: any = "RECEPTION", permissions: Set<string> = perms) => ({ userId: "u1", role, permissions });

function fakeDb(opts: { status?: string; centerId?: number | null; patientBranch?: number | null; user?: any; membership?: boolean; updateCount?: number } = {}) {
  const db: any = {
    user: { findUnique: vi.fn(async () => opts.user ?? { role: "RECEPTION", isActive: true, branchId: 1, branch: { isActive: true } }) },
    queueEntry: {
      findUnique: vi.fn(async () => ({ id: "q1", status: opts.status ?? "WAITING", centerId: opts.centerId ?? 5, branchId: null, patient: { branchId: opts.patientBranch === undefined ? 1 : opts.patientBranch } })),
      updateMany: vi.fn(async () => ({ count: opts.updateCount ?? 1 })),
    },
    centerMembership: { findFirst: vi.fn(async () => (opts.membership ? { id: "m1" } : null)) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return db;
}

describe("queue transition matrix", () => {
  it("walks WAITING -> CALLED -> IN_SESSION -> DONE with one audit entry per step", async () => {
    for (const [from, to] of [["WAITING", "CALLED"], ["CALLED", "IN_SESSION"], ["IN_SESSION", "DONE"]] as const) {
      const db = fakeDb({ status: from });
      await expect(transitionQueueEntry(db, actor(), "q1", to)).resolves.toEqual({ changed: true, status: to });
      expect(db.queueEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "q1", status: from } }));
      expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects DONE -> CALLED and DONE -> WAITING without writes or audit", async () => {
    for (const to of ["CALLED", "WAITING"] as const) {
      const db = fakeDb({ status: "DONE" });
      await expect(transitionQueueEntry(db, actor(), "q1", to)).rejects.toThrow();
      expect(db.queueEntry.updateMany).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    }
    expect(QUEUE_TRANSITIONS.DONE).toEqual([]);
  });

  it("allows an authorized return to WAITING from CALLED and IN_SESSION only", async () => {
    for (const from of ["CALLED", "IN_SESSION"]) {
      const db = fakeDb({ status: from });
      await expect(transitionQueueEntry(db, actor(), "q1", "WAITING")).resolves.toMatchObject({ changed: true });
    }
    const db = fakeDb({ status: "WAITING" });
    await expect(transitionQueueEntry(db, actor(), "q1", "IN_SESSION")).rejects.toThrow();
  });

  it("treats a repeated status as a no-op without audit", async () => {
    const db = fakeDb({ status: "CALLED" });
    await expect(transitionQueueEntry(db, actor(), "q1", "CALLED")).resolves.toEqual({ changed: false, status: "CALLED" });
    expect(db.queueEntry.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a stale concurrent update instead of bypassing the check", async () => {
    const db = fakeDb({ status: "WAITING", updateCount: 0 });
    await expect(transitionQueueEntry(db, actor(), "q1", "CALLED")).rejects.toThrow();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("denies other-branch, other-center and inactive actors before any write", async () => {
    const denied = [
      fakeDb({ patientBranch: 2 }),
      fakeDb({ patientBranch: 2, user: { role: "THERAPIST", isActive: true, branchId: null, branch: null }, membership: false }),
      fakeDb({ user: { role: "RECEPTION", isActive: false, branchId: 1, branch: { isActive: true } } }),
    ];
    for (const db of denied) {
      const role = db.user.findUnique.getMockImplementation ? "RECEPTION" : "RECEPTION";
      await expect(transitionQueueEntry(db, actor(role), "q1", "CALLED")).rejects.toThrow();
      expect(db.queueEntry.updateMany).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    }
  });

  it("allows an active member of the entry's own center and denies without queue.manage", async () => {
    const member = fakeDb({ patientBranch: 2, user: { role: "THERAPIST", isActive: true, branchId: null, branch: null }, membership: true });
    await expect(transitionQueueEntry(member, actor("THERAPIST"), "q1", "CALLED")).resolves.toMatchObject({ changed: true });
    const noPerm = fakeDb();
    await expect(transitionQueueEntry(noPerm, actor("RECEPTION", new Set()), "q1", "CALLED")).rejects.toThrow();
  });
});
