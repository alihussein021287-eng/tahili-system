import { describe, expect, it } from "vitest";
import { isBackupStale, readinessDiskStatus } from "@/lib/readiness-config";

describe("readiness configurable thresholds", () => {
  const config = { diskWarnPercent: 80, diskCriticalPercent: 90 };

  it("uses configured disk warning and critical thresholds", () => {
    expect(readinessDiskStatus(79.9, config)).toBe("ok");
    expect(readinessDiskStatus(80, config)).toBe("warn");
    expect(readinessDiskStatus(90, config)).toBe("fail");
  });

  it("uses configured backup staleness windows", () => {
    const now = new Date("2026-07-19T12:00:00.000Z").getTime();
    expect(isBackupStale(new Date("2026-07-18T13:00:00.000Z"), 24, now)).toBe(false);
    expect(isBackupStale(new Date("2026-07-18T11:59:59.000Z"), 24, now)).toBe(true);
    expect(isBackupStale(null, 24, now)).toBe(true);
  });
});
