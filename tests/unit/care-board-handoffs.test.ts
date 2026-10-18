import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const sentAt = new Date(Date.now() - 5 * 60_000);
vi.mock("@/lib/access", () => ({ requirePerm: vi.fn(), currentPerms: async () => new Set(["journey.view"]) }));
vi.mock("@/lib/branch-context", () => ({ currentUserBranch: async () => null, effectiveBranchId: () => null }));
vi.mock("@/components/hub/HubTabs", () => ({ HubTabs: () => null }));
vi.mock("@/lib/db", () => ({ prisma: {
  branch: { findMany: async () => [] },
  patientHandoff: { findMany: async () => [{
    id: "h1", status: "ACCEPTED", toRole: "SECRETARY", sentAt, acceptedAt: sentAt, fromCenterId: null, toCenterId: 2,
    patient: { id: "p1", fullName: "علي حسين", fileNumber: 1 },
    toUser: null, acceptedBy: { fullName: "علي سكرتارية" }, toCenter: { name: "مركز التأهيل النفسي" },
  }] },
} }));

import CareBoard from "@/app/(app)/care-board/page";

describe("care board", () => {
  it("places the patient in the column of whoever holds the open handoff", async () => {
    const html = renderToStaticMarkup(await CareBoard({ searchParams: Promise.resolve({}) }));
    const secretaryColumn = html.slice(html.indexOf(">السكرتارية<"), html.indexOf(">الطبيب المقيم<"));
    expect(secretaryColumn).toContain("علي حسين");
    expect(secretaryColumn).toContain("علي سكرتارية");
    expect(html.slice(html.indexOf(">الاستقبال<"), html.indexOf(">إدخال البيانات<"))).not.toContain("علي حسين");
  });
});
