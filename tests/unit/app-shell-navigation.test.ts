import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/AppShell.tsx", "utf8");

describe("AppShell navigation", () => {
  it("does not duplicate navigation registry definitions in the shell", () => {
    expect(source).not.toContain('label: "لوحة المرضى والرعاية"');
    expect(source).not.toContain('label: "لوحة المسار العلاجي والمراكز"');
    expect(source).not.toContain('label: "لوحة التقارير والمالية"');
    expect(source).not.toContain('label: "لوحة الصيدلية والمخزون"');
    expect(source).not.toContain('label: "لوحة الموظفين والمهام"');
    expect(source).not.toContain("const ALL_ITEMS");
    expect(source).not.toContain("const NAV_GROUPS");
  });

  it("makes group titles navigable and uses a separate disclosure button", () => {
    expect(source).toContain("<Link href={headerLink.href}");
    expect(source).toContain("aria-controls={`sidebar-group-${g.key}`}");
    expect(source).toContain('aria-label={`${isOpen ? "إغلاق" : "فتح"} روابط ${g.title}`}');
    expect(source).toContain("onClick={() => toggleGroup(g.key)}");
    expect(source).toContain("navigationGroupChildren(g)");
    expect(source).toContain('aria-current={headerLink.href === activeHref ? "page" : undefined}');
  });

  it("keeps the mobile drawer and main content keyboard accessible", () => {
    expect(source).toContain('href="#main-content"');
    expect(source).toContain('id="main-content"');
    expect(source).toContain("aria-hidden={!open}");
    expect(source).toContain("inert={!open ? true : undefined}");
    expect(source).toContain('document.body.style.overflow = "hidden"');
    expect(source).toContain("mobileMenuButtonRef.current?.focus()");
    expect(source).toContain('aria-label={`اختيار المظهر، الحالي ${labels[preference]}`}');
    expect(source).toContain('role="menuitemradio"');
    expect(source).toContain('aria-checked={preference === value}');
  });
});
