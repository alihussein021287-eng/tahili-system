export function patientCenterScope<T extends { centerId?: number | null }>(items: T[], allowedCenterIds: ReadonlySet<number>, central: boolean, allowUnassigned = false) {
  if (central) return items;
  return items.filter((item) => (allowUnassigned && !item.centerId) || allowedCenterIds.has(item.centerId ?? -1));
}
