import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/AppShell.tsx", "utf8");

describe("AppShell navigation", () => {
  it("uses overview labels instead of duplicate dashboard links", () => {
    expect(source).not.toContain('label: "لوحة المرضى والرعاية"');
    expect(source).not.toContain('label: "لوحة المسار العلاجي والمراكز"');
    expect(source).not.toContain('label: "لوحة التقارير والمالية"');
    expect(source).not.toContain('label: "لوحة الصيدلية والمخزون"');
    expect(source).not.toContain('label: "لوحة الموظفين والمهام"');
    expect(source).toContain('navLabel: "نظرة عامة"');
  });

  it("routes grouped sidebar links through hub tabs", () => {
    expect(source).toContain('href: "/patients-care?tab=overview"');
    expect(source).toContain('href: "/patients-care?tab=queue"');
    expect(source).toContain('href: "/therapy-centers?tab=plans"');
    expect(source).toContain('href: "/reports-finance?tab=overview"');
    expect(source).toContain('href: "/pharmacy-inventory?tab=overview"');
    expect(source).toContain('href: "/staff?tab=overview"');
  });

  it("keeps focused role sidebar rules for noisy groups", () => {
    expect(source).toContain("RECEPTION:");
    expect(source).toContain('groups: ["care"]');
    expect(source).toContain("PHARMACIST:");
    expect(source).toContain('groups: ["pharm"]');
    expect(source).toContain("ACCOUNTANT:");
    expect(source).toContain('groups: ["reports"]');
    expect(source).toContain("role === \"ADMIN\"");
  });
});
