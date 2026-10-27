import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { writeFileSync, readFileSync } from "node:fs";
import { PrismaClient, type UserRole, type Prisma } from "@prisma/client";
createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
const auth = vi.hoisted(() => ({ id: "", role: "DOCTOR" as UserRole, failAudit: false }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: auth.id, role: auth.role, authVersion: 0 } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient().$extends({ query: { auditLog: { create({ args, query }) {
    if (auth.failAudit) args.data.userId = "m44-missing-audit-actor";
    return query(args);
  } } } }) };
});
const { prisma: db } = await import("@/lib/db");
const { createReferralRequest, transitionReferralRequest } = await import("@/lib/referral-service");
const { transitionCareStage, completeCenterStageWork, reassignCenterStage, listStagesAwaitingPhysicianReview } = await import("@/lib/care-stage-service");
const { completeStageWorkAction, confirmStage, setStageStatus } = await import("@/app/(app)/patients/actions");
const { roleDefaultSet } = await import("@/lib/perms");
const { assignStageOnAccept } = await import("@/lib/stage-assignment");
const { withSerializableRetry } = await import("@/lib/serializable-retry");
const { centerRoleForUserRole } = await import("@/lib/center-membership");
const first = new PrismaClient(), second = new PrismaClient(), observer = new PrismaClient();
const users = new Map<string, { id: string; role: UserRole }>();
let branch: number, center: number, serial = 0;
const evidence: unknown[] = [];
const actor = (key: string) => ({ userId: users.get(key)!.id, role: users.get(key)!.role, name: "M44 SYNTHETIC" });
const session = (key: string) => { auth.id = users.get(key)!.id; auth.role = users.get(key)!.role; };
const referralActor = (key: string) => ({ ...actor(key), permissions: roleDefaultSet(actor(key).role) });
function save(label: string, result: unknown) {
  evidence.push({ label, result });
  if (process.env.M44_STATE) writeFileSync(process.env.M44_STATE, JSON.stringify(evidence, null, 2));
  if (process.env.M44_CHECKPOINT) {
    const checkpoint = JSON.parse(readFileSync(process.env.M44_CHECKPOINT, "utf8"));
    checkpoint.lastCase = label; checkpoint.lastEvidence = process.env.M44_STATE;
    writeFileSync(process.env.M44_CHECKPOINT, JSON.stringify(checkpoint, null, 2));
  }
}
async function state(id: string) {
  return JSON.parse(JSON.stringify({ stage: await db.careStage.findUniqueOrThrow({ where: { id } }),
    audits: await db.auditLog.findMany({ where: { recordId: id }, orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ where: { careStageId: id }, orderBy: { id: "asc" } }) }));
}
async function denied(label: string, id: string, call: () => Promise<unknown>) {
  const before = await state(id); let error: unknown;
  try { await call(); } catch (e) { error = e; }
  const after = await state(id); save(label, { rejected: error instanceof Error, code: (error as { code?: string })?.code, before, after });
  expect(error).toBeInstanceOf(Error); expect(after).toEqual(before); return error;
}
const tx = <T>(f: (client: Prisma.TransactionClient) => Promise<T>) => db.$transaction(f, { isolationLevel: "Serializable" });
async function fixture(reviewer = "doctor", scope: "INTERNAL_CENTER" | "INTERNAL_SPECIALIST" = "INTERNAL_CENTER") {
  const patient = await db.patient.create({ data: { fullName: `M44 SYNTHETIC ${++serial}`, branchId: branch } });
  const referral = await createReferralRequest({ patientId: patient.id, type: scope === "INTERNAL_CENTER" ? "TREATMENT_CENTER" : "SPECIALIST", destinationScope: scope,
    destinationCenterId: scope === "INTERNAL_CENTER" ? center : null, assignedReviewerId: reviewer ? users.get(reviewer)!.id : null, requestedService: "M44 synthetic", clinicalReason: "synthetic only" }, referralActor("doctor"));
  await transitionReferralRequest(referral.id, "READY", {}, referralActor("doctor"));
  const accepted = await transitionReferralRequest(referral.id, "ACCEPTED", { acceptedById: users.get(scope === "INTERNAL_CENTER" ? "head" : reviewer)!.id }, referralActor(scope === "INTERNAL_CENTER" ? "head" : reviewer));
  return { patientId: patient.id, stageId: accepted.careStageId!, referralId: referral.id };
}
async function work(f: Awaited<ReturnType<typeof fixture>>, key = "head", client = db) {
  const row = await client.careStage.findUniqueOrThrow({ where: { id: f.stageId } });
  return client.$transaction(t => completeCenterStageWork(t, actor(key), { ...f, expectedUpdatedAt: row.updatedAt.toISOString() }), { isolationLevel: "Serializable" });
}
async function confirm(f: Awaited<ReturnType<typeof fixture>>, stamp?: string, key = "doctor") {
  return tx(t => transitionCareStage(t, actor(key), { ...f, to: "CONFIRMED", expectedOperationalCompletionId: stamp }));
}
beforeAll(async () => {
  branch = (await db.branch.create({ data: { name: "M44 SYNTHETIC branch" } })).id;
  center = (await db.center.create({ data: { name: "M44 SYNTHETIC center" } })).id;
  for (const [key, role] of [["doctor", "DOCTOR"], ["otherDoctor", "DOCTOR"], ["head", "HEAD_THERAPIST"], ["head2", "HEAD_THERAPIST"], ["manager", "MANAGER"], ["admin", "ADMIN"], ["resident", "RESIDENT"], ["reception", "RECEPTION"]] as const) {
    const user = await db.user.create({ data: { username: `m44-${key}`, fullName: `M44 SYNTHETIC ${key}`, role, branchId: branch, passwordHash: "!unusable-synthetic", needsActivation: false } });
    users.set(key, user); const membershipRole = centerRoleForUserRole(role);
    if (membershipRole) await db.centerMembership.create({ data: { centerId: center, userId: user.id, role: membershipRole, status: "ACTIVE" } });
  }
});
beforeEach(() => { session("doctor"); auth.failAudit = false; });
afterAll(async () => { save("FINAL", { patients: await db.patient.count(), stages: await db.careStage.count(), syntheticOnly: true }); await Promise.all([db.$disconnect(), first.$disconnect(), second.$disconnect(), observer.$disconnect()]); });

