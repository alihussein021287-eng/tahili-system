import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("@/lib/access", () => ({
  requireSession: async () => ({ user: { id: "u1", role: "ADMIN" } }),
  currentPerms: async () => new Set(["pharmacy.view"]),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import PharmacyInventoryPage from "@/app/(app)/pharmacy-inventory/page";
import ReportsFinancePage from "@/app/(app)/reports-finance/page";
import { expiryLevel, EXPIRY_LABEL } from "@/lib/pharmacy-expiry";

async function redirectOf(page: (args: any) => Promise<unknown>, sp: Record<string, string>) {
  try {
    await page({ searchParams: Promise.resolve(sp) });
  } catch (error) {
    return String((error as Error).message);
  }
  return "no redirect";
}

describe("pharmacy tabs open their working pages", () => {
  it.each([
    [{ tab: "dispense", rxQ: "علي", rxState: "partial" }, "REDIRECT /pharmacy?q=%D8%B9%D9%84%D9%8A&state=partial"],
    [{ tab: "stock", stockState: "low" }, "REDIRECT /pharmacy/stock?state=low"],
    [{ tab: "purchases", purchaseStatus: "ORDERED" }, "REDIRECT /pharmacy/purchases?status=ORDERED"],
    [{ tab: "reports" }, "REDIRECT /pharmacy/reports"],
    [{ tab: "alerts" }, "REDIRECT /pharmacy-inventory?tab=overview"],
  ])("%j", async (sp, expected) => {
    expect(await redirectOf(PharmacyInventoryPage, sp)).toBe(expected);
  });
});

describe("reports and finance tabs open their working pages", () => {
  it.each([
    [{ tab: "finance", invoiceStatus: "UNPAID" }, "REDIRECT /finance?status=UNPAID"],
    [{ tab: "wounded", expenseStatus: "SUBMITTED" }, "REDIRECT /finance/expenses?status=SUBMITTED"],
    [{ tab: "approvals" }, "REDIRECT /approvals"],
    [{ tab: "alerts" }, "REDIRECT /reports-finance?tab=overview"],
  ])("%j", async (sp, expected) => {
    expect(await redirectOf(ReportsFinancePage, sp)).toBe(expected);
  });
});

describe("one expiry rule", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
  it("is red within 30 days and yellow within 90", () => {
    expect(expiryLevel(days(-1), now)).toBe("expired");
    expect(expiryLevel(days(10), now)).toBe("urgent");
    expect(expiryLevel(days(30), now)).toBe("urgent");
    expect(expiryLevel(days(31), now)).toBe("soon");
    expect(expiryLevel(days(90), now)).toBe("soon");
    expect(expiryLevel(days(91), now)).toBe("ok");
    expect(expiryLevel(null, now)).toBe("none");
    expect(EXPIRY_LABEL.urgent).toBe("عاجل");
    expect(EXPIRY_LABEL.soon).toBe("قريب");
  });
});
