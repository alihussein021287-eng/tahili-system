import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const printRoutes = [
  "src/app/(app)/appointments/[id]/qr/page.tsx",
  "src/app/(app)/finance/[id]/receipt/page.tsx",
  "src/app/(app)/finance/expenses/[id]/voucher/page.tsx",
  "src/app/(app)/patients/[id]/admission/[admissionId]/page.tsx",
  "src/app/(app)/patients/[id]/card/page.tsx",
  "src/app/(app)/patients/[id]/care-print/page.tsx",
  "src/app/(app)/patients/[id]/journey-print/page.tsx",
  "src/app/(app)/patients/[id]/medical-report/[reportId]/page.tsx",
  "src/app/(app)/patients/[id]/report/page.tsx",
  "src/app/(app)/patients/[id]/sick-leave/[lid]/page.tsx",
  "src/app/(app)/patients/[id]/sick-leave/[lid]/official/page.tsx",
  "src/app/(app)/pharmacy/rx/[id]/page.tsx",
  "src/app/(app)/referrals/[id]/official/page.tsx",
];

describe("print layout contract", () => {
  it("covers every documented print route", () => {
    expect(printRoutes).toHaveLength(13);
    expect(printRoutes.every(existsSync)).toBe(true);
  });

  it("keeps A4 output light, unclipped, and free from app controls", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("@page { size: A4;");
    expect(css).toContain(".no-print, nav, aside");
    expect(css).toContain("background: #fff !important");
    expect(css).toContain("overflow: visible !important");
    expect(css).toContain("thead { display: table-header-group; }");
    expect(css).toContain("tr, .avoid-break { page-break-inside: avoid; }");
  });
});
