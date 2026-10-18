import { describe, expect, it } from "vitest";
import { staffNavActive, staffNavTabs } from "@/lib/staff-nav";

const perms = (...k: string[]) => new Set(k);

describe("unified staff navigation", () => {
  it("shows only the entries whose own permission the viewer holds, in the approved order", () => {
    const all = staffNavTabs(perms("users.view", "employees.view", "attendance.view", "shifts.view", "tasks.view"), "ADMIN").map((t) => t.key);
    expect(all).toEqual(["overview", "records", "accounts", "attendance", "shifts", "leaves", "tasks", "reports"]);
    expect(staffNavTabs(perms("tasks.view"), "RECEPTION").map((t) => t.key)).toEqual(["overview", "tasks", "reports"]);
    expect(staffNavTabs(perms(), "RECEPTION")).toEqual([]);
  });
  it("account administration is only linked for ADMIN; others keep the read-only list inside Staff; records need employees.view", () => {
    expect(staffNavTabs(perms("users.view"), "ADMIN").find((t) => t.key === "accounts")!.href).toBe("/users");
    expect(staffNavTabs(perms("users.view"), "MANAGER").find((t) => t.key === "accounts")!.href).toBe("/staff?tab=employees");
    expect(staffNavTabs(perms("users.view"), "ADMIN").some((t) => t.key === "records")).toBe(false);
  });
  it("maps the legacy employees tab onto the unified accounts entry", () => {
    expect(staffNavActive("employees")).toBe("accounts");
    expect(staffNavActive("tasks")).toBe("tasks");
  });
});
