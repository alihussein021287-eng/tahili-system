import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
const auth = vi.hoisted(() => ({ id: "", role: "MANAGER", auditFailure: false }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: auth.id, role: auth.role, authVersion: 0 } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient().$extends({ query: { auditLog: { create({ args, query }) {
    if (auth.auditFailure) args.data.userId = "missing-synthetic-audit-actor";
    return query(args);
  } } } }) };
});
const { prisma } = await import("@/lib/db");
const actions = await import("@/app/(app)/approvals/actions");
let manager = "", doctor = "", viewer = "", request = "";
const evidence: unknown[] = [];
async function snapshot() { return { requests: await prisma.approvalRequest.findMany({ orderBy: { id: "asc" } }), steps: await prisma.approvalStep.findMany({ orderBy: { id: "asc" } }), audits: await prisma.auditLog.findMany({ orderBy: { id: "asc" } }) }; }
async function denied(label: string, action: () => Promise<unknown>) {
  const before = await snapshot(); let rejected = false;
  try { await action(); } catch { rejected = true; }
  const after = await snapshot(); evidence.push({ label, rejected, before, after }); expect(rejected).toBe(true); expect(after).toEqual(before);
}
beforeAll(async () => {
  for (const role of ["MANAGER", "DOCTOR", "VIEWER"] as const) {
    const row = await prisma.user.create({ data: { username: `m34-approval-${role}`, fullName: `Synthetic ${role}`, role, passwordHash: "!synthetic", needsActivation: false } });
    if (role === "MANAGER") manager = row.id; else if (role === "DOCTOR") doctor = row.id; else viewer = row.id;
  }
});
beforeEach(async () => { auth.id = manager; auth.role = "MANAGER"; auth.auditFailure = false; // Review is an effective permission, not inferred from the DOCTOR label.
  await prisma.userPermission.deleteMany();
  await prisma.userPermission.create({ data: { userId: doctor, permKey: "approvals.review", allowed: true } }); request = (await prisma.approvalRequest.create({ data: { title: "Synthetic nonfinancial OTHER" } })).id; });
afterAll(async () => { if (process.env.M34_STATE_FILE) writeFileSync(process.env.M34_STATE_FILE, JSON.stringify(evidence, null, 2)); await prisma.$disconnect(); });
const fd = () => new FormData();
describe("approval sequence direct actions / real PostgreSQL", () => {
  it("rejects original manager execution without review", () => denied("original-skip-review", () => actions.executeApproval(request, fd())));
  it("rejects skipped final approval", () => denied("skip-final-approval", () => actions.approveApproval(request, fd())));
  it("preserves doctor review, manager approval then execution", async () => {
    auth.id = doctor; auth.role = "DOCTOR"; await actions.reviewApproval(request, fd());
    auth.id = manager; auth.role = "MANAGER"; await actions.approveApproval(request, fd()); await actions.executeApproval(request, fd());
    expect(await prisma.approvalRequest.findUnique({ where: { id: request } })).toMatchObject({ status: "EXECUTED" });
    expect(await prisma.approvalStep.findMany({ where: { requestId: request }, orderBy: { createdAt: "asc" } })).toMatchObject([{ actorId: doctor, level: "مراجعة" }, { actorId: manager, level: "موافقة نهائية" }, { actorId: manager, level: "تنفيذ" }]);
    expect(await prisma.auditLog.count({ where: { recordId: request } })).toBe(3);
  });
  it("denies unauthorized reviewer", async () => { auth.id = viewer; auth.role = "VIEWER"; await denied("viewer-review", () => actions.reviewApproval(request, fd())); });
  it("does not let reviewer act as final approver", async () => { auth.id = doctor; auth.role = "DOCTOR"; await actions.reviewApproval(request, fd()); await denied("doctor-final-approve", () => actions.approveApproval(request, fd())); });
  it("honors effective execution denial", async () => { await prisma.approvalRequest.update({ where: { id: request }, data: { status: "APPROVED" } }); await prisma.userPermission.create({ data: { userId: manager, permKey: "approvals.execute", allowed: false } }); await denied("permission", () => actions.executeApproval(request, fd())); });
  it("rejects duplicate review", async () => { auth.id = doctor; auth.role = "DOCTOR"; await actions.reviewApproval(request, fd()); await denied("duplicate-review", () => actions.reviewApproval(request, fd())); });
  it("rejects duplicate execution", async () => { await prisma.approvalRequest.update({ where: { id: request }, data: { status: "APPROVED" } }); await actions.executeApproval(request, fd()); await denied("duplicate-execution", () => actions.executeApproval(request, fd())); });
  it("rejects all transitions from rejected state", async () => { await actions.rejectApproval(request, fd()); await denied("rejected-execute", () => actions.executeApproval(request, fd())); await denied("rejected-approve", () => actions.approveApproval(request, fd())); await denied("duplicate-reject", () => actions.rejectApproval(request, fd())); });
  it("does not reject an already executed approval", async () => { await prisma.approvalRequest.update({ where: { id: request }, data: { status: "EXECUTED" } }); await denied("executed-reject", () => actions.rejectApproval(request, fd())); });
  it("rolls request and step back on real audit failure", async () => { await prisma.approvalRequest.update({ where: { id: request }, data: { status: "APPROVED" } }); auth.auditFailure = true; await denied("audit-FK", () => actions.executeApproval(request, fd())); });
  it("commits one execution under simultaneous duplicate requests", async () => {
    await prisma.approvalRequest.update({ where: { id: request }, data: { status: "APPROVED" } });
    const outcomes = await Promise.allSettled([actions.executeApproval(request, fd()), actions.executeApproval(request, fd())]);
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.approvalStep.count({ where: { requestId: request } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { recordId: request } })).toBe(1);
  });
});
