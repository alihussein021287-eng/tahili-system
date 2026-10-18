import { describe, expect, it } from "vitest";
import {
  clearUserPermissionSnapshot,
  setRolePermissionSnapshot,
  setUserPermissionSnapshot,
} from "@/lib/permission-matrix-state";

describe("permission matrix optimistic state", () => {
  it("updates a role snapshot immediately when a permission is toggled", () => {
    expect(setRolePermissionSnapshot({ MANAGER: ["patients.view"] }, "MANAGER", "reports.view", true))
      .toEqual({ MANAGER: ["patients.view", "reports.view"] });
    expect(setRolePermissionSnapshot({ MANAGER: ["patients.view"] }, "MANAGER", "patients.view", false))
      .toEqual({ MANAGER: [] });
  });

  it("updates and clears user overrides immediately", () => {
    const updated = setUserPermissionSnapshot({ user_1: { "patients.view": true } }, "user_1", "reports.view", false);
    expect(updated).toEqual({ user_1: { "patients.view": true, "reports.view": false } });
    expect(clearUserPermissionSnapshot(updated, "user_1")).toEqual({});
  });
});
