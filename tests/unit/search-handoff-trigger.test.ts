import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const mocks = vi.hoisted(() => ({
  perms: vi.fn(),
  patients: vi.fn(),
  branches: vi.fn(),
  centers: vi.fn(),
  halls: vi.fn(),
}));

vi.mock("@/lib/access", () => ({ requirePerm: vi.fn(), currentPerms: mocks.perms, getSession: vi.fn(async () => ({ user: { id: "u1", role: "RECEPTION" } })) }));
vi.mock("@/lib/patient-access", () => ({ patientScopeWhere: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({ prisma: {
  branch: { findMany: mocks.branches },
  patient: { findMany: mocks.patients },
  center: { findMany: mocks.centers },
} }));
vi.mock("@/lib/center-halls", () => ({ activeCenterHallOptions: mocks.halls }));
vi.mock("@/app/(app)/visits/actions", () => ({ receptionCheckIn: vi.fn() }));
vi.mock("@/components/handoffs/HandoffDialog", () => ({
  HandoffDialog: ({ patientId, patientName, fileNumber }: { patientId: string; patientName: string; fileNumber: string }) =>
    createElement("button", { type: "button", "data-patient-id": patientId, "data-patient-name": patientName, "data-file-number": fileNumber }, "حوّل إلى"),
}));

import SearchPage from "@/app/(app)/search/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.branches.mockResolvedValue([]);
  mocks.centers.mockResolvedValue([]);
  mocks.halls.mockResolvedValue([]);
  mocks.patients.mockResolvedValue([
    { id: "patient-1", fullName: "علي حسين", fileNumber: 123, status: "ACTIVE", archivedAt: null, branch: null, governorate: null, injuryType: null, visits: [], appointments: [] },
    { id: "patient-2", fullName: "زينب كاظم", fileNumber: 124, status: "ACTIVE", archivedAt: null, branch: null, governorate: null, injuryType: null, visits: [], appointments: [] },
  ]);
});

async function renderSearch(perms: string[]) {
  mocks.perms.mockResolvedValue(new Set(perms));
  return renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ tab: "patients", q: "علي" }) }));
}

describe("patient search handoff actions", () => {
  it("shows a handoff trigger for each patient to reception with handoff.send and keeps check-in", async () => {
    const html = await renderSearch(["patients.view", "visits.manage", "handoff.send"]);
    expect(html.match(/حوّل إلى/g)).toHaveLength(2);
    expect(html).toContain('data-patient-id="patient-1"');
    expect(html).toContain('data-patient-id="patient-2"');
    expect(html).toContain('data-file-number="123"');
    expect(html.match(/تسجيل زيارة/g)).toHaveLength(2);
  });

  it("hides handoff triggers from a viewer without handoff.send", async () => {
    const html = await renderSearch(["patients.view"]);
    expect(html).not.toContain("حوّل إلى");
    expect(html).not.toContain("تسجيل زيارة");
    expect(html).toContain("فتح الملف");
  });
});
