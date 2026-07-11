import type { UserRole } from "@prisma/client";
import { roleDefaultSet } from "@/lib/perms";

export type PermissionOverride = {
  permKey: string;
  allowed: boolean;
};

export type PermissionStore = {
  findRolePermissions(role: UserRole): Promise<PermissionOverride[]>;
  findUserPermissions(userId: string): Promise<PermissionOverride[]>;
};

export class PermissionStoreUnavailableError extends Error {
  readonly code = "PERMISSION_STORE_UNAVAILABLE";

  constructor() {
    super("تعذر التحقق من الصلاحيات");
    this.name = "PermissionStoreUnavailableError";
  }
}

export async function loadPermissionsFromStore(
  userId: string | undefined,
  role: UserRole | undefined,
  store: PermissionStore,
): Promise<Set<string>> {
  if (!role) return new Set();
  if (role === "ADMIN" && !userId) return new Set();

  let roleOverrides: PermissionOverride[];
  let userOverrides: PermissionOverride[];
  try {
    [roleOverrides, userOverrides] = await Promise.all([
      store.findRolePermissions(role),
      userId ? store.findUserPermissions(userId) : Promise.resolve([]),
    ]);
  } catch {
    // Do not retain the database error: framework error serialization must not
    // expose connection strings or query details to callers.
    throw new PermissionStoreUnavailableError();
  }

  // Defaults are applied only after the permission store was read successfully.
  // This also prevents ADMIN from bypassing store availability checks.
  const permissions = roleDefaultSet(role);
  for (const item of roleOverrides) {
    if (item.allowed) permissions.add(item.permKey);
    else permissions.delete(item.permKey);
  }
  for (const item of userOverrides) {
    if (item.allowed) permissions.add(item.permKey);
    else permissions.delete(item.permKey);
  }
  return permissions;
}

export async function assertPermissionLoaded(
  key: string,
  loader: () => Promise<Set<string>>,
) {
  const permissions = await loader();
  if (!permissions.has(key)) throw new Error("غير مصرّح بهذا الإجراء");
  return permissions;
}
