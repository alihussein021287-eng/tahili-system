import { describe, expect, it } from "vitest";
import { canApplyAdminChange } from "@/lib/admin-security";

const activeAdmin = { role: "ADMIN", isActive: true };

describe("last active admin protection", () => {
  it("rejects disabling the last active admin", () => {
    expect(canApplyAdminChange(1, activeAdmin, { ...activeAdmin, isActive: false })).toBe(false);
  });

  it("allows disabling one of two active admins", () => {
    expect(canApplyAdminChange(2, activeAdmin, { ...activeAdmin, isActive: false })).toBe(true);
  });

  it("rejects demoting the last active admin", () => {
    expect(canApplyAdminChange(1, activeAdmin, { role: "MANAGER", isActive: true })).toBe(false);
  });

  it("allows demoting one of two active admins", () => {
    expect(canApplyAdminChange(2, activeAdmin, { role: "MANAGER", isActive: true })).toBe(true);
  });
});
