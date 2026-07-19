export type ReadinessThresholdStatus = "ok" | "warn" | "fail";

export type DiskThresholdConfig = {
  diskWarnPercent: number;
  diskCriticalPercent: number;
};

export function isBackupStale(date: Date | null | undefined, staleHours: number, now = Date.now()) {
  if (!date) return true;
  return now - date.getTime() > staleHours * 3600000;
}

export function readinessDiskStatus(usedPercent: number, config: DiskThresholdConfig): ReadinessThresholdStatus {
  if (!Number.isFinite(usedPercent)) return "warn";
  if (usedPercent >= config.diskCriticalPercent) return "fail";
  if (usedPercent >= config.diskWarnPercent) return "warn";
  return "ok";
}
