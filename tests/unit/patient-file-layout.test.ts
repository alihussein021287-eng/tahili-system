import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const params = { current: "tab=diag" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/patients/p1",
  useSearchParams: () => new URLSearchParams(params.current),
}));
vi.mock("@/app/(app)/patients/actions", () => ({ addDiagnosis: vi.fn(), addReport: vi.fn(), setReportStatus: vi.fn(), addSession: vi.fn(), addPrescription: vi.fn(), addAdmission: vi.fn(), dischargeAdmission: vi.fn(), updateAdmissionDuration: vi.fn(), addCorrespondence: vi.fn(), addRelative: vi.fn(), addWound: vi.fn(), addAttachment: vi.fn(), deleteDiagnosis: vi.fn(), deleteReport: vi.fn(), deleteSession: vi.fn(), deletePrescription: vi.fn(), deleteCorrespondence: vi.fn(), deleteRelative: vi.fn(), deleteAdmission: vi.fn(), deleteWound: vi.fn(), deleteAttachment: vi.fn(), addProgressMetric: vi.fn(), deleteProgressMetric: vi.fn(), addVitalSign: vi.fn(), deleteVitalSign: vi.fn(), addResidentReview: vi.fn(), deleteResidentReview: vi.fn(), scheduleSessions: vi.fn(), addTreatmentPlan: vi.fn(), setTreatmentPlanStatus: vi.fn(), deleteTreatmentPlan: vi.fn(), addTherapySessionLog: vi.fn(), addCareRecord: vi.fn(), deleteCareRecord: vi.fn(), addOfficialDoc: vi.fn(), deleteOfficialDoc: vi.fn(), updateDiagnosis: vi.fn(), updateSessionRecord: vi.fn(), updateCorrespondence: vi.fn(), updateOfficialDocText: vi.fn(), addSickLeave: vi.fn(), deleteSickLeave: vi.fn(), approveSickLeave: vi.fn(), unapproveSickLeave: vi.fn(), approveSickLeaveCommittee: vi.fn(), unapproveSickLeaveCommittee: vi.fn(), setNextCheckup: vi.fn(), getPatientTabData: vi.fn() }));
vi.mock("@/components/Combobox", () => ({ Combobox: () => null }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { PatientTabs } from "@/components/PatientTabs";

const patient = { id: "p1", fullName: "علي", fileNumber: 1, diagnoses: [{ id: "d1", type: "SPECIALIST", text: "كسر", doctor: "د. سامر", date: new Date("2026-10-01") }], medicalReports: [], prescriptions: [], visits: [], appointments: [], admissions: [] };

function render(tab: string, perms: string[]) {
  params.current = `tab=${tab}`;
  return renderToStaticMarkup(createElement(PatientTabs, { patient, editable: true, perms, role: "DOCTOR", currentUserName: "د. أحمد" } as any));
}

describe("patient file layout", () => {
  it("shows the specialist records first, with no duplicate action box and the add form folded", () => {
    const html = render("diag", ["patients.view", "clinical.view", "clinical.diagnosis", "clinical.report"]);
    expect(html).not.toContain("إجراءات الطبيب الاختصاص");
    expect(html).not.toContain("إحالة إلى مركز مختص");
    expect(html).toContain("+ تشخيص");
    expect(html).toContain("+ تقرير طبي");
    expect(html.indexOf("+ تشخيص")).toBeLessThan(html.indexOf("كسر"));
    expect(html).toContain('value="د. أحمد"');
  });

  it("lists every menu group open, without expand buttons", () => {
    const html = render("overview", ["patients.view", "clinical.view"]);
    for (const group of ["الملف", "الطبي"]) expect(html).toContain(group);
    expect(html).not.toContain('aria-expanded="false"');
  });
});
