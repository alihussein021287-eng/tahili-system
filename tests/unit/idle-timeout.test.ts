import { describe, expect, it } from "vitest";
import { idleExpired } from "@/components/IdleTimeout";

const min = 60 * 1000;
describe("idle sign-out across tabs", () => {
  it("does not sign out a forgotten background tab while another tab is active", () => {
    const now = 100 * min;
    expect(idleExpired(now, now - 45 * min, now - 2 * min, 20)).toBe(false);
  });
  it("signs out when no tab has seen activity for the whole period", () => {
    const now = 100 * min;
    expect(idleExpired(now, now - 25 * min, now - 21 * min, 20)).toBe(true);
    expect(idleExpired(now, now - 20 * min, 0, 20)).toBe(true);
  });
  it("keeps the session for recent local activity even without shared storage", () => {
    const now = 100 * min;
    expect(idleExpired(now, now - 5 * min, 0, 20)).toBe(false);
  });
});
