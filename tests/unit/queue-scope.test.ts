import { describe, expect, it } from "vitest";
import { queueScopeAllows, queueVisibilityWhere } from "@/lib/queue-transitions";

const base = { central: false, userBranchId: 1, userBranchActive: true, entryBranchId: 1, entryCenterId: 5, memberCenterIds: [] as number[] };

describe("queue operation scope", () => {
  it("branch-bound active reception works only in its own branch", () => {
    expect(queueScopeAllows(base)).toBe(true);
    expect(queueScopeAllows({ ...base, entryBranchId: 2 })).toBe(false);
  });
  it("absence of a branch is not central authority", () => {
    expect(queueScopeAllows({ ...base, userBranchId: null, userBranchActive: false, entryBranchId: 2 })).toBe(false);
    expect(queueScopeAllows({ ...base, userBranchId: null, userBranchActive: false, entryBranchId: null })).toBe(false);
  });
  it("an entry with no branch basis is never an automatic allow", () => {
    expect(queueScopeAllows({ ...base, entryBranchId: null })).toBe(false);
    expect(queueScopeAllows({ ...base, entryBranchId: null, memberCenterIds: [5] })).toBe(true);
  });
  it("an inactive own branch confers no authority", () => {
    expect(queueScopeAllows({ ...base, userBranchActive: false })).toBe(false);
  });
  it("center members operate only their center's entries", () => {
    expect(queueScopeAllows({ ...base, entryBranchId: 2, memberCenterIds: [5] })).toBe(true);
    expect(queueScopeAllows({ ...base, entryBranchId: 2, memberCenterIds: [6] })).toBe(false);
  });
  it("only ADMIN-level central scope is unrestricted", () => {
    expect(queueScopeAllows({ ...base, central: true, entryBranchId: 2 })).toBe(true);
  });
});

describe("queue list visibility", () => {
  const v = { central: false, requestedBranchId: 9, userBranchId: 1, userBranchActive: true, memberCenterIds: [] as number[] };
  it("ignores a requested branch for non-central users and fixes the scope to their own branch", () => {
    const where = queueVisibilityWhere(v) as { OR: unknown[] };
    expect(JSON.stringify(where)).toContain('"branchId":1');
    expect(JSON.stringify(where)).not.toContain('"branchId":9');
  });
  it("branchless or inactive-branch users see nothing without a center membership", () => {
    expect(queueVisibilityWhere({ ...v, userBranchId: null, userBranchActive: false })).toEqual({ id: "__no_scope__" });
    expect(queueVisibilityWhere({ ...v, userBranchActive: false })).toEqual({ id: "__no_scope__" });
  });
  it("only central may narrow by a requested branch", () => {
    expect(queueVisibilityWhere({ ...v, central: true, requestedBranchId: null })).toEqual({});
    expect(JSON.stringify(queueVisibilityWhere({ ...v, central: true }))).toContain('"branchId":9');
  });
});