it("real INTERNAL_CENTER referral -> HEAD work remains pending the explicit designation policy", async () => {
  const f = await fixture(); const created = await db.careStage.findUniqueOrThrow({ where: { id: f.stageId } });
  expect(created).toMatchObject({ responsibleRole: "HEAD_THERAPIST", requiresPhysicianConfirmation: true, status: "WAITING" });
  session("head"); await completeStageWorkAction(f.patientId, f.stageId, created.updatedAt.toISOString());
  const pending = await db.careStage.findUniqueOrThrow({ where: { id: f.stageId } });
  expect(pending).toMatchObject({ status: "IN_PROGRESS", responsibleRole: "HEAD_THERAPIST", operationalCompletedById: users.get("head")!.id, confirmedById: null });
  expect((await listStagesAwaitingPhysicianReview(db, referralActor("doctor"))).some(x => x.id === f.stageId)).toBe(false);
  expect((await listStagesAwaitingPhysicianReview(db, referralActor("otherDoctor"))).some(x => x.id === f.stageId)).toBe(false);
  const next = await db.careStage.create({ data: { patientId: f.patientId, station: "M44 next", sequence: 99, responsibleRole: "DOCTOR" } });
  session("doctor"); await denied("pending-designation-direct", f.stageId, () => confirmStage(f.patientId, f.stageId, pending.operationalCompletionId!));
  await denied("pending-designation-repeat", f.stageId, () => confirmStage(f.patientId, f.stageId, pending.operationalCompletionId!));
  const final = await state(f.stageId); expect(final.stage).toMatchObject({ status: "IN_PROGRESS", responsibleRole: "HEAD_THERAPIST", operationalCompletedById: users.get("head")!.id, confirmedById: null });
  expect(final.stage.operationalCompletedAt).toBeTruthy(); expect(final.stage.confirmedAt).toBeNull();
  expect(final.audits.filter((a: { newValue?: { status?: string } }) => a.newValue?.status === "CONFIRMED")).toHaveLength(0);
  expect(await db.notification.count({ where: { careStageId: next.id } })).toBe(0);
  save("CENTER_REFERRAL_END_TO_END", { f, created, pending, final });
});
it.each(["head", "admin", "manager", "resident"])("%s cannot substitute for physician confirmation", async key => {
  const f = await fixture(); const stamp = await work(f); await denied(`no-physician-substitution-${key}`, f.stageId, () => confirm(f, stamp.operationalCompletionId, key));
});
it("doctor cannot confirm before work or from visibility without the named reviewer relationship", async () => {
  const f = await fixture(); await denied("work-prerequisite", f.stageId, () => confirm(f)); const stamp = await work(f);
  await denied("unrelated-physician", f.stageId, () => confirm(f, stamp.operationalCompletionId, "otherDoctor"));
});
it("missing named reviewer remains a gate without creator or ADMIN fallback", async () => {
  const f = await fixture();
  // A previously accepted legacy/revoked reviewer binding must not acquire a fallback authority.
  await db.referralRequest.update({ where: { id: f.referralId }, data: { assignedReviewerId: null } });
  const stamp = await work(f);
  await denied("no-reviewer-fallback", f.stageId, () => confirm(f, stamp.operationalCompletionId));
  expect((await listStagesAwaitingPhysicianReview(db, referralActor("doctor"))).some(x => x.id === f.stageId)).toBe(false);
});
it("new center routing preserves operational acceptance without appointing a clinical reviewer", async () => {
  const patient = await db.patient.create({ data: { fullName: `M44 SYNTHETIC routing ${++serial}`, branchId: branch } });
  const ref = await createReferralRequest({ patientId: patient.id, type: "TREATMENT_CENTER", destinationScope: "INTERNAL_CENTER", destinationCenterId: center,
    requestedService: "M44 synthetic", clinicalReason: "synthetic only" }, referralActor("doctor"));
  const before = { row: await db.referralRequest.findUnique({ where: { id: ref.id } }), stages: await db.careStage.count({ where: { patientId: patient.id } }), audits: await db.auditLog.count({ where: { recordId: ref.id } }) };
  await transitionReferralRequest(ref.id, "READY", {}, referralActor("doctor"));
  const accepted = await transitionReferralRequest(ref.id, "ACCEPTED", { acceptedById: users.get("head")!.id }, referralActor("head"));
  expect(accepted.careStageId).toBeTruthy();
  const f = { patientId: patient.id, stageId: accepted.careStageId!, referralId: ref.id };
  const stamp = await work(f);
  await denied("new-no-designation", f.stageId, () => confirm(f, stamp.operationalCompletionId));
  const invalid = await createReferralRequest({ patientId: patient.id, type: "TREATMENT_CENTER", destinationScope: "INTERNAL_CENTER", destinationCenterId: center,
    assignedReviewerId: users.get("head")!.id, requestedService: "M44 synthetic", clinicalReason: "synthetic only" }, referralActor("doctor"));
  await transitionReferralRequest(invalid.id, "READY", {}, referralActor("doctor"));
  expect(await db.careStage.count({ where: { patientId: patient.id } })).toBe(1);
  save("routing-operational-only", { before, after: await state(f.stageId), refId: ref.id, namedReviewerNotAuthority: true });
});
it("stage-linked handover invalidates completed work before another physician request", async () => {
  const f = await fixture(); const stamp = await work(f);
  // This is the real assignment helper called after the handoff's existing authentication/eligibility checks.
  // No SERVICE authority is created; the context is an owned synthetic CENTER handover.
  await tx(t => assignStageOnAccept(t, { id: "M44-synthetic-handover-context", patientId: f.patientId, careStageId: f.stageId,
    fromUserId: users.get("head")!.id, toRole: "HEAD_THERAPIST", toCenterId: center, note: "M44 synthetic handover" }, users.get("head2")!));
  expect((await state(f.stageId)).stage).toMatchObject({ assignedUserId: users.get("head2")!.id, operationalCompletionId: null, operationalCompletedAt: null });
  await denied("handover-invalidates-completion", f.stageId, () => confirm(f, stamp.operationalCompletionId));
});
it("requires current center membership and patient permission in addition to named reviewer", async () => {
  const f = await fixture(); const stamp = await work(f); const id = users.get("doctor")!.id;
  const m = await db.centerMembership.findFirstOrThrow({ where: { userId: id, centerId: center } });
  await db.centerMembership.update({ where: { id: m.id }, data: { endDate: new Date(0) } });
  await denied("expired-doctor-center", f.stageId, () => confirm(f, stamp.operationalCompletionId));
  await db.centerMembership.update({ where: { id: m.id }, data: { endDate: null } });
  for (const permKey of ["journey.confirm", "patients.view"]) {
    await db.userPermission.create({ data: { userId: id, permKey, allowed: false } });
    await denied(`permission-${permKey}`, f.stageId, () => confirm(f, stamp.operationalCompletionId));
    await db.userPermission.delete({ where: { userId_permKey: { userId: id, permKey } } });
  }
});
it("rejects cross-patient and cross-center bindings without persisted effects", async () => {
  const f = await fixture(); const other = await fixture(); const stamp = await work(f);
  await denied("wrong-patient", f.stageId, () => confirm({ ...f, patientId: other.patientId }, stamp.operationalCompletionId));
  const otherCenter = await db.center.create({ data: { name: `M44 OTHER ${serial}` } });
  await db.careStage.update({ where: { id: f.stageId }, data: { responsibleCenterId: otherCenter.id } });
  await denied("wrong-center", f.stageId, () => confirm(f, stamp.operationalCompletionId));
});
it("cannot complete another employee work or bypass direct Server Actions", async () => {
  const f = await fixture(); await db.careStage.update({ where: { id: f.stageId }, data: { assignedUserId: users.get("head2")!.id } });
  const row = await db.careStage.findUniqueOrThrow({ where: { id: f.stageId } }); session("head");
  await denied("work-assignee", f.stageId, () => completeStageWorkAction(f.patientId, f.stageId, row.updatedAt.toISOString()));
  await denied("direct-confirm", f.stageId, () => confirmStage(f.patientId, f.stageId));
  await denied("direct-status-confirm", f.stageId, () => setStageStatus(f.patientId, f.stageId, "CONFIRMED"));
});
it("rolls back real audit FK failure with no partial operational or clinical success", async () => {
  const f = await fixture(); auth.failAudit = true;
  expect((await denied("work-audit-FK", f.stageId, () => work(f))) as { code: string }).toMatchObject({ code: "P2003" });
  auth.failAudit = false; const specialist = await fixture("doctor", "INTERNAL_SPECIALIST"); auth.failAudit = true;
  expect((await denied("specialist-audit-FK", specialist.stageId, () => confirm(specialist))) as { code: string }).toMatchObject({ code: "P2003" });
});
it("preserves legitimate named specialist review and denies unassigned SERVICE", async () => {
  const f = await fixture("doctor", "INTERNAL_SPECIALIST"); await confirm(f);
  expect((await state(f.stageId)).stage).toMatchObject({ status: "CONFIRMED", operationalCompletedAt: null, confirmedById: users.get("doctor")!.id });
  const service = await db.careStage.create({ data: { patientId: f.patientId, station: "M44 SERVICE", sequence: 9, responsibilityScope: "SERVICE", responsibleRole: "DOCTOR", requiresPhysicianConfirmation: null } });
  await denied("unassigned-service", service.id, () => tx(t => transitionCareStage(t, actor("doctor"), { patientId: f.patientId, stageId: service.id, to: "CONFIRMED" })));
});
it("rejects an obsolete completion identity even when two attestations have the same timestamp", async () => {
  const f = await fixture(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 1000));
  try {
    const old = await work(f);
    await tx(t => reassignCenterStage(t, actor("manager"), { ...f, newAssigneeId: users.get("head2")!.id, expectedAssigneeId: null, reason: "M44 synthetic repeated work" }));
    const current = await work(f, "head2");
    expect(old.operationalCompletedAt).toBe(current.operationalCompletedAt);
    expect(old.operationalCompletionId).not.toBe(current.operationalCompletionId);
    await denied("obsolete-completion-same-time", f.stageId, () => confirm(f, old.operationalCompletionId));
    await denied("current-completion-still-requires-policy", f.stageId, () => confirm(f, current.operationalCompletionId));
  } finally { vi.useRealTimers(); }
});
it("preserves explicitly nonclinical operation and resident progress without classifying legacy approvals", async () => {
  const f = await fixture(); const op = await db.careStage.create({ data: { patientId: f.patientId, station: "M44 nonclinical", sequence: 8, responsibilityScope: "SERVICE", responsibleRole: "ADMIN", assignedUserId: users.get("admin")!.id, requiresPhysicianConfirmation: false } });
  await tx(t => transitionCareStage(t, actor("admin"), { patientId: f.patientId, stageId: op.id, to: "CONFIRMED" }));
  const resident = await db.careStage.create({ data: { patientId: f.patientId, station: "M44 resident", sequence: 9, responsibilityScope: "CENTER", responsibleCenterId: center, responsibleRole: "RESIDENT" } });
  await tx(t => transitionCareStage(t, actor("resident"), { patientId: f.patientId, stageId: resident.id, to: "IN_PROGRESS" }));
  const legacy = await db.careStage.findUniqueOrThrow({ where: { id: "m44-legacy-confirmed" } });
  expect(legacy).toMatchObject({ status: "CONFIRMED", requiresPhysicianConfirmation: null, operationalCompletedAt: null }); save("other-lifecycles", { op: await state(op.id), resident: await state(resident.id), legacy });
});

