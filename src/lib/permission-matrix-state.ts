export function setRolePermissionSnapshot(
  snapshots: Record<string, string[]>,
  role: string,
  key: string,
  allowed: boolean,
) {
  const current = snapshots[role] ?? [];
  return {
    ...snapshots,
    [role]: allowed
      ? [...new Set([...current, key])]
      : current.filter((item) => item !== key),
  };
}

export function setUserPermissionSnapshot(
  snapshots: Record<string, Record<string, boolean>>,
  userId: string,
  key: string,
  allowed: boolean,
) {
  return {
    ...snapshots,
    [userId]: { ...(snapshots[userId] ?? {}), [key]: allowed },
  };
}

export function clearUserPermissionSnapshot(
  snapshots: Record<string, Record<string, boolean>>,
  userId: string,
) {
  const next = { ...snapshots };
  delete next[userId];
  return next;
}
