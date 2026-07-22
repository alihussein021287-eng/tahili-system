import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/PatientTabs.tsx", "utf8");

describe("patient file tabs navigation", () => {
  it("stores the selected tab in the URL for deep links and browser history", () => {
    expect(source).toContain('const requestedTab = searchParams.get("tab")');
    expect(source).toContain('next.set("tab", key)');
    expect(source).toContain('router.push(`${pathname}?${next.toString()}`, { scroll: false })');
  });

  it("filters tabs by effective permissions and omits empty groups", () => {
    expect(source).toContain("const visibleTabs = TABS.filter((item) => item.perms.some(can))");
    expect(source).toContain("if (!items.length) return null");
    expect(source).toContain('perms: ["expenses.view"]');
    expect(source).toContain('perms: ["audit.view"]');
  });

  it("opens the active group and exposes accessible disclosure state", () => {
    expect(source).toContain("[activeTab.group]: true");
    expect(source).toContain("aria-expanded={expanded}");
    expect(source).toContain("aria-controls={`patient-tabs-${group}`}");
  });

  it("uses distinct section and activity labels without duplicate headings", () => {
    expect(source).toContain('system: "سجل الملف"');
    expect(source).toContain('label: "سجل النشاط"');
    expect(source).not.toContain('system: "النشاط"');
    expect(source).not.toContain('label: "النشاط"');
  });
});
