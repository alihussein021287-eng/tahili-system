export type PresenceStatus = "online" | "idle" | "offline";
export type PresenceConfig = {
  onlineMinutes?: number;
  idleMinutes?: number;
  pingIntervalSeconds?: number;
};

export const PRESENCE_ONLINE_WINDOW_MS = 3 * 60 * 1000;
export const PRESENCE_IDLE_WINDOW_MS = 15 * 60 * 1000;
export const PRESENCE_PING_INTERVAL_MS = 60 * 1000;

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  online: "أونلاين",
  idle: "خامل",
  offline: "أوفلاين",
};

function intInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function normalizePresenceConfig(config: PresenceConfig | null | undefined) {
  const onlineMinutes = intInRange(config?.onlineMinutes, 3, 1, 60);
  let idleMinutes = intInRange(config?.idleMinutes, 15, 2, 240);
  if (idleMinutes <= onlineMinutes) idleMinutes = Math.min(240, onlineMinutes + 1);
  const pingIntervalSeconds = intInRange(config?.pingIntervalSeconds, 60, 15, 600);
  return { onlineMinutes, idleMinutes, pingIntervalSeconds };
}

export function presenceWindows(config?: PresenceConfig | null) {
  const normalized = normalizePresenceConfig(config);
  return {
    ...normalized,
    onlineWindowMs: normalized.onlineMinutes * 60 * 1000,
    idleWindowMs: normalized.idleMinutes * 60 * 1000,
    pingIntervalMs: normalized.pingIntervalSeconds * 1000,
  };
}

export function getPresenceStatus(lastSeenAt: Date | string | null | undefined, now = new Date(), config?: PresenceConfig | null): PresenceStatus {
  if (!lastSeenAt) return "offline";
  const seenAt = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  const ageMs = now.getTime() - seenAt.getTime();
  const windows = presenceWindows(config);
  if (!Number.isFinite(ageMs)) return "offline";
  if (ageMs <= windows.onlineWindowMs) return "online";
  if (ageMs <= windows.idleWindowMs) return "idle";
  return "offline";
}

export function presenceBadgeClass(status: PresenceStatus) {
  if (status === "online") return "badge-success";
  if (status === "idle") return "badge-warning";
  return "badge-neutral";
}
