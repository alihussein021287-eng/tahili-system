import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PATIENT_TABS,
  canViewPatientTab,
  isKnownPatientTab,
  patientDataAuthorizationTab,
} from "@/lib/patient-tab-policy";

describe("patient tab policy", () => {
  it("has the closed 21-tab contract and rejects unknown tabs", () => {
    expect(PATIENT_TABS).toHaveLength(21);
    expect(PATIENT_TABS.map(({ key }) => key)).toEqual([
      "overview", "timeline", "journey", "diag", "resident", "referrals", "sessions",
      "therapyProgram", "centerPrograms", "plan", "metrics", "care", "expenses", "rx",
      "adm", "official", "sickleave", "corr", "files", "rel", "activity",
    ]);
    expect(isKnownPatientTab("__unknown__")).toBe(false);
    expect(canViewPatientTab("__unknown__", new Set(["patients.view"]))).toBe(false);
  });

  it("uses OR semantics for every configured tab", () => {
    for (const { key: tab, permissions } of PATIENT_TABS) {
      expect(canViewPatientTab(tab, new Set())).toBe(false);
      for (const permission of permissions) expect(canViewPatientTab(tab, new Set([permission]))).toBe(true);
    }
  });

  it("keeps the internal vitals data route under the resident policy only", () => {
    expect(patientDataAuthorizationTab("vitals")).toBe("resident");
    for (const { key } of PATIENT_TABS) expect(patientDataAuthorizationTab(key)).toBe(key);
    expect(patientDataAuthorizationTab("__unknown__")).toBe("__unknown__");
  });

  it("keeps the UI tab keys aligned with the closed server policy", () => {
    const source = readFileSync("src/components/PatientTabs.tsx", "utf8");
    expect(source).toContain('import { PATIENT_TABS } from "@/lib/patient-tab-policy"');
    expect(source).toContain("const TABS = PATIENT_TABS");
  });
});
