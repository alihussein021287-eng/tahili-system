import { describe, expect, it, vi } from "vitest";
import {
  assertPermissionLoaded,
  loadPermissionsFromStore,
  PermissionStoreUnavailableError,
  type PermissionStore,
} from "@/lib/permission-store";
import { ALL_PERMS, roleDefaultSet } from "@/lib/perms";

function store(
  rolePermissions: PermissionStore["findRolePermissions"] = async () => [],
  userPermissions: PermissionStore["findUserPermissions"] = async () => [],
): PermissionStore {
  return { findRolePermissions: rolePermissions, findUserPermissions: userPermissions };
}

describe("fail-closed permission loading", () => {
  it("keeps role defaults when the store succeeds with no overrides", async () => {
    const result = await loadPermissionsFromStore("user-1", "VIEWER", store());
    expect(result).toEqual(roleDefaultSet("VIEWER"));
  });

  it("applies role allow and deny overrides", async () => {
    const defaultPermission = [...roleDefaultSet("VIEWER")][0];
    const result = await loadPermissionsFromStore(
      "user-1",
      "VIEWER",
      store(async () => [
        { permKey: "custom.allowed", allowed: true },
        { permKey: defaultPermission, allowed: false },
      ]),
    );
    expect(result.has("custom.allowed")).toBe(true);
    expect(result.has(defaultPermission)).toBe(false);
  });

  it("applies user overrides after role overrides", async () => {
    const result = await loadPermissionsFromStore(
      "user-1",
      "VIEWER",
      store(
        async () => [{ permKey: "custom.permission", allowed: false }],
        async () => [{ permKey: "custom.permission", allowed: true }],
      ),
    );
    expect(result.has("custom.permission")).toBe(true);
  });

  it("throws the classified error when role permissions fail", async () => {
    await expect(loadPermissionsFromStore(
      "user-1",
      "VIEWER",
      store(async () => { throw new Error("database details"); }),
    )).rejects.toBeInstanceOf(PermissionStoreUnavailableError);
  });

  it("throws the classified error when user permissions fail", async () => {
    await expect(loadPermissionsFromStore(
      "user-1",
      "VIEWER",
      store(async () => [], async () => { throw new Error("database details"); }),
    )).rejects.toBeInstanceOf(PermissionStoreUnavailableError);
  });

  it("does not let assertPerm-style checks pass when the store fails", async () => {
    const mutation = vi.fn();
    const guardedMutation = async () => {
      await assertPermissionLoaded("patients.edit", async () => {
        throw new PermissionStoreUnavailableError();
      });
      mutation();
    };
    await expect(guardedMutation()).rejects.toBeInstanceOf(PermissionStoreUnavailableError);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("does not let ADMIN bypass the required store read", async () => {
    const findRolePermissions = vi.fn(async () => { throw new Error("offline"); });
    await expect(loadPermissionsFromStore("admin-1", "ADMIN", store(findRolePermissions)))
      .rejects.toBeInstanceOf(PermissionStoreUnavailableError);
    expect(findRolePermissions).toHaveBeenCalledWith("ADMIN");
  });

  it("returns all ADMIN defaults only after a successful store read", async () => {
    const result = await loadPermissionsFromStore("admin-1", "ADMIN", store());
    expect(result.size).toBe(ALL_PERMS.length);
  });

  it("returns no ADMIN permissions when the current user id is missing", async () => {
    const findRolePermissions = vi.fn(async () => []);
    const result = await loadPermissionsFromStore(undefined, "ADMIN", store(findRolePermissions));
    expect(result).toEqual(new Set());
    expect(findRolePermissions).not.toHaveBeenCalled();
  });

  it("returns an empty set when role is missing without querying the store", async () => {
    const findRolePermissions = vi.fn(async () => []);
    const result = await loadPermissionsFromStore("user-1", undefined, store(findRolePermissions));
    expect(result).toEqual(new Set());
    expect(findRolePermissions).not.toHaveBeenCalled();
  });
});
