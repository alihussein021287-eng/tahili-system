export type PresenceStatus = "online" | "idle" | "offline";

export const PRESENCE_ONLINE_WINDOW_MS = 3 * 60 * 1000;
export const PRESENCE_IDLE_WINDOW_MS = 15 * 60 * 1000;

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  online: "أونلاين",
  idle: "خامل",
  offline: "أوفلاين",
};

export function getPresenceStatus(lastSeenAt: Date | string | null | undefined, now = new Date()): PresenceStatus {
  if (!lastSeenAt) return "offline";
  const seenAt = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  const ageMs = now.getTime() - seenAt.getTime();
  if (!Number.isFinite(ageMs)) return "offline";
  if (ageMs <= PRESENCE_ONLINE_WINDOW_MS) return "online";
  if (ageMs <= PRESENCE_IDLE_WINDOW_MS) return "idle";
  return "offline";
}

export function presenceBadgeClass(status: PresenceStatus) {
  if (status === "online") return "badge-success";
  if (status === "idle") return "badge-warning";
  return "badge-neutral";
}
