import { describe, expect, it } from "vitest";
import { getPresenceStatus, normalizePresenceConfig, presenceWindows } from "@/lib/presence";

describe("user presence status", () => {
  const now = new Date("2026-07-16T09:00:00.000Z");

  it("marks users online within three minutes", () => {
    expect(getPresenceStatus(new Date("2026-07-16T08:57:00.000Z"), now)).toBe("online");
  });

  it("marks users idle after three minutes and within fifteen minutes", () => {
    expect(getPresenceStatus(new Date("2026-07-16T08:56:59.000Z"), now)).toBe("idle");
    expect(getPresenceStatus(new Date("2026-07-16T08:45:00.000Z"), now)).toBe("idle");
  });

  it("marks missing or old presence as offline", () => {
    expect(getPresenceStatus(null, now)).toBe("offline");
    expect(getPresenceStatus(new Date("2026-07-16T08:44:59.000Z"), now)).toBe("offline");
  });

  it("uses configured windows and normalizes unsafe values", () => {
    expect(getPresenceStatus(new Date("2026-07-16T08:50:00.000Z"), now, { onlineMinutes: 10, idleMinutes: 20 })).toBe("online");
    expect(getPresenceStatus(new Date("2026-07-16T08:49:59.000Z"), now, { onlineMinutes: 10, idleMinutes: 20 })).toBe("idle");
    expect(normalizePresenceConfig({ onlineMinutes: 20, idleMinutes: 10, pingIntervalSeconds: 5 })).toEqual({
      onlineMinutes: 20,
      idleMinutes: 21,
      pingIntervalSeconds: 60,
    });
    expect(presenceWindows({ pingIntervalSeconds: 120 }).pingIntervalMs).toBe(120_000);
  });
});
