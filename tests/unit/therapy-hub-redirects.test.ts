import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("@/lib/access", () => ({
  requireSession: async () => ({ user: { id: "u1", role: "ADMIN" } }),
  currentPerms: async () => new Set(["therapy.view"]),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/center-access", () => ({ accessibleCenterIds: async () => null }));

import TherapyCentersPage from "@/app/(app)/therapy-centers/page";
import { THERAPY_CENTERS_NAV, movedTabUrl, THERAPY_CENTERS_MOVED } from "@/lib/hub-nav";

async function redirectOf(sp: Record<string, string>) {
  try {
    await TherapyCentersPage({ searchParams: Promise.resolve(sp) });
  } catch (error) {
    return String((error as Error).message);
  }
  return "no redirect";
}

describe("therapy hub sends moved tabs to their own page", () => {
  it.each([
    [{ tab: "plans", planStatus: "ACTIVE", therapyType: "PHYSIO", q: "علي" }, "REDIRECT /therapy?q=%D8%B9%D9%84%D9%8A&status=ACTIVE&type=PHYSIO"],
    [{ tab: "program" }, "REDIRECT /therapy"],
    [{ tab: "today" }, "REDIRECT /therapy/today"],
    [{ tab: "centers", serviceType: "PSYCHOLOGICAL", programStatus: "ACTIVE" }, "REDIRECT /centers?service=PSYCHOLOGICAL&status=ACTIVE"],
    [{ tab: "beds" }, "REDIRECT /beds"],
    [{ tab: "meds" }, "REDIRECT /meds"],
  ])("%j", async (sp, expected) => {
    expect(await redirectOf(sp)).toBe(expected);
  });

  it("keeps one entry per feature and points moved tabs at real pages", () => {
    const hrefs = THERAPY_CENTERS_NAV.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const tab of Object.keys(THERAPY_CENTERS_MOVED)) {
      expect(movedTabUrl(THERAPY_CENTERS_MOVED, tab, {})).not.toContain("therapy-centers");
    }
  });
});
