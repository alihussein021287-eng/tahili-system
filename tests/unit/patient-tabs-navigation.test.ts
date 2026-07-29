import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PATIENT_TABS } from "@/lib/patient-tab-policy";

const source = readFileSync("src/components/PatientTabs.tsx", "utf8");
const patientPageSource = readFileSync("src/app/(app)/patients/[id]/page.tsx", "utf8");

describe("patient file tabs navigation", () => {
  it("stores the selected tab in the URL for deep links and browser history", () => {
    expect(source).toContain('const requestedTab = searchParams.get("tab")');
    expect(source).toContain('next.set("tab", key)');
    expect(source).toContain('router.push(`${pathname}?${next.toString()}`, { scroll: false })');
  });

  it("exposes the resident review form only in the resident tab and focuses its section after navigation", () => {
    expect(PATIENT_TABS).toContainEqual(expect.objectContaining({ key: "resident", label: "الطبيب المقيم" }));
    expect(source).toContain('tab === "resident"');
    expect(source).toContain('action={w(addResidentReview.bind(null, patientId))}');
    expect(source).toContain('sectionHeadingRef.current?.focus()');
    expect(source).toContain('tabIndex={-1}');
  });

  it("does not render an intake tab link for a user missing the resident-review action permission", () => {
    expect(patientPageSource).toContain('canExecuteResidentReview={perms.has("clinical.metrics")}');
    expect(patientPageSource).toContain('nextStep.key === "intake" && !canExecuteResidentReview');
    expect(patientPageSource).toContain("لا يملك حسابك هذا الإجراء");
  });

  it("filters tabs by effective permissions and omits empty groups", () => {
    expect(source).toContain('import { PATIENT_TABS } from "@/lib/patient-tab-policy"');
    expect(source).toContain("const TABS = PATIENT_TABS.map");
    expect(source).toContain("const visibleTabs = TABS.filter((item) => item.perms.some(can))");
    expect(source).toContain("if (!items.length) return null");
    expect(PATIENT_TABS).toContainEqual(expect.objectContaining({ key: "expenses", permissions: ["expenses.view"] }));
    expect(PATIENT_TABS).toContainEqual(expect.objectContaining({ key: "activity", permissions: ["audit.view"] }));
  });

  it("opens the active group and exposes accessible disclosure state", () => {
    expect(source).toContain("[activeTab.group]: true");
    expect(source).toContain("aria-expanded={expanded}");
    expect(source).toContain("aria-controls={`patient-tabs-${group}`}");
  });

  it("uses distinct section and activity labels without duplicate headings", () => {
    expect(source).toContain('system: "سجل الملف"');
    expect(PATIENT_TABS).toContainEqual(expect.objectContaining({ key: "activity", label: "سجل النشاط" }));
    expect(source).not.toContain('system: "النشاط"');
    expect(PATIENT_TABS).not.toContainEqual(expect.objectContaining({ label: "النشاط" }));
  });

  it("exposes every permitted tab as a direct mobile control", () => {
    expect(source).toContain('className="patient-tabs-mobile md:hidden"');
    expect(source).toContain('aria-label="أقسام ملف المراجع"');
    expect(source).toContain('aria-current={tab === item.key ? "page" : undefined}');
    expect(source).toContain('onClick={() => openTab(item.key)}');
  });
});
