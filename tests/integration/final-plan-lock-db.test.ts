import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
const auth = vi.hoisted(() => ({ id: "", role: "HEAD_THERAPIST", auditFailure: false }));
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
const actions = await import("@/app/(app)/therapy/actions");
const { setTreatmentPlanStatus } = await import("@/app/(app)/patients/actions");
let head = "", admin = "", doctor = "", patient = "", plan = "", program = "", center = 0, membership = "";
const evidence: unknown[] = [];
function fd(decision = "END") {
  const data = new FormData(); Object.entries({ finalDecision: decision, finalRecoveryPercent: "60", extensionSessions: "1", beforeCondition: "Synthetic before", afterCondition: "Synthetic after", achievedGoals: "Synthetic", finalRecommendation: "Synthetic", specialistDoctorId: doctor, treatmentDays: "10", reviewInterval: "2", reviewMode: "DAYS", recoveryPercent: "60", currentCondition: "Synthetic", achievedProgress: "Synthetic" }).forEach(([k,v]) => data.set(k,v)); return data;
}
async function snapshot() { return { plans: await prisma.treatmentPlan.findMany({ orderBy: { id: "asc" } }), programs: await prisma.therapySession.findMany({ orderBy: { id: "asc" } }), appointments: await prisma.appointment.findMany({ orderBy: { id: "asc" } }), evaluations: await prisma.therapyPeriodicEvaluation.findMany(), audits: await prisma.auditLog.findMany({ orderBy: { id: "asc" } }), handoffs: await prisma.patientHandoff.findMany(), notices: await prisma.notification.findMany(), queues: await prisma.queueEntry.findMany() }; }
async function denied(label: string, action: () => Promise<unknown>) { const before = await snapshot(); let rejected = false; try { await action(); } catch { rejected = true; } const after = await snapshot(); evidence.push({ label, rejected, before, after }); expect(rejected).toBe(true); expect(after).toEqual(before); }
beforeAll(async () => {
  center = (await prisma.center.create({ data: { name: "Synthetic m34 therapy" } })).id;
  const branch = (await prisma.branch.create({ data: { name: "Synthetic m34 therapy branch" } })).id;
  for (const role of ["HEAD_THERAPIST", "ADMIN", "DOCTOR"] as const) { const row = await prisma.user.create({ data: { username: `m34-plan-${role}`, fullName: `Synthetic ${role}`, role, branchId: branch, passwordHash: "!synthetic", needsActivation: false } }); if (role === "HEAD_THERAPIST") head = row.id; else if (role === "ADMIN") admin = row.id; else doctor = row.id; }
  membership = (await prisma.centerMembership.create({ data: { centerId: center, userId: head, role: "HEAD_THERAPIST", startDate: new Date("2020-01-01") } })).id;
  patient = (await prisma.patient.create({ data: { fullName: "Synthetic plan patient", branchId: branch } })).id;
});
beforeEach(async () => {
  auth.id = head; auth.role = "HEAD_THERAPIST"; auth.auditFailure = false;
  await prisma.userPermission.deleteMany();
  await prisma.centerMembership.update({ where: { id: membership }, data: { status: "ACTIVE", endDate: null } });
  patient = (await prisma.patient.create({ data: { fullName: "Synthetic per-case patient", branchId: (await prisma.user.findUniqueOrThrow({where:{id:head}})).branchId } })).id;
  const therapist = await prisma.user.create({ data: { username: `m34-therapist-${patient}`, fullName: "Synthetic therapist", role: "THERAPIST", passwordHash: "!synthetic", needsActivation: false } });
  const hall = await prisma.therapyHall.create({ data: { name: `Synthetic hall ${patient}` } });
  plan = (await prisma.treatmentPlan.create({ data: { title: "Synthetic plan", patientId: patient, therapistId: therapist.id, hallId: hall.id, centerId: center, status: "COMPLETED", plannedSessions: 1, closedAt: new Date(), startDate: new Date("2030-01-01"), expectedEndDate: new Date("2030-01-10"), weekdays: "0,1,2,3,4,5,6" } })).id;
  program = (await prisma.therapySession.create({ data: { patientId: patient, therapyType: "PHYSICAL", treatmentPlanId: plan, centerId: center, totalSessions: 1, actualSessions: 1 } })).id;
});
afterAll(async () => { if (process.env.M34_STATE_FILE) writeFileSync(process.env.M34_STATE_FILE, JSON.stringify(evidence, null, 2)); await prisma.$disconnect(); });
async function seal() { await prisma.treatmentPlan.update({ where: { id: plan }, data: { finalDecision: "END", evaluatedAt: new Date(), evaluatedById: head } }); }
describe("final plan locking / direct real actions", () => {
  it("rejects original re-finalization END to EXTEND without override", async () => { await seal(); await denied("original-END-to-EXTEND", () => actions.finalizeTherapyPlan(plan, fd("EXTEND"))); });
  it("permits initial final evaluation after session completion sets closedAt", async () => { await actions.finalizeTherapyPlan(plan, fd()); expect(await prisma.treatmentPlan.findUnique({ where: { id: plan } })).toMatchObject({ status: "COMPLETED", finalDecision: "END", evaluatedById: head }); });
  it("rejects duplicate END without duplicate notification", async () => { await actions.finalizeTherapyPlan(plan, fd()); await denied("duplicate-END", () => actions.finalizeTherapyPlan(plan, fd())); });
  it("rejects edits of a finalized plan", async () => { await seal(); await denied("update-finalized", () => actions.updatePhysicalTherapyPlan(plan, fd())); });
  it("rejects periodic mutation of an ended plan", async () => { await seal(); await denied("periodic-ended", () => actions.addPeriodicTherapyEvaluation(plan, fd())); });
  it("preserves authorized pre-finalization edits", async () => { await prisma.treatmentPlan.update({ where: { id: plan }, data: { status: "ACTIVE", closedAt: null } }); await actions.updatePhysicalTherapyPlan(plan, fd()); expect(await prisma.treatmentPlan.findUnique({ where: { id: plan } })).toMatchObject({ specialistDoctorId: doctor, treatmentDays: 10 }); });
  it("preserves first extension and later finalization when extension sessions complete", async () => {
    await actions.finalizeTherapyPlan(plan, fd("EXTEND"));
    expect(await prisma.appointment.count({ where: { sessionId: program } })).toBe(1);
    await denied("active-extension", () => actions.finalizeTherapyPlan(plan, fd()));
    // Simulates completed extension sessions, not a policy change to allow early finalization.
    await prisma.therapySession.update({ where: { id: program }, data: { actualSessions: 2 } });
    await prisma.treatmentPlan.update({ where: { id: plan }, data: { status: "COMPLETED", closedAt: new Date() } });
    await actions.finalizeTherapyPlan(plan, fd());
    expect(await prisma.treatmentPlan.findUnique({ where: { id: plan } })).toMatchObject({ finalDecision: "END" });
  });
  it("preserves existing explicit ADMIN override", async () => { await seal(); auth.id = admin; auth.role = "ADMIN"; await actions.finalizeTherapyPlan(plan, fd("EXTEND")); expect(await prisma.treatmentPlan.findUnique({ where: { id: plan } })).toMatchObject({ status: "ACTIVE", finalDecision: "EXTEND" }); });
  it("denies effective finalization permission revocation", async () => { await prisma.userPermission.create({ data: { userId: head, permKey: "therapy.plan.finalize", allowed: false } }); await denied("effective-deny", () => actions.finalizeTherapyPlan(plan, fd())); });
  it("denies expired center eligibility", async () => { await prisma.centerMembership.update({ where: { id: membership }, data: { endDate: new Date("2020-02-01") } }); await denied("expired-membership", () => actions.finalizeTherapyPlan(plan, fd())); });
  it("rejects invalid final decision without writes", () => denied("invalid-decision", () => actions.finalizeTherapyPlan(plan, fd("INVALID"))));
  it("rolls back plan, handoff and notice after real audit FK error", async () => { await prisma.treatmentPlan.update({ where: { id: plan }, data: { specialistDoctorId: doctor } }); auth.auditFailure = true; await denied("audit-FK", () => actions.finalizeTherapyPlan(plan, fd())); });
  it("permits only one concurrent finalization", async () => { const outcomes = await Promise.allSettled([actions.finalizeTherapyPlan(plan, fd()), actions.finalizeTherapyPlan(plan, fd())]); expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1); expect(await prisma.auditLog.count({ where: { recordId: plan } })).toBe(1); });
  it("rejects direct generic status reopening of finalized plan", async () => { await seal(); auth.id = doctor; auth.role = "DOCTOR"; await denied("generic-reopen", () => setTreatmentPlanStatus(patient, plan, "ACTIVE")); });
});
