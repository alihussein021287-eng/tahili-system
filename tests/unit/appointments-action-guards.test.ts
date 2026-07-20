import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(app)/appointments/actions.ts", "utf8");

describe("appointment center hall guards", () => {
  it("validates selected halls against the selected center on the server", () => {
    expect(source).toContain("assertCenterHallById");
    expect(source.match(/الفرع\/القاعة لا يتبع المركز المختار/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("checks hall conflicts for manual and therapy-linked appointments", () => {
    expect(source).toContain("OR: or");
    expect(source).toContain("session: { is: { hallId: params.hallId } }");
    expect(source).toContain("يوجد موعد آخر لنفس الفرع/القاعة في نفس الوقت");
  });
});
