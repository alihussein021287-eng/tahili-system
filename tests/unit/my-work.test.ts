import { describe, expect, it } from "vitest";
import {
  dedupeWorkItems,
  derivePriority,
  filterWorkItems,
  normalizeWorkFilters,
  paginateWorkItems,
  sortWorkItems,
  type WorkItem,
} from "@/lib/my-work";

const now = new Date("2026-07-24T09:00:00.000Z");

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    key: "task:1",
    dedupeKey: "task:1",
    type: "task",
    title: "عمل",
    status: "OPEN",
    priority: "normal",
    waitingSince: new Date("2026-07-24T08:00:00.000Z"),
    dueAt: null,
    nextAction: "فتح",
    href: "/staff?tab=tasks",
    requiredPermission: "tasks.view",
    ...overrides,
  };
}

describe("my work rules", () => {
  it("derives overdue and near-due priorities without inventing persisted state", () => {
    expect(derivePriority({ now, dueAt: new Date("2026-07-24T08:59:00.000Z") })).toBe("urgent");
    expect(derivePriority({ now, dueAt: new Date("2026-07-25T08:00:00.000Z") })).toBe("high");
    expect(derivePriority({ now, explicit: "LOW" })).toBe("low");
  });

  it("deduplicates shared workflow items and keeps the most urgent representation", () => {
    const rows = dedupeWorkItems([
      item({ key: "stage:1", dedupeKey: "referral:1", priority: "normal" }),
      item({ key: "referral:1", dedupeKey: "referral:1", type: "referral", priority: "urgent" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("referral:1");
  });

  it("sorts urgent and overdue work before routine work", () => {
    const rows = sortWorkItems([
      item({ key: "normal", dedupeKey: "normal" }),
      item({ key: "urgent", dedupeKey: "urgent", priority: "urgent" }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["urgent", "normal"]);
  });

  it("bounds pagination and ignores unknown filters safely", () => {
    const filters = normalizeWorkFilters({ type: "NOT_A_TYPE", priority: "INVALID", date: "someday", page: "99999", center: "-4", status: "x';drop" });
    expect(filters).toMatchObject({ type: "all", priority: "all", date: "all", page: 20, centerId: null, status: "all" });
    const rows = Array.from({ length: 80 }, (_, index) => item({ key: `task:${index}`, dedupeKey: `task:${index}` }));
    const page = paginateWorkItems(rows, 99, 999);
    expect(page.page).toBe(20);
    expect(page.pageSize).toBe(50);
    expect(page.items).toHaveLength(0);
  });

  it("filters by type, priority, center, status, and date in memory", () => {
    const rows = [
      item({ type: "appointment", status: "SCHEDULED", priority: "high", centerId: 2, dueAt: new Date("2026-07-24T12:00:00.000Z") }),
      item({ key: "task:2", dedupeKey: "task:2", centerId: 3 }),
    ];
    const filters = normalizeWorkFilters({ type: "appointment", status: "scheduled", priority: "high", center: "2", date: "today" });
    expect(filterWorkItems(rows, filters, now)).toHaveLength(1);
  });
});
