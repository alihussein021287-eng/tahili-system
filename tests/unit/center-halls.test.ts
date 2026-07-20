import { describe, expect, it, vi } from "vitest";
import { assertCenterHallByName } from "@/lib/center-halls";

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
  });

  it("rejects a hall that is not mapped to the selected center", async () => {
    const db = { centerResource: { findFirst: vi.fn(async () => null) } };

    await expect(assertCenterHallByName(db, 2, "قاعة العلاج المائي")).rejects.toThrow("لا يتبع المركز");
  });
});
