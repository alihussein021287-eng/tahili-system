import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  perms: vi.fn(), inbox: vi.fn(), sent: vi.fn(), patients: vi.fn(), users: vi.fn(), centers: vi.fn(), previous: vi.fn(), item: vi.fn(), sentItems: vi.fn(),
}));
vi.mock("@/lib/access", () => ({
  requirePerm: vi.fn(), requireSession: async () => ({ user: { id: "staff-1", role: "DOCTOR", name: "مصطفى جاسم" } }),
  currentPerms: mocks.perms,
}));
vi.mock("@/lib/branch-context", () => ({ currentUserBranch: async () => null }));
vi.mock("@/lib/center-access", () => ({ accessibleCenterIds: async () => null }));
vi.mock("@/lib/handoff-service", () => ({ listInbox: mocks.inbox, listSentToday: mocks.sent }));
vi.mock("@/lib/db", () => ({ prisma: {
  patient: { findMany: mocks.patients }, user: { findMany: mocks.users }, center: { findMany: mocks.centers }, patientHandoff: { findMany: mocks.previous },
} }));
vi.mock("@/components/handoffs/HandoffInboxItem", () => ({ HandoffInboxItem: (props: unknown) => { mocks.item(props); return "HANDOFF_ITEM"; } }));
vi.mock("@/components/handoffs/HandoffSentToday", () => ({ HandoffSentToday: (props: unknown) => { mocks.sentItems(props); return "SENT_TODAY"; } }));
vi.mock("@/components/handoffs/AutoRefresh", () => ({ AutoRefresh: () => null }));

import MyWorkPage from "@/app/(app)/my-work/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.centers.mockResolvedValue([]);
  mocks.previous.mockResolvedValue([]);
  mocks.patients.mockResolvedValue([{ id: "patient-1", fullName: "علي حسين", fileNumber: 123 }]);
  mocks.users.mockResolvedValue([{ id: "sender-1", fullName: "زينب كاظم" }]);
  mocks.sent.mockResolvedValue([]);
  mocks.inbox.mockResolvedValue({ items: [{ id: "handoff-1", patientId: "patient-1", fromUserId: "sender-1", fromRole: "RECEPTION", toRole: "DOCTOR", fromCenterId: null, toCenterId: 2, status: "SENT", sentAt: new Date("2026-10-09T09:00:00Z") }], total: 1, page: 1, pageSize: 20 });
});

describe("my work handoff visibility", () => {
  it("does not load or render handoffs without handoff.receive", async () => {
    mocks.perms.mockResolvedValue(new Set(["dashboard.view"]));
    const html = renderToStaticMarkup(await MyWorkPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.inbox).not.toHaveBeenCalled();
    expect(mocks.patients).not.toHaveBeenCalled();
    expect(html).not.toContain("التحويلات الواردة");
    expect(html).not.toContain("HANDOFF_ITEM");
  });

  it("loads the authorized inbox above the work filters", async () => {
    mocks.perms.mockResolvedValue(new Set(["dashboard.view", "handoff.receive"]));
    const html = renderToStaticMarkup(await MyWorkPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.inbox).toHaveBeenCalledWith(expect.objectContaining({ userId: "staff-1", permissions: expect.any(Set) }), { centerId: undefined, page: 1, pageSize: 20 });
    expect(html.indexOf("HANDOFF_ITEM")).toBeGreaterThan(-1);
    expect(html.indexOf("HANDOFF_ITEM")).toBeLessThan(html.indexOf("name=\"type\""));
  });

  it("passes the target center and verified previous return to the card", async () => {
    mocks.perms.mockResolvedValue(new Set(["dashboard.view", "handoff.receive"]));
    mocks.inbox.mockResolvedValue({ items: [{ id: "handoff-1", patientId: "patient-1", fromUserId: "sender-1", fromRole: "RECEPTION", toRole: "DOCTOR", fromCenterId: null, toCenterId: 2, status: "SENT", sentAt: new Date("2026-10-09T09:00:00Z"), previousHandoffId: "prior-1", note: "ملاحظة المتابعة" }], total: 1, page: 1, pageSize: 20 });
    mocks.centers.mockResolvedValue([{ id: 2, name: "مركز بغداد" }]);
    mocks.previous.mockResolvedValue([{ id: "prior-1", patientId: "patient-1", status: "RETURNED", returnReason: "بيانات ناقصة" }]);
    renderToStaticMarkup(await MyWorkPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.item).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({
      toCenterName: "مركز بغداد", isReturn: true, previousReturnReason: "بيانات ناقصة", note: "ملاحظة المتابعة",
    }), canCancel: false }));
  });

  it("passes the center and inbox page to the service and preserves filters in next link", async () => {
    mocks.perms.mockResolvedValue(new Set(["dashboard.view", "handoff.receive"]));
    mocks.inbox.mockResolvedValue({ items: [], total: 41, page: 2, pageSize: 20 });
    const html = renderToStaticMarkup(await MyWorkPage({ searchParams: Promise.resolve({ center: "2", type: "handoff", inboxPage: "2" }) }));
    expect(mocks.inbox).toHaveBeenCalledWith(expect.anything(), { centerId: 2, page: 2, pageSize: 20 });
    expect(html).toContain("inboxPage=3");
    expect(html).toContain("center=2");
    expect(html).not.toContain("لا توجد حالات تنتظر دورك");
    expect(html).not.toContain("name=\"priority\"");
    expect(html).not.toContain("name=\"status\"");
    expect(html).not.toContain("name=\"date\"");
  });

  it("loads sent-today only with send permission and maps its status", async () => {
    mocks.perms.mockResolvedValue(new Set(["dashboard.view", "handoff.send"]));
    mocks.sent.mockResolvedValue([{ id: "sent-1", patientId: "patient-1", status: "ACCEPTED", acceptorName: "نور الهدى عباس" }]);
    const html = renderToStaticMarkup(await MyWorkPage({ searchParams: Promise.resolve({ type: "handoff" }) }));
    expect(mocks.inbox).not.toHaveBeenCalled();
    expect(mocks.sent).toHaveBeenCalledWith(expect.objectContaining({ userId: "staff-1" }));
    expect(mocks.sentItems).toHaveBeenCalledWith({ items: [{ id: "sent-1", patientName: "علي حسين", status: "ACCEPTED", acceptorName: "نور الهدى عباس" }] });
    expect(html).toContain("SENT_TODAY");
  });
});
