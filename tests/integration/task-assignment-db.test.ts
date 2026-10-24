import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
const auth = vi.hoisted(() => ({ id: "", role: "LAB", auditFailure: false }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.id ? { user: { id: auth.id, role: auth.role, authVersion: 0 } } : null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  return { prisma: db.$extends({ query: { auditLog: { create({ args, query }) {
    if (auth.auditFailure) args.data.userId = "missing-synthetic-audit-actor";
    return query(args);
  } } } }) };
});
const { prisma } = await import("@/lib/db");
const actions = await import("@/app/(app)/tasks/actions");
let lab = "", resident = "", patient = "", foreignPatient = "", task = "";
const evidence: unknown[] = [];
async function snapshot() {
  return { tasks: await prisma.task.findMany({ orderBy: { id: "asc" } }), audits: await prisma.auditLog.findMany({ orderBy: { id: "asc" } }),
    queues: await prisma.queueEntry.findMany(), handoffs: await prisma.patientHandoff.findMany(), notices: await prisma.notification.findMany() };
}
async function denied(label: string, action: () => Promise<unknown>) {
  const before = await snapshot();
  let error = ""; try { await action(); } catch (e) { error = e instanceof Error ? e.message : "rejected"; }
  const after = await snapshot(); evidence.push({ label, rejected: !!error, before, after });
  expect(error).not.toBe(""); expect(after).toEqual(before);
}
beforeAll(async () => {
  const branch = await prisma.branch.create({ data: { name: "m34 task branch" } });
  const foreign = await prisma.branch.create({ data: { name: "m34 task foreign" } });
  lab = (await prisma.user.create({ data: { username: "m34-lab", fullName: "Synthetic LAB", passwordHash: "!synthetic", role: "LAB", branchId: branch.id, needsActivation: false } })).id;
  resident = (await prisma.user.create({ data: { username: "m34-resident", fullName: "Synthetic resident", passwordHash: "!synthetic", role: "RESIDENT", branchId: branch.id, needsActivation: false } })).id;
  patient = (await prisma.patient.create({ data: { fullName: "Synthetic task patient", branchId: branch.id } })).id;
  foreignPatient = (await prisma.patient.create({ data: { fullName: "Synthetic foreign patient", branchId: foreign.id } })).id;
});
beforeEach(async () => {
  auth.id = lab; auth.role = "LAB"; auth.auditFailure = false;
  await prisma.userPermission.deleteMany();
  await prisma.user.update({ where: { id: lab }, data: { isActive: true } });
  task = (await prisma.task.create({ data: { title: "Synthetic task", assignedToId: lab, patientId: patient } })).id;
});
afterAll(async () => { if (process.env.M34_STATE_FILE) writeFileSync(process.env.M34_STATE_FILE, JSON.stringify(evidence, null, 2)); await prisma.$disconnect(); });
describe("task assignment direct actions with real authorization and PostgreSQL", () => {
  for (const action of ["startTask", "completeTask", "reopenTask"] as const) it(`denies non-assignee ${action} without side effects`, async () => {
    if (action === "reopenTask") await prisma.task.update({ where: { id: task }, data: { status: "DONE" } });
    auth.id = resident; auth.role = "RESIDENT";
    await denied(action, () => actions[action](task));
  });
  it("allows named assignee start, completion and reopening with attributable audit", async () => {
    await actions.startTask(task); await actions.completeTask(task);
    expect(await prisma.task.findUnique({ where: { id: task } })).toMatchObject({ status: "DONE", completedById: lab });
    await actions.reopenTask(task);
    expect(await prisma.task.findUnique({ where: { id: task } })).toMatchObject({ status: "OPEN", completedById: null, completedAt: null });
    expect(await prisma.auditLog.count({ where: { recordId: task, userId: lab } })).toBe(3);
  });
  it("preserves explicit role-wide assignment", async () => {
    await prisma.task.update({ where: { id: task }, data: { assignedToId: null, assignedRole: "RESIDENT" } });
    auth.id = resident; auth.role = "RESIDENT";
    await actions.completeTask(task);
    expect(await prisma.task.findUnique({ where: { id: task } })).toMatchObject({ completedById: resident });
  });
  it("does not invent a claim for an unassigned task", async () => {
    await prisma.task.update({ where: { id: task }, data: { assignedToId: null } });
    await denied("unassigned", () => actions.completeTask(task));
  });
  it("denies assigned user outside actual patient scope", async () => {
    await prisma.task.update({ where: { id: task }, data: { patientId: foreignPatient } });
    await denied("foreign-patient", () => actions.completeTask(task));
  });
  it("honors current effective permission denial", async () => {
    await prisma.userPermission.create({ data: { userId: lab, permKey: "tasks.complete", allowed: false } });
    await denied("permission-denied", () => actions.completeTask(task));
  });
  it("denies inactive account", async () => { await prisma.user.update({ where: { id: lab }, data: { isActive: false } }); await denied("inactive", () => actions.completeTask(task)); });
  it("rejects duplicate completion atomically", async () => { await actions.completeTask(task); await denied("duplicate", () => actions.completeTask(task)); });
  it("rejects stale reassignment", async () => { await prisma.task.update({ where: { id: task }, data: { assignedToId: resident } }); await denied("reassigned", () => actions.completeTask(task)); });
  it("rolls back task on real audit FK failure", async () => { auth.auditFailure = true; await denied("audit-FK", () => actions.completeTask(task)); });
  it("allows only one of two simultaneous completions", async () => {
    const result = await Promise.allSettled([actions.completeTask(task), actions.completeTask(task)]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { recordId: task } })).toBe(1);
  });
});
