import { describe, expect, it, vi } from "vitest";
import {
  activeCenterHallOptions,
  assertCenterHallByName,
  assertNoDuplicateCenterName,
  assertNoDuplicateCenterHallName,
  centerDeleteUsageCounts,
  centerHallDeleteUsageCounts,
  DUPLICATE_CENTER_HALL_MESSAGE,
  DUPLICATE_CENTER_MESSAGE,
  usageTotal,
} from "@/lib/center-halls";

describe("center hall validation", () => {
  it("accepts an active hall mapped to the selected center", async () => {
    const db = {
      centerResource: {
        findFirst: vi.fn(async () => ({ therapyHall: { id: 7, name: "قاعة العلاج المائي", active: true } })),
      },
    };

    await expect(assertCenterHallByName(db, 1, "قاعة العلاج المائي")).resolves.toMatchObject({
      therapyHall: { name: "قاعة العلاج المائي" },
    });
    expect(db.centerResource.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        center: { is: { active: true } },
        therapyHall: { is: { active: true } },
      }),
    }));
  });

  it("rejects a hall that is not mapped to the selected center", async () => {
    const db = { centerResource: { findFirst: vi.fn(async () => null) } };

    await expect(assertCenterHallByName(db, 2, "قاعة العلاج المائي")).rejects.toThrow("لا يتبع المركز");
  });

  it("rejects duplicate hall names inside the same center", async () => {
    const db = { centerResource: { findFirst: vi.fn(async () => ({ id: "resource-1" })) } };

    await expect(assertNoDuplicateCenterHallName(db, 1, "  قاعة العلاج المائي  ")).rejects.toThrow(DUPLICATE_CENTER_HALL_MESSAGE);
    expect(db.centerResource.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        centerId: 1,
        OR: [{ name: "قاعة العلاج المائي" }, { therapyHall: { is: { name: "قاعة العلاج المائي" } } }],
      }),
    }));
  });

  it("rejects duplicate center names server-side", async () => {
    const db = { center: { findFirst: vi.fn(async () => ({ id: 3 })) } };

    await expect(assertNoDuplicateCenterName(db, "مركز العلاج الطبيعي")).rejects.toThrow(DUPLICATE_CENTER_MESSAGE);
  });

  it("loads active hall options only from active centers", async () => {
    const db = { centerResource: { findMany: vi.fn(async () => []) } };

    await activeCenterHallOptions(db);

    expect(db.centerResource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        center: { is: { active: true } },
        status: "AVAILABLE",
        therapyHall: { is: { active: true } },
      }),
    }));
  });

  it("counts center usage that blocks physical deletion", async () => {
    const counts: Record<string, number> = {
      centerMembership: 0,
      admission: 0,
      referralRequest: 0,
      centerProgram: 1,
      centerSession: 0,
      treatmentPlan: 0,
      therapySession: 0,
      appointment: 2,
      queueEntry: 0,
      displayDevice: 0,
      conversation: 0,
      folder: 0,
      collaborationFile: 0,
      fileShare: 0,
      collaborationQuota: 0,
    };
    const db = Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, { count: vi.fn(async () => count) }]));

    const usage = await centerDeleteUsageCounts(db, 5);

    expect(usageTotal(usage)).toBe(3);
    expect(usage).toMatchObject({ "برامج مراكز": 1, "مواعيد": 2 });
  });

  it("counts hall usage that blocks deleting one center hall mapping", async () => {
    const db = {
      centerSession: { count: vi.fn(async () => 0) },
      treatmentPlan: { count: vi.fn(async () => 0) },
      therapySession: { count: vi.fn(async ({ where }) => where.hallId ? 1 : 0) },
      appointment: { count: vi.fn(async () => 0) },
      queueEntry: { count: vi.fn(async () => 0) },
      displayDevice: { count: vi.fn(async () => 1) },
    };

    const usage = await centerHallDeleteUsageCounts(db, {
      id: "resource-1",
      centerId: 2,
      therapyHallId: 10,
      name: "قاعة العلاج المائي",
      therapyHall: { name: "قاعة العلاج المائي" },
    });

    expect(usageTotal(usage)).toBe(2);
    expect(usage).toMatchObject({ "جلسات علاج": 1, "شاشات انتظار": 1 });
  });
});
