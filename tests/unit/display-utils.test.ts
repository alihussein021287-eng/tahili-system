import { describe, expect, it } from "vitest";
import { baghdadDayRange, maskDisplayName } from "@/lib/display-utils";

describe("waiting display privacy and Baghdad day", () => {
  it("masks names in all configured modes", () => {
    expect(maskDisplayName("علي حسين كريم", "FULL", 7)).toBe("علي حسين كريم");
    expect(maskDisplayName("علي حسين كريم", "INITIALS", 7)).toBe("علي ح. ك.");
    expect(maskDisplayName("علي حسين كريم", "QUEUE_NUMBER", 7)).toBe("رقم الانتظار 7");
  });

  it("starts the Baghdad day at 21:00 UTC on the previous date", () => {
    const { start, end } = baghdadDayRange(new Date("2026-07-14T22:30:00.000Z"));
    expect(start.toISOString()).toBe("2026-07-14T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-15T21:00:00.000Z");
  });
});
