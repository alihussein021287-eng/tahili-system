import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PrismaClient, type Prisma, type UserRole } from "@prisma/client";
createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
const auth = vi.hoisted(() => ({ id: "", role: "DOCTOR" as UserRole, failAudit: false }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: auth.id, role: auth.role, authVersion: 0 } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient().$extends({ query: { auditLog: { create({ args, query }) {
    if (auth.failAudit) args.data.userId = "v1-nonexistent-audit-actor";
    return query(args);
  } } } }) };
});
const { prisma: db } = await import("@/lib/db");
const { createReferralRequest, transitionReferralRequest } = await import("@/lib/referral-service");
const { nominateClinicalReviewer, acceptClinicalReview, revokeClinicalReview, clinicalReviewControls } = await import("@/lib/clinical-review-service");
const { completeCenterStageWork, transitionCareStage } = await import("@/lib/care-stage-service");
const { completeCenterProgramWork, confirmCenterProgramMedical } = await import("@/lib/center-program-lifecycle");
const { createCenterProgram, scheduleCenterSession, recordCenterSession, finalizeCenterProgram } = await import("@/app/(app)/centers/actions");
const { nominateReviewAction, acceptReviewAction, confirmProgramMedicalAction } = await import("@/app/(app)/clinical-review-actions");
const { confirmStage } = await import("@/app/(app)/patients/actions");
const { ClinicalReviewControls } = await import("@/components/patients/ClinicalReviewControls");
const { roleDefaultSet } = await import("@/lib/perms");
const { centerRoleForUserRole } = await import("@/lib/center-membership");
const { withSerializableRetry } = await import("@/lib/serializable-retry");
const clients = [new PrismaClient(), new PrismaClient(), new PrismaClient()];
const users = new Map<string, { id: string; role: UserRole }>();
let center: number, branch: number, index = 0;
const evidence: unknown[] = [];
const save = (label: string, value: unknown) => { evidence.push({ label, value }); writeFileSync(process.env.V1_STATE!, JSON.stringify(evidence, null, 2)); };
const actor = (key: string) => ({ userId: users.get(key)!.id, role: users.get(key)!.role, authVersion: 0 });
const login = (key: string) => { auth.id = users.get(key)!.id; auth.role = users.get(key)!.role; };
const tx = <T>(call: (t: Prisma.TransactionClient) => Promise<T>) => withSerializableRetry(() => db.$transaction(call, { isolationLevel: "Serializable" }));
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
async function snapshot(stageId: string, programId?: string) {
  return JSON.parse(JSON.stringify({ stage: await db.careStage.findUnique({ where: { id: stageId } }),
    program: programId ? await db.centerProgram.findUnique({ where: { id: programId }, include: { sessions: true, assessments: true } }) : null,
    assignments: await db.clinicalReviewAssignment.findMany({ where: { OR: [{ careStageId: stageId }, ...(programId ? [{ programId }] : [])] }, orderBy: { id: "asc" } }),
    audits: await db.auditLog.findMany({ orderBy: { id: "asc" } }), notices: await db.notification.findMany({ orderBy: { id: "asc" } }) }));
}
async function denial(label: string, f: { stageId: string; programId?: string }, call: () => Promise<unknown>) {
  const before = await snapshot(f.stageId, f.programId); let error: unknown;
  try { await call(); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(Error); expect(await snapshot(f.stageId, f.programId)).toEqual(before);
  save(label, { rejected: true, unchanged: true, code: (error as { code?: string }).code }); return error;
}
async function fixture(program = false) {
  const p = await db.patient.create({ data: { fullName: `V1 SYNTHETIC ${++index}`, branchId: branch } });
  const context = { ...actor("doctor"), permissions: roleDefaultSet("DOCTOR") };
  const ref = await createReferralRequest({ patientId: p.id, type: "TREATMENT_CENTER", destinationScope: "INTERNAL_CENTER", destinationCenterId: center, requestedService: "V1 synthetic", clinicalReason: "synthetic" }, context);
  await transitionReferralRequest(ref.id, "READY", {}, context);
  const accepted = await transitionReferralRequest(ref.id, "ACCEPTED", { acceptedById: actor("head").userId }, { ...actor("head"), permissions: roleDefaultSet("HEAD_THERAPIST") });
  const f = { patientId: p.id, stageId: accepted.careStageId!, referralId: ref.id, programId: undefined as string | undefined };
  if (program) {
    login("head"); await createCenterProgram(center, fd({ referralRequestId: ref.id, serviceType: "PSYCHOLOGICAL", assignedToId: actor("therapist").userId }));
    // Existing creation eligibility requires a therapist; resident sessions are tested
    // via explicit recorded assignment below, not a new resident program-assignment policy.
    f.programId = (await db.centerProgram.findUniqueOrThrow({ where: { referralRequestId: ref.id } })).id;
  }
  return f;
}
async function nominate(f: Awaited<ReturnType<typeof fixture>>, kind: "STAGE" | "PROGRAM" = "STAGE", key = "doctor") {
  const target = { kind, id: kind === "STAGE" ? f.stageId : f.programId! };
  const a = await tx(t => nominateClinicalReviewer(t, actor("secretary"), target, actor(key).userId));
  return { a, target };
}
async function accepted(f: Awaited<ReturnType<typeof fixture>>, kind: "STAGE" | "PROGRAM" = "STAGE") {
  const n = await nominate(f, kind); await tx(t => acceptClinicalReview(t, actor("doctor"), n.target, n.a.id)); return n;
}
async function work(f: Awaited<ReturnType<typeof fixture>>) {
  const s = await db.careStage.findUniqueOrThrow({ where: { id: f.stageId } });
  return tx(t => completeCenterStageWork(t, actor("head"), { ...f, expectedUpdatedAt: s.updatedAt.toISOString() }));
}
const finalInput = { finalSummary: "V1 synthetic assessment", improvementLevel: "synthetic", recommendation: "synthetic", returnToConsultancy: true };
async function session(f: Awaited<ReturnType<typeof fixture>>, complete = true) {
  login("head"); await db.centerProgram.update({ where: { id: f.programId }, data: { assignedToId: actor("resident").userId } });
  const at = new Date(Date.now() + index * 3600000);
  await scheduleCenterSession(center, f.programId!, fd({ scheduledAt: at.toISOString() }));
  const s = await db.centerSession.findFirstOrThrow({ where: { programId: f.programId } });
  login("resident"); if (complete) await recordCenterSession(center, s.id, fd({ status: "COMPLETED", attended: "1", result: "synthetic result" })); return s;
}
beforeAll(async () => {
  branch = (await db.branch.create({ data: { name: "V1 SYNTHETIC" } })).id;
  center = (await db.center.create({ data: { name: "V1 SYNTHETIC مركز التأهيل النفسي" } })).id;
  for (const [key, role] of [["doctor", "DOCTOR"], ["doctor2", "DOCTOR"], ["head", "HEAD_THERAPIST"], ["secretary", "SECRETARY"], ["unauthorizedSecretary", "SECRETARY"], ["resident", "RESIDENT"], ["therapist", "THERAPIST"], ["admin", "ADMIN"], ["manager", "MANAGER"]] as const) {
    const u = await db.user.create({ data: { username: `v1-${key}`, fullName: `V1 SYNTHETIC ${key}`, role, branchId: branch, passwordHash: "!synthetic-only", needsActivation: false } }); users.set(key, u);
    const r = centerRoleForUserRole(role); if (r) await db.centerMembership.create({ data: { userId: u.id, centerId: center, role: r } });
  }
  await db.userPermission.create({ data: { userId: actor("secretary").userId, permKey: "clinical.review.nominate", allowed: true } });
});
beforeEach(() => { login("doctor"); auth.failAudit = false; });
afterAll(async () => { await Promise.all([db.$disconnect(), ...clients.map(c => c.$disconnect())]); });

it("CENTER positive actual referral, nomination action, doctor acceptance action, HEAD work, medical confirmation action", async () => {
  const f = await fixture(); login("secretary"); await nominateReviewAction("STAGE", f.stageId, fd({ reviewerId: actor("doctor").userId }));
  const a = await db.clinicalReviewAssignment.findFirstOrThrow({ where: { careStageId: f.stageId, revokedAt: null } });
  login("doctor"); await acceptReviewAction("STAGE", f.stageId, a.id); const w = await work(f);
  login("doctor"); await confirmStage(f.patientId, f.stageId, w.operationalCompletionId, a.id);
  const s = await db.careStage.findUniqueOrThrow({ where: { id: f.stageId } });
  expect(s).toMatchObject({ status: "CONFIRMED", operationalCompletedById: actor("head").userId, confirmedById: actor("doctor").userId });
  expect((await db.clinicalReviewAssignment.findUniqueOrThrow({ where: { id: a.id } })).acceptedById).toBe(actor("doctor").userId);
  save("CENTER_POSITIVE", await snapshot(f.stageId));
});
it.each(["unauthorizedSecretary", "doctor", "admin", "manager"])("nomination denies %s without narrow secretary grant", async key => {
  const f = await fixture(); await denial(`nominate-${key}`, f, () => tx(t => nominateClinicalReviewer(t, actor(key), { kind: "STAGE", id: f.stageId }, actor("doctor").userId)));
});
it("role-wide nomination grant does not substitute for individual authorization", async () => {
  const f = await fixture(); await db.rolePermission.create({ data: { role: "SECRETARY", permKey: "clinical.review.nominate", allowed: true } });
  try { await denial("role-grant-only", f, () => tx(t => nominateClinicalReviewer(t, actor("unauthorizedSecretary"), { kind: "STAGE", id: f.stageId }, actor("doctor").userId))); }
  finally { await db.rolePermission.delete({ where: { role_permKey: { role: "SECRETARY", permKey: "clinical.review.nominate" } } }); }
});
it("wrong center or inactive physician membership cannot be nominated; candidate list excludes them", async () => {
  const f = await fixture(); const m = await db.centerMembership.findFirstOrThrow({ where: { userId: actor("doctor2").userId, centerId: center } });
  await db.centerMembership.update({ where: { id: m.id }, data: { endDate: new Date(0) } });
  try { await denial("inactive-physician", f, () => nominate(f, "STAGE", "doctor2")); const ui = await clinicalReviewControls(db, actor("secretary"), { kind: "STAGE", id: f.stageId }); expect(ui.candidates.map(x => x.id)).not.toContain(actor("doctor2").userId); }
  finally { await db.centerMembership.update({ where: { id: m.id }, data: { endDate: null } }); }
});
it("unaccepted nomination, absent work and administrator substitution are denied", async () => {
  const f = await fixture(); const n = await nominate(f); const w = await work(f);
  const call = (key: string) => tx(t => transitionCareStage(t, actor(key), { ...f, to: "CONFIRMED", expectedOperationalCompletionId: w.operationalCompletionId, expectedClinicalAssignmentId: n.a.id }));
  for (const k of ["doctor", "admin", "manager", "head"]) await denial(`no-acceptance-${k}`, f, () => call(k));
  const f2 = await fixture(); const a2 = await accepted(f2); await denial("before-operational", f2, () => tx(t => transitionCareStage(t, actor("doctor"), { ...f2, to: "CONFIRMED", expectedClinicalAssignmentId: a2.a.id })));
});
it.each(["membership", "nomination-grant", "permission", "session-version"])("current %s revocation invalidates accepted responsibility", async kind => {
  const f = await fixture(); const n = await accepted(f); const w = await work(f);
  const who = actor("secretary").userId; const m = await db.centerMembership.findFirstOrThrow({ where: { userId: who, centerId: center } });
  if (kind === "membership") await db.centerMembership.update({ where: { id: m.id }, data: { endDate: new Date(0) } });
  if (kind === "nomination-grant") await db.userPermission.update({ where: { userId_permKey: { userId: who, permKey: "clinical.review.nominate" } }, data: { allowed: false } });
  if (kind === "permission") await db.userPermission.create({ data: { userId: actor("doctor").userId, permKey: "journey.confirm", allowed: false } });
  if (kind === "session-version") await db.user.update({ where: { id: actor("doctor").userId }, data: { authVersion: 1 } });
  try { await denial(`revoked-${kind}`, f, () => tx(t => transitionCareStage(t, actor("doctor"), { ...f, to: "CONFIRMED", expectedOperationalCompletionId: w.operationalCompletionId, expectedClinicalAssignmentId: n.a.id }))); }
  finally {
    await db.centerMembership.update({ where: { id: m.id }, data: { endDate: null } });
    await db.userPermission.update({ where: { userId_permKey: { userId: who, permKey: "clinical.review.nominate" } }, data: { allowed: true } });
    if (kind === "permission") await db.userPermission.delete({ where: { userId_permKey: { userId: actor("doctor").userId, permKey: "journey.confirm" } } });
    await db.user.update({ where: { id: actor("doctor").userId }, data: { authVersion: 0 } });
  }
});
it("stale UUID after revoke and renomination to same physician cannot confirm", async () => {
  const f = await fixture(); const n = await accepted(f); const w = await work(f);
  await tx(t => revokeClinicalReview(t, actor("secretary"), n.target, n.a.id)); const next = await accepted(f);
  expect(next.a.id).not.toBe(n.a.id);
  await denial("stale-assignment", f, () => tx(t => transitionCareStage(t, actor("doctor"), { ...f, to: "CONFIRMED", expectedOperationalCompletionId: w.operationalCompletionId, expectedClinicalAssignmentId: n.a.id })));
});
it("cross-patient scope cannot nominate or expose controls", async () => {
  const f = await fixture(); const other = await db.branch.create({ data: { name: "V1 OTHER SYNTHETIC" } });
  const unrelated = await db.patient.create({ data: { fullName: "V1 SYNTHETIC unrelated", branchId: other.id } });
  const stage = await db.careStage.create({ data: { patientId: unrelated.id, station: "V1 SYNTHETIC unrelated", responsibilityScope: "CENTER", responsibleCenterId: center, responsibleRole: "HEAD_THERAPIST", requiresPhysicianConfirmation: true } });
  f.patientId = unrelated.id; f.stageId = stage.id;
  await denial("scope-nominate", f, () => nominate(f));
  await expect(clinicalReviewControls(db, actor("secretary"), { kind: "STAGE", id: f.stageId })).rejects.toThrow();
});
it("END positive actual program and sessions, operational action, accepted independent doctor closes and locks", async () => {
  const f = await fixture(true); const s = await session(f); const n = await accepted(f, "PROGRAM");
  login("head"); await finalizeCenterProgram(center, f.programId!, fd({ ...finalInput, returnToConsultancy: "1" }));
  const p = await db.centerProgram.findUniqueOrThrow({ where: { id: f.programId } }); expect(p.status).toBe("ACTIVE"); expect(p.closedAt).toBeNull();
  login("doctor"); await confirmProgramMedicalAction(center, f.programId!, p.operationalCompletionId!, n.a.id);
  expect(await db.centerProgram.findUniqueOrThrow({ where: { id: f.programId } })).toMatchObject({ status: "COMPLETED", medicalClosedById: actor("doctor").userId, operationalCompletedById: actor("head").userId });
  login("resident"); await denial("closed-session", f, () => recordCenterSession(center, s.id, fd({ status: "ATTENDED" })));
  login("head"); await denial("closed-schedule", f, () => scheduleCenterSession(center, f.programId!, fd({ scheduledAt: new Date().toISOString() })));
  expect((await db.careStage.findUniqueOrThrow({ where: { id: f.stageId } })).status).toBe("WAITING"); save("END_POSITIVE", await snapshot(f.stageId, f.programId));
});
it("END requires sessions, no pending sessions, HEAD role and explicit medical acceptance", async () => {
  const f = await fixture(true); await denial("no-session", f, () => tx(t => completeCenterProgramWork(t, actor("head"), center, f.programId!, finalInput)));
  const s = await session(f, false); await denial("pending-session", f, () => tx(t => completeCenterProgramWork(t, actor("head"), center, f.programId!, finalInput)));
  login("resident"); await recordCenterSession(center, s.id, fd({ status: "COMPLETED" }));
  for (const k of ["doctor", "admin", "manager"]) await denial(`end-operational-${k}`, f, () => tx(t => completeCenterProgramWork(t, actor(k), center, f.programId!, finalInput)));
  const n = await nominate(f, "PROGRAM"); const stamp = await tx(t => completeCenterProgramWork(t, actor("head"), center, f.programId!, finalInput));
  for (const k of ["doctor", "admin", "manager"]) await denial(`end-no-accepted-${k}`, f, () => tx(t => confirmCenterProgramMedical(t, actor(k), center, f.programId!, stamp, n.a.id)));
});
it("audit FK rolls nomination and medical END back without partial success", async () => {
  const f = await fixture(true); auth.failAudit = true;
  expect(await denial("nomination-FK", f, () => nominate(f))).toMatchObject({ code: "P2003" }); auth.failAudit = false;
  await session(f); const n = await accepted(f, "PROGRAM"); const stamp = await tx(t => completeCenterProgramWork(t, actor("head"), center, f.programId!, finalInput)); auth.failAudit = true;
  expect(await denial("END-FK", f, () => tx(t => confirmCenterProgramMedical(t, actor("doctor"), center, f.programId!, stamp, n.a.id)))).toMatchObject({ code: "P2003" }); auth.failAudit = false;
});
it("real FK failures roll back CENTER confirmation and operational END assessment", async () => {
  const f = await fixture(); const n = await accepted(f); const w = await work(f); auth.failAudit = true;
  expect(await denial("CENTER-confirm-FK", f, () => tx(t => transitionCareStage(t, actor("doctor"), { ...f, to: "CONFIRMED", expectedOperationalCompletionId: w.operationalCompletionId, expectedClinicalAssignmentId: n.a.id })))).toMatchObject({ code: "P2003" });
  auth.failAudit = false; const p = await fixture(true); await session(p); auth.failAudit = true;
  expect(await denial("END-work-FK", p, () => tx(t => completeCenterProgramWork(t, actor("head"), center, p.programId!, finalInput)))).toMatchObject({ code: "P2003" }); auth.failAudit = false;
});
it("UI exposes scoped nomination and explicit acceptance/confirmation, never secretary medical actions", async () => {
  const f = await fixture(); const props = { target: { kind: "STAGE" as const, id: f.stageId }, patientId: f.patientId, centerId: center, completionId: null as string | null };
  login("secretary"); const nominateHtml = renderToStaticMarkup(await ClinicalReviewControls(props));
  expect(nominateHtml).toContain("ترشيح طبيب للمراجعة"); expect(nominateHtml).not.toContain("تأكيد الطبيب للمرحلة");
  const n = await nominate(f); login("doctor"); const acceptHtml = renderToStaticMarkup(await ClinicalReviewControls(props)); expect(acceptHtml).toContain("أقبل مسؤولية المراجعة الطبية");
  await tx(t => acceptClinicalReview(t, actor("doctor"), n.target, n.a.id)); const w = await work(f); props.completionId = w.operationalCompletionId;
  expect(renderToStaticMarkup(await ClinicalReviewControls(props))).toContain("تأكيد الطبيب للمرحلة");
  login("unauthorizedSecretary"); expect(await ClinicalReviewControls(props)).toBeNull();
  expect(roleDefaultSet("SECRETARY").has("clinical.review.nominate")).toBe(false);
  expect(roleDefaultSet("SECRETARY").has("clinical.review.accept")).toBe(false);
  expect(roleDefaultSet("MANAGER").has("centers.programs.medicalConfirm")).toBe(false);
  save("UI_CONTROLS", { nomination: nominateHtml, acceptance: acceptHtml });
});
it("SERVICE historical linked handoff cannot establish initial assignment without responsible-service mapping", async () => {
  const { assignStageOnAccept } = await import("@/lib/stage-assignment");
  const f = await fixture(); const s = await db.careStage.create({ data: { patientId: f.patientId, station: "V1 SERVICE", responsibilityScope: "SERVICE", responsibleRole: "DOCTOR", requiresPhysicianConfirmation: false } });
  await denial("SERVICE-initial-handoff-denied", { ...f, stageId: s.id }, () => tx(t => assignStageOnAccept(t, {
    id: "V1 synthetic historical handoff", patientId: f.patientId, careStageId: s.id, fromUserId: actor("head").userId,
    toRole: "DOCTOR", toCenterId: null, note: "synthetic",
  }, { id: actor("doctor").userId, role: "DOCTOR" })));
});
it("revoked program nomination cannot strand independent HEAD operational completion", async () => {
  const f = await fixture(true); await session(f); await accepted(f, "PROGRAM");
  const who = actor("secretary").userId;
  await db.userPermission.update({ where: { userId_permKey: { userId: who, permKey: "clinical.review.nominate" } }, data: { allowed: false } });
  try {
    const stamp = await tx(t => completeCenterProgramWork(t, actor("head"), center, f.programId!, finalInput));
    expect(stamp).toBeTruthy(); expect((await db.centerProgram.findUniqueOrThrow({ where: { id: f.programId } })).status).toBe("ACTIVE");
  } finally { await db.userPermission.update({ where: { userId_permKey: { userId: who, permKey: "clinical.review.nominate" } }, data: { allowed: true } }); }
});
it("wrong-center physician and revoked SPECIALIST membership cannot supply clinical authority", async () => {
  const f = await fixture(); const n = await accepted(f); const w = await work(f);
  const m = await db.centerMembership.findFirstOrThrow({ where: { userId: actor("doctor").userId, centerId: center } });
  const other = await db.center.create({ data: { name: "V1 OTHER SYNTHETIC center" } });
  await db.centerMembership.update({ where: { id: m.id }, data: { centerId: other.id } });
  try {
    await denial("wrong-center-nomination", f, () => nominate(f));
    await denial("revoked-specialist-confirm", f, () => tx(t => transitionCareStage(t, actor("doctor"), { ...f, to: "CONFIRMED", expectedOperationalCompletionId: w.operationalCompletionId, expectedClinicalAssignmentId: n.a.id })));
  } finally { await db.centerMembership.update({ where: { id: m.id }, data: { centerId: center } }); }
});
it("duplicate program medical confirmations have one persisted closing audit", async () => {
  const f = await fixture(true); await session(f); const n = await accepted(f, "PROGRAM");
  const stamp = await tx(t => completeCenterProgramWork(t, actor("head"), center, f.programId!, finalInput));
  await Promise.all(Array.from({ length: 4 }, () => tx(t => confirmCenterProgramMedical(t, actor("doctor"), center, f.programId!, stamp, n.a.id))));
  const audits = await db.auditLog.findMany({ where: { recordId: f.programId, tableName: "center_programs" } });
  expect(audits.filter(a => (a.newValue as { medicalClosedById?: string })?.medicalClosedById)).toHaveLength(1);
  save("DUPLICATE_END", await snapshot(f.stageId, f.programId));
});
it("existing central ADMIN scheduling remains available without granting program finalization", async () => {
  const f = await fixture(true); login("admin");
  await scheduleCenterSession(center, f.programId!, fd({ scheduledAt: new Date(Date.now() + index * 3600000).toISOString() }));
  expect(await db.centerSession.count({ where: { programId: f.programId } })).toBe(1);
  await denial("admin-still-not-operational-owner", f, () => tx(t => completeCenterProgramWork(t, actor("admin"), center, f.programId!, finalInput)));
});
it("concurrent CENTER confirmations and acceptance produce one persisted effect each", async () => {
  const f = await fixture(); const n = await nominate(f); const w = await work(f);
  await Promise.all(Array.from({ length: 4 }, () => tx(t => acceptClinicalReview(t, actor("doctor"), n.target, n.a.id))));
  const r = await Promise.all(Array.from({ length: 4 }, () => tx(t => transitionCareStage(t, actor("doctor"), { ...f, to: "CONFIRMED", expectedOperationalCompletionId: w.operationalCompletionId, expectedClinicalAssignmentId: n.a.id }))));
  expect(r.filter(x => x.changed)).toHaveLength(1);
  expect(await db.auditLog.count({ where: { recordId: n.a.id, action: "UPDATE" } })).toBe(1);
  save("DUPLICATE_CENTER", { results: r, state: await snapshot(f.stageId) });
});

const barrier = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
it.each([true, false])("actual resident session edit versus operational END lock, editFirst=%s", async editFirst => {
  const f = await fixture(true); const s = await session(f);
  // A completed session can be changed back to ATTENDED while ACTIVE under the
  // existing writer contract. END must never race it into a closed pending session.
  const held = barrier(), release = barrier(), launched = barrier(); let blocker = 0, waiter = 0;
  const edit = async (t: Prisma.TransactionClient) => {
    const { recordCenterSessionInTransaction } = await import("@/lib/center-program-lifecycle");
    await recordCenterSessionInTransaction(t, actor("resident"), center, s.id, { status: "ATTENDED", attended: true });
  };
  const end = (t: Prisma.TransactionClient) => completeCenterProgramWork(t, actor("head"), center, f.programId!, finalInput);
  const a = clients[0].$transaction(async t => { await t.$executeRaw`SET LOCAL lock_timeout='6s'`; blocker = (await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; await t.$queryRaw`SELECT id FROM center_programs WHERE id=${f.programId} FOR UPDATE`; held.resolve(); await release.promise; return (editFirst ? edit : end)(t); }, { isolationLevel: "Serializable", timeout: 15000 });
  const ar = a.then(() => ({ ok: true }), e => ({ ok: false, error: String(e) })); await held.promise;
  const b = withSerializableRetry(() => clients[1].$transaction(async t => { await t.$executeRaw`SET LOCAL lock_timeout='6s'`; waiter = (await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; launched.resolve(); return (editFirst ? end : edit)(t); }, { isolationLevel: "Serializable", timeout: 15000 }));
  const br = b.then(() => ({ ok: true }), e => ({ ok: false, error: String(e) })); await launched.promise;
  let proof: unknown;
  try { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const rows = await clients[2].$queryRaw<{ pid: number; blockers: number[]; wait_event_type: string }[]>`SELECT pid,pg_blocking_pids(pid) AS blockers,wait_event_type FROM pg_stat_activity WHERE pid=${waiter}`; if (rows[0]?.wait_event_type === "Lock" && rows[0].blockers.includes(blocker)) { proof = rows[0]; break; } await new Promise(r => setTimeout(r, 25)); } expect(proof).toBeTruthy(); } finally { release.resolve(); }
  const r = await Promise.all([ar, br]); expect(r.map(x => x.ok)).toEqual([true, false]);
  const p = await db.centerProgram.findUniqueOrThrow({ where: { id: f.programId } });
  expect(!!p.operationalCompletedAt).toBe(!editFirst); expect((await db.centerSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe(editFirst ? "ATTENDED" : "COMPLETED");
  save(`END_LOCK_${editFirst}`, { proof, results: r, state: await snapshot(f.stageId, f.programId) });
});