const signal = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function waits(waiter: number, blocker: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await observer.$queryRaw<{ pid: number; blockers: number[]; wait_event_type: string }[]>`SELECT pid, pg_blocking_pids(pid) AS blockers, wait_event_type FROM pg_stat_activity WHERE pid=${waiter}`;
    if (rows[0]?.wait_event_type === "Lock" && rows[0].blockers.includes(blocker)) return rows[0];
    await new Promise(r => setTimeout(r, 25));
  } throw new Error("Required PostgreSQL contention did not occur");
}
async function interleave(label: string, id: string, holding: (t: Prisma.TransactionClient) => Promise<unknown>, waiting: (t: Prisma.TransactionClient) => Promise<unknown>) {
  const held = signal(), release = signal(), launched = signal(); let blocker = 0, waiter = 0;
  const a = first.$transaction(async t => { await t.$executeRaw`SET LOCAL lock_timeout='6s'`; blocker = (await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; await t.$queryRaw`SELECT id FROM "CareStage" WHERE id=${id} FOR UPDATE`; held.resolve(); await release.promise; return holding(t); }, { isolationLevel: "Serializable", timeout: 12000 });
  await held.promise;
  const b = withSerializableRetry(() => second.$transaction(async t => { await t.$executeRaw`SET LOCAL lock_timeout='6s'`; waiter = (await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; launched.resolve(); return waiting(t); }, { isolationLevel: "Serializable", timeout: 12000 }));
  // Attach a rejection handler immediately while the observer holds the bounded barrier.
  const bResult = b.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error) }));
  await launched.promise; let proof;
  try { proof = await waits(waiter, blocker); } finally { release.resolve(); }
  const results = await Promise.allSettled([a, bResult]); save(label, { blocker, waiter, lockProof: proof, results, persisted: await state(id) }); return results;
}
it("real lock waiting: duplicate authorized specialist confirmation has one success effect", async () => {
  const f = await fixture("doctor", "INTERNAL_SPECIALIST");
  const call = (t: Prisma.TransactionClient) => transitionCareStage(t, actor("doctor"), { ...f, to: "CONFIRMED" });
  await interleave("duplicate-confirmation-lock", f.stageId, call, call);
  const s = await state(f.stageId); expect(s.stage.status).toBe("CONFIRMED"); expect(s.audits.filter((a: { newValue?: { status?: string } }) => a.newValue?.status === "CONFIRMED")).toHaveLength(1);
});
it("real lock waiting: stale physician request after reassignment cannot use old completion", async () => {
  const f = await fixture(); const stamp = await work(f);
  const r = await interleave("reassignment-first-lock", f.stageId,
    t => reassignCenterStage(t, actor("manager"), { ...f, newAssigneeId: users.get("head2")!.id, expectedAssigneeId: null, reason: "M44 synthetic reassignment" }),
    t => transitionCareStage(t, actor("doctor"), { ...f, to: "CONFIRMED", expectedOperationalCompletionId: stamp.operationalCompletionId }));
  expect(r[1]).toMatchObject({ status: "fulfilled", value: { ok: false } });
  expect((await state(f.stageId)).stage).toMatchObject({ status: "IN_PROGRESS", assignedUserId: users.get("head2")!.id, operationalCompletedAt: null, confirmedById: null });
});
it("real lock waiting: stale duplicate operational completion cannot overwrite work attribution", async () => {
  const f = await fixture(); const row = await db.careStage.findUniqueOrThrow({ where: { id: f.stageId } });
  const call = (t: Prisma.TransactionClient) => completeCenterStageWork(t, actor("head"), { ...f, expectedUpdatedAt: row.updatedAt.toISOString() });
  const r = await interleave("duplicate-work-lock", f.stageId, call, call);
  expect(r[1]).toMatchObject({ status: "fulfilled", value: { ok: false } });
  const s = await state(f.stageId); expect(s.stage.status).toBe("IN_PROGRESS"); expect(s.audits.filter((a: { newValue?: { operationalCompletion?: boolean } }) => a.newValue?.operationalCompletion)).toHaveLength(1);
});
it("real lock waiting: physician-before-work is rejected, then work remains pending clinical review", async () => {
  const f = await fixture(); const row = await db.careStage.findUniqueOrThrow({ where: { id: f.stageId } });
  const r = await interleave("physician-before-work-lock", f.stageId,
    t => transitionCareStage(t, actor("doctor"), { ...f, to: "CONFIRMED" }),
    t => completeCenterStageWork(t, actor("head"), { ...f, expectedUpdatedAt: row.updatedAt.toISOString() }));
  expect(r[0].status).toBe("rejected"); expect(r[1]).toMatchObject({ status: "fulfilled", value: { ok: true } });
  expect((await state(f.stageId)).stage).toMatchObject({ status: "IN_PROGRESS", operationalCompletedById: users.get("head")!.id, confirmedById: null });
});
