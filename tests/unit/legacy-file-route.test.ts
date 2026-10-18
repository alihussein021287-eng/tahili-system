import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), permission: vi.fn(), read: vi.fn(), scan: vi.fn(), patientAccess: vi.fn(), referralScope: vi.fn(),
  attachment: vi.fn(), photo: vi.fn(), official: vi.fn(), referral: vi.fn(), expense: vi.fn(), purchase: vi.fn(),
}));
vi.mock("@/lib/access", () => ({ getApiSession: mocks.session }));
vi.mock("@/lib/api-permissions", () => ({ checkApiPermission: mocks.permission, apiPermissionResponse: () => new Response("denied", { status: 403 }) }));
vi.mock("@/lib/storage", () => ({ readStoredFile: mocks.read }));
vi.mock("@/lib/collaboration-scan", () => ({ scanBufferWithClamAv: mocks.scan }));
vi.mock("@/lib/legacy-patient-file-access", () => ({ canReadLegacyPatientFile: mocks.patientAccess }));
vi.mock("@/lib/patient-access", () => ({ canAccessPatientRecord: vi.fn(async () => false) }));
vi.mock("@/lib/referral-access", () => ({ referralAccessScope: mocks.referralScope }));
vi.mock("@/lib/db", () => ({ prisma: {
  attachment: { findFirst: mocks.attachment }, patient: { findFirst: mocks.photo },
  officialDocument: { findFirst: mocks.official }, referralRequest: { findFirst: mocks.referral },
  woundedExpenseAttachment: { findFirst: mocks.expense }, purchaseOrderAttachment: { findFirst: mocks.purchase },
} }));

import { GET } from "@/app/api/files/[...key]/route";

const request = () => GET({} as any, { params: Promise.resolve({ key: ["synthetic.pdf"] }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ session: { user: { id: "viewer", role: "DOCTOR" } }, response: null });
  mocks.permission.mockResolvedValue({ allowed: true, permissions: new Set(["patients.view", "referrals.view"]) });
  for (const find of [mocks.attachment, mocks.photo, mocks.official, mocks.referral, mocks.expense, mocks.purchase]) find.mockResolvedValue(null);
  mocks.read.mockResolvedValue(Buffer.from("%PDF-1.7 synthetic"));
  mocks.scan.mockResolvedValue({ status: "SAFE" });
  mocks.patientAccess.mockResolvedValue(true);
  mocks.referralScope.mockResolvedValue({ where: { createdById: "viewer" } });
});

describe("direct legacy file route", () => {
  it("denies unauthenticated access before owner lookup", async () => {
    mocks.session.mockResolvedValue({ session: null, response: new Response("unauthorized", { status: 401 }) });
    expect((await request()).status).toBe(401);
    expect(mocks.attachment).not.toHaveBeenCalled();
  });

  it("does not serve an unreferenced storage key to a permitted account", async () => {
    expect((await request()).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("denies a cross-branch patient attachment before reading its bytes", async () => {
    mocks.attachment.mockResolvedValue({ patientId: "patient-a" });
    mocks.patientAccess.mockResolvedValue(false);
    expect((await request()).status).toBe(404);
    expect(mocks.patientAccess).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "viewer" }), "patient-a");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("serves authorized bytes only after a clean scan", async () => {
    mocks.attachment.mockResolvedValue({ patientId: "patient-a" });
    const response = await request();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("%PDF-1.7 synthetic"));
    expect(mocks.scan).toHaveBeenCalledWith(Buffer.from("%PDF-1.7 synthetic"));
  });

  it("preserves scoped photo, official-document and expense downloads", async () => {
    mocks.permission.mockResolvedValue({ allowed: true, permissions: new Set(["patients.view", "officialdocs.view", "expenses.view"]) });
    mocks.photo.mockResolvedValue({ id: "patient-a" });
    expect((await request()).status).toBe(200);
    mocks.photo.mockResolvedValue(null);
    mocks.official.mockResolvedValue({ patientId: "patient-a", createdById: "someone-else" });
    expect((await request()).status).toBe(200);
    mocks.official.mockResolvedValue(null);
    mocks.expense.mockResolvedValue({ expense: { patientId: "patient-a" } });
    expect((await request()).status).toBe(200);
    expect(mocks.patientAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), "patient-a");
  });

  it("uses the existing purchase permission for a purchase-order attachment", async () => {
    mocks.permission.mockResolvedValue({ allowed: true, permissions: new Set(["pharmacy.purchase.view"]) });
    mocks.purchase.mockResolvedValue({ id: "purchase-file" });
    expect((await request()).status).toBe(200);
  });

  it.each(["REJECTED", "FAILED", "PENDING_SCAN"])("keeps historical %s bytes unavailable", async (status) => {
    mocks.attachment.mockResolvedValue({ patientId: "patient-a" });
    mocks.scan.mockResolvedValue({ status });
    expect((await request()).status).toBe(404);
  });

  it("does not return bytes when a historical-file scan throws", async () => {
    mocks.attachment.mockResolvedValue({ patientId: "patient-a" });
    mocks.scan.mockRejectedValue(new Error("scanner down"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("%PDF");
  });

  it("enforces referral-specific scope on direct result-file downloads", async () => {
    mocks.referral.mockImplementation(async ({ where }: any) => where.resultAttachmentUrl ? { id: "ref-a" } : null);
    expect((await request()).status).toBe(404);
    expect(mocks.referral).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ref-a", AND: [{ createdById: "viewer" }] } }));
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("preserves an explicitly scoped referral result download", async () => {
    mocks.referral.mockImplementation(async ({ where }: any) => where.resultAttachmentUrl ? { id: "ref-a" } : { id: "ref-a" });
    expect((await request()).status).toBe(200);
    expect(mocks.referralScope).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "viewer" }));
    expect(mocks.referral).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ref-a", AND: [{ createdById: "viewer" }] } }));
  });
});
