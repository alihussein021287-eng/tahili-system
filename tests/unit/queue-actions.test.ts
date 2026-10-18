import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  assertPerm: vi.fn(), assertAdminDelete: vi.fn(),
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "RECEPTION" } })),
  currentPerms: vi.fn(async () => new Set(["queue.manage"])),
}));
const scope = vi.hoisted(() => ({ assertQueueScope: vi.fn(), isQueueStatus: vi.fn(() => true), transitionQueueEntry: vi.fn() }));
const db = vi.hoisted(() => ({
  prisma: { queueEntry: { findUnique: vi.fn(), updateMany: vi.fn() } },
}));
const halls = vi.hoisted(() => ({ assertCenterHallByName: vi.fn() }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/access", () => access);
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/queue-transitions", () => scope);
vi.mock("@/lib/center-halls", () => halls);
vi.mock("@/lib/audit", () => audit);
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { assignQueueHall } from "@/app/(app)/queue/actions";

function assignment(entryId = "queue-1", centerId = "4", hall = "قاعة التأهيل") {
  const form = new FormData();
  form.set("queueEntryId", entryId);
  form.set("centerId", centerId);
  form.set("hall", hall);
  return form;
}

describe("assignQueueHall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scope.assertQueueScope.mockResolvedValue(undefined);
    db.prisma.queueEntry.findUnique.mockResolvedValue({ id: "queue-1", centerId: 4, hall: null, status: "WAITING" });
    db.prisma.queueEntry.updateMany.mockResolvedValue({ count: 1 });
    halls.assertCenterHallByName.mockResolvedValue({ therapyHall: { name: "قاعة التأهيل" } });
  });

  it("refuses an out-of-scope entry before any update", async () => {
    scope.assertQueueScope.mockRejectedValueOnce(new Error("غير مصرح"));
    await expect(assignQueueHall(assignment())).rejects.toThrow();
    expect(db.prisma.queueEntry.updateMany).not.toHaveBeenCalled();
  });

  it("updates the existing waiting entry instead of creating another queue entry", async () => {
    await assignQueueHall(assignment());

    expect(access.assertPerm).toHaveBeenCalledWith("queue.manage");
    expect(halls.assertCenterHallByName).toHaveBeenCalledWith(db.prisma, 4, "قاعة التأهيل");
    expect(db.prisma.queueEntry.updateMany).toHaveBeenCalledWith({
      where: { id: "queue-1", status: "WAITING", hall: null },
      data: { centerId: 4, hall: "قاعة التأهيل" },
    });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", recordId: "queue-1" }));
    expect(cache.revalidatePath).toHaveBeenCalledWith("/queue");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/patients-care");
  });

  it("refuses an entry that already has a hall", async () => {
    db.prisma.queueEntry.findUnique.mockResolvedValue({ id: "queue-1", centerId: 4, hall: "قاعة سابقة", status: "WAITING" });

    await expect(assignQueueHall(assignment())).rejects.toThrow("لا يمكن تعيين قاعة لهذا المدخل");
    expect(db.prisma.queueEntry.updateMany).not.toHaveBeenCalled();
  });

  it("allows a missing center to be assigned with its hall", async () => {
    db.prisma.queueEntry.findUnique.mockResolvedValue({ id: "queue-1", centerId: null, hall: null, status: "WAITING" });

    await assignQueueHall(assignment("queue-1", "7", "قاعة الأطفال"));

    expect(db.prisma.queueEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { centerId: 7, hall: "قاعة التأهيل" },
    }));
  });
});
