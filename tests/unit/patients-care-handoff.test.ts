import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The patient list, visits and queue each live on one page (the hub's old tabs redirect there),
// and each of those pages offers "حوّل إلى" to whoever may send a handoff.
const mocks = vi.hoisted(() => ({ perms: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); }) }));

vi.mock("@/lib/access", () => ({ requireSession: vi.fn(), requirePerm: vi.fn(), currentPerms: mocks.perms, getSession: async () => ({ user: { id: "u1", role: "RECEPTION" } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: mocks.redirect }));
vi.mock("@/lib/branch-context", () => ({ currentUserBranch: async () => null, effectiveBranchId: () => null }));
vi.mock("@/lib/center-halls", () => ({ activeCenterHallOptions: async () => [], activeCenterHallNames: () => [] }));
vi.mock("@/components/Combobox", () => ({ Combobox: () => null }));
vi.mock("@/components/CenterHallSelect", () => ({ CenterHallSelect: () => null }));
vi.mock("@/lib/patient-access", () => ({ patientScopeWhere: vi.fn(async () => ({})), visitScopeWhere: vi.fn(async () => ({})), exactIdentifierLookup: vi.fn(async () => []) }));
const patient = { id: "patient-1", fullName: "علي حسين", fileNumber: 123, status: "ACTIVE", branch: null, careStages: [] };
vi.mock("@/lib/db", () => {
  const empty = { findMany: async () => [], count: async () => 0 };
  return { prisma: {
    branch: empty, center: empty, governorate: empty, district: empty, injuryType: empty, careStage: empty, referralRequest: empty, appointment: empty, relative: empty,
    patient: empty,
    visit: { count: async () => 0, findMany: async () => [{ id: "visit-1", patientId: patient.id, patient, visitDate: new Date("2026-10-09T08:00:00Z"), notes: null }] },
    queueEntry: { count: async () => 0, findMany: async () => [{ id: "queue-1", patientId: patient.id, patient, status: "WAITING", createdAt: new Date("2026-10-09T08:00:00Z"), hall: "قاعة 1", note: null }] },
  } };
});
vi.mock("@/components/handoffs/HandoffDialog", () => ({
  HandoffDialog: ({ patientId }: { patientId: string }) => createElement("button", { type: "button", "data-patient-id": patientId }, "حوّل إلى"),
}));

import PatientsCarePage from "@/app/(app)/patients-care/page";
import VisitsPage from "@/app/(app)/visits/page";
import Queue from "@/app/(app)/queue/page";

beforeEach(() => vi.clearAllMocks());

describe("one place per feature", () => {
  it.each([
    [{ tab: "patients", q: "علي", patientStatus: "ACTIVE" }, "/patients?q=%D8%B9%D9%84%D9%8A&status=ACTIVE"],
    [{ tab: "visits", visitDate: "2026-10-09" }, "/visits?date=2026-10-09"],
    [{ tab: "queue" }, "/queue"],
    [{ tab: "journey" }, "/care-board"],
    [{ tab: "referrals", referralStatus: "SENT" }, "/referrals?status=SENT"],
    [{ tab: "appointments", appointmentDate: "2026-10-10" }, "/appointments?date=2026-10-10"],
    [{ tab: "new" }, "/patients/new"],
  ])("sends the old hub tab %j to its page", async (sp, url) => {
    mocks.perms.mockResolvedValue(new Set(["patients.view"]));
    await expect(PatientsCarePage({ searchParams: Promise.resolve(sp as Record<string, string>) })).rejects.toThrow(`REDIRECT ${url}`);
  });
});

describe("handoff controls on the visits and queue pages", () => {
  it.each([["visits", VisitsPage, "visits.view"], ["queue", Queue, "queue.view"]] as const)("shows حوّل إلى on %s with handoff.send", async (_name, Page, perm) => {
    mocks.perms.mockResolvedValue(new Set([perm, "handoff.send"]));
    const html = renderToStaticMarkup(await (Page as any)({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('data-patient-id="patient-1"');
  });

  it.each([["visits", VisitsPage, "visits.view"], ["queue", Queue, "queue.view"]] as const)("hides it on %s without handoff.send", async (_name, Page, perm) => {
    mocks.perms.mockResolvedValue(new Set([perm]));
    const html = renderToStaticMarkup(await (Page as any)({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("علي حسين");
    expect(html).not.toContain("data-patient-id");
  });
});
