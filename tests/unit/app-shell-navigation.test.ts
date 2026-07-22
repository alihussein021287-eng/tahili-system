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
    expect(source).toContain('href: "/patients-care?tab=overview", hrefs: ["/patients-care?tab=overview", "/patients-care?tab=patients", "/patients-care?tab=queue", "/patients-care?tab=visits", "/patients-care?tab=appointments", "/patients-care?tab=referrals"]');
    expect(source).toContain('href: "/therapy-centers?tab=overview", hrefs: ["/therapy-centers?tab=overview", "/therapy-centers?tab=plans", "/therapy-centers?tab=sessions", "/therapy-centers?tab=today", "/therapy-centers?tab=centers", "/therapy-centers?tab=beds", "/therapy-centers?tab=meds"]');
    expect(source).toContain('href: "/pharmacy-inventory?tab=overview", hrefs: ["/pharmacy-inventory?tab=overview", "/pharmacy-inventory?tab=dispense", "/pharmacy-inventory?tab=stock", "/pharmacy-inventory?tab=batches", "/pharmacy-inventory?tab=purchases", "/pharmacy-inventory?tab=reports"]');
    expect(source).toContain('href: "/reports-finance?tab=overview", hrefs: ["/reports-finance?tab=overview", "/reports-finance?tab=official", "/reports-finance?tab=patients", "/reports-finance?tab=finance", "/reports-finance?tab=wounded", "/reports-finance?tab=approvals"]');
    expect(source).toContain('href: "/staff?tab=overview", hrefs: ["/staff?tab=overview", "/staff?tab=employees", "/staff?tab=tasks", "/staff?tab=attendance", "/staff?tab=shifts", "/staff?tab=leaves"]');
    expect(source).toContain('href: "/settings", hrefs: ["/settings", "/users", "/permissions", "/audit", "/login-log", "/backup", "/readiness"]');
  });

  it("keeps focused role sidebar rules for noisy groups", () => {
    expect(source).toContain("RECEPTION:");
    expect(source).toContain('hrefs: ["/patients-care?tab=overview", "/patients-care?tab=patients", "/patients-care?tab=queue", "/patients-care?tab=visits", "/patients-care?tab=appointments"]');
    expect(source).toContain("PHARMACIST:");
    expect(source).toContain('groups: ["pharm"]');
    expect(source).toContain("ACCOUNTANT:");
    expect(source).toContain('groups: ["reports"]');
    expect(source).toContain("role === \"ADMIN\"");
  });

  it("makes group titles navigable and uses a separate disclosure button", () => {
    expect(source).toContain("<Link href={headerLink.href}");
    expect(source).toContain("aria-controls={`sidebar-group-${g.key}`}");
    expect(source).toContain('aria-label={`${isOpen ? "إغلاق" : "فتح"} روابط ${g.title}`}');
    expect(source).toContain("onClick={() => toggleGroup(g.key)}");
  });

  it("keeps the mobile drawer and main content keyboard accessible", () => {
    expect(source).toContain('href="#main-content"');
    expect(source).toContain('id="main-content"');
    expect(source).toContain("aria-hidden={!open}");
    expect(source).toContain("inert={!open ? true : undefined}");
    expect(source).toContain('aria-label={dark ? "استخدام الوضع الفاتح" : "استخدام الوضع الداكن"}');
  });
});
