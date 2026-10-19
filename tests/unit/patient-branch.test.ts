import { describe, expect, it } from "vitest";
import { resolveRegistrationBranch, resolveUpdateBranch } from "@/lib/patient-branch";

const staff = { canViewAllBranches: false, userBranchId: 1, userBranchActive: true };
const admin = { canViewAllBranches: true, userBranchId: null, userBranchActive: false };
const active = (id: number) => ({ id, isActive: true });

describe("patient registration branch invariant", () => {
  it("branch-bound staff default to their own branch", () => {
    expect(resolveRegistrationBranch(staff, null, null)).toEqual({ ok: true, branchId: 1 });
    expect(resolveRegistrationBranch(staff, 1, active(1))).toEqual({ ok: true, branchId: 1 });
  });
  it("branch-bound staff cannot register into another branch", () => {
    expect(resolveRegistrationBranch(staff, 2, active(2)).ok).toBe(false);
  });
  it("staff without an active branch cannot register (no NULL branch)", () => {
    expect(resolveRegistrationBranch({ ...staff, userBranchId: null }, null, null).ok).toBe(false);
    expect(resolveRegistrationBranch({ ...staff, userBranchActive: false }, null, null).ok).toBe(false);
  });
  it("ADMIN must select a branch explicitly", () => {
    expect(resolveRegistrationBranch(admin, null, null).ok).toBe(false);
    expect(resolveRegistrationBranch(admin, 2, active(2))).toEqual({ ok: true, branchId: 2 });
  });
  it("ADMIN cannot use a missing or inactive branch", () => {
    expect(resolveRegistrationBranch(admin, 9, null).ok).toBe(false);
    expect(resolveRegistrationBranch(admin, 9, { id: 9, isActive: false }).ok).toBe(false);
  });
  it("central actor with an own active branch gets it only when nothing else is chosen", () => {
    const central = { canViewAllBranches: true, userBranchId: 3, userBranchActive: true };
    expect(resolveRegistrationBranch(central, null, null)).toEqual({ ok: true, branchId: 3 });
    expect(resolveRegistrationBranch(central, 4, active(4))).toEqual({ ok: true, branchId: 4 });
  });
  it("update keeps the stored branch (including legacy NULL) unless a central actor changes it", () => {
    expect(resolveUpdateBranch(staff, null, null, null)).toEqual({ ok: true, branchId: null });
    expect(resolveUpdateBranch(staff, 1, null, null)).toEqual({ ok: true, branchId: 1 });
    expect(resolveUpdateBranch(staff, 1, 2, active(2)).ok).toBe(false);
    expect(resolveUpdateBranch(admin, 1, 2, active(2))).toEqual({ ok: true, branchId: 2 });
    expect(resolveUpdateBranch(admin, 1, 2, { id: 2, isActive: false }).ok).toBe(false);
  });
});
