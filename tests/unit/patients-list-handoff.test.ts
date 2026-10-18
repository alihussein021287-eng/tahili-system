import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const mocks = vi.hoisted(() => ({
  perms: vi.fn(), patients: vi.fn(), count: vi.fn(), branches: vi.fn(),
}));

vi.mock("@/lib/access", () => ({ requirePerm: vi.fn(), currentPerms: mocks.perms, getSession: vi.fn(async () => ({ user: { id: "u1", role: "RECEPTION" } })) }));
vi.mock("@/lib/patient-access", () => ({ patientScopeWhere: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({ prisma: {
  patient: { findMany: mocks.patients, count: mocks.count },
  branch: { findMany: mocks.branches },
  district: { findMany: async () => [] },
} }));
vi.mock("@/lib/branch-context", () => ({ currentUserBranch: async () => null, effectiveBranchId: () => null }));
vi.mock("@/lib/lookups", () => ({
  getGovernorates: async () => [], getInjuryTypes: async () => [], getEmployees: async () => [],
}));
vi.mock("@/components/Combobox", () => ({ Combobox: () => null }));
vi.mock("@/components/hub/HubTabs", () => ({ HubTabs: () => null }));
vi.mock("@/components/handoffs/HandoffDialog", () => ({
  HandoffDialog: ({ patientId, patientName, fileNumber }: { patientId: string; patientName: string; fileNumber: string }) =>
    createElement("button", { type: "button", "data-patient-id": patientId, "data-file-number": fileNumber }, `${patientName} حوّل إلى`),
}));

import PatientsList from "@/app/(app)/patients/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.patients.mockResolvedValue([
    {
      id: "patient-1", fullName: "علي حسين", fileNumber: 123, phone: "07701234567",
      disabilityPct: null, status: "ACTIVE", registrationDate: new Date("2026-10-09T09:00:00Z"),
    },
    {
      id: "patient-2", fullName: "زينب كاظم", fileNumber: 124, phone: "07701234568",
      disabilityPct: null, status: "ACTIVE", registrationDate: new Date("2026-10-09T10:00:00Z"),
    },
  ]);
  mocks.count.mockResolvedValue(2);
  mocks.branches.mockResolvedValue([]);
});

async function page() {
  return renderToStaticMarkup(await PatientsList({ searchParams: Promise.resolve({}) }));
}

describe("patients list handoff trigger", () => {
  it("shows a handoff control for each patient when reception has handoff.send", async () => {
    mocks.perms.mockResolvedValue(new Set(["patients.view", "handoff.send"]));
    const html = await page();
    expect(html).toContain('data-patient-id="patient-1"');
    expect(html).toContain('data-patient-id="patient-2"');
    expect(html).toContain('data-file-number="123"');
    expect(html.match(/حوّل إلى/g)).toHaveLength(2);
  });

  it("does not show handoff controls to a viewer without handoff.send", async () => {
    mocks.perms.mockResolvedValue(new Set(["patients.view"]));
    const html = await page();
    expect(html).toContain("علي حسين");
    expect(html).not.toContain("حوّل إلى");
    expect(html).not.toContain("data-patient-id");
  });

  it("says where the patient is from the open handoff, not from the queue station", async () => {
    mocks.perms.mockResolvedValue(new Set(["patients.view", "journey.view"]));
    mocks.patients.mockResolvedValue([{
      id: "patient-1", fullName: "علي حسين", fileNumber: 1, phone: "0770", status: "ACTIVE", registrationDate: new Date("2026-10-09T09:00:00Z"),
      careStages: [{ station: "RECEPTION" }],
      handoffs: [{ toRole: "SECRETARY", status: "ACCEPTED", toUser: null, acceptedBy: { fullName: "علي سكرتارية" }, toCenter: { name: "مركز التأهيل النفسي" } }],
    }]);
    mocks.count.mockResolvedValue(1);
    const html = await page();
    expect(html).toContain("عند: علي سكرتارية – مركز التأهيل النفسي");
    expect(html).not.toContain(">الاستقبال<");
  });
});
