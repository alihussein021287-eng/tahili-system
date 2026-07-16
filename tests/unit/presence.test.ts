import { describe, expect, it } from "vitest";
import { getPresenceStatus } from "@/lib/presence";

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
});
