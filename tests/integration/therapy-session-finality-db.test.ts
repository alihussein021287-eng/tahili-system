import { afterAll, describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";

createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
type Context = { id: string; role: UserRole; kind: string };
const h = vi.hoisted((): { context?: AsyncLocalStorage<Context>; afterPointer?: () => Promise<void>; beforeWrite?: () => Promise<void>; afterFinalRead?: () => Promise<void>; failAudit: string; sql: string[] } => ({ failAudit: "", sql: [] }));
h.context = new AsyncLocalStorage<Context>();
vi.mock("next-auth", () => ({ getServerSession: async () => { const a = h.context?.getStore(); return a ? { user: { id: a.id, role: a.role, authVersion: 0 } } : null; } }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  db.$on("query", e => h.sql.push(e.query)); // Never capture SQL parameters or auth material.
  return { prisma: db.$extends({ query: {
    therapySession: {
      async findUniqueOrThrow({ args, query }) { const row = await query(args); if (h.context?.getStore()?.kind === "late-edit" && args.select?.updatedAt && h.afterPointer) await h.afterPointer(); return row; },
      async update({ args, query }) { if (h.context?.getStore()?.kind === "edit" && h.beforeWrite) await h.beforeWrite(); return query(args); },
    },
    treatmentPlan: { async findUniqueOrThrow({ args, query }) { const row = await query(args); if (h.context?.getStore()?.kind === "end" && args.include?.sessions && h.afterFinalRead) await h.afterFinalRead(); return row; } },
    auditLog: { async create({ args, query }) { if (h.failAudit && h.context?.getStore()?.kind === h.failAudit) args.data.userId = "m35r1-missing-synthetic-audit-user"; return query(args); } },
  } }) };
});
const { prisma } = await import("@/lib/db");
const { PrismaClient } = await import("@prisma/client");
const observer = new PrismaClient(); // Independent connection, including pg_stat_activity / persisted-state reads.
const { updateSessionRecord, addTherapySessionLog, deleteSession, setTreatmentPlanStatus } = await import("@/app/(app)/patients/actions");
const { recordTherapyAppointment, finalizeTherapyPlan, rescheduleTherapyAppointment } = await import("@/app/(app)/therapy/actions");
const evidence: unknown[] = [];
const gate = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
const as = <T>(u: { id: string; role: UserRole }, kind: string, run: () => Promise<T>) => h.context!.run({ id: u.id, role: u.role, kind }, run);
const form = (fields: Record<string, string> = {}) => { const fd = new FormData(); Object.entries(fields).forEach(([k,v]) => fd.set(k,v)); return fd; };
const edit = (notes = "Synthetic edit") => form({ actualSessions: "0", totalSessions: "1", notes });
const final = () => form({ finalDecision: "END", finalRecoveryPercent: "60" });
async function fixture() {
  h.afterPointer = undefined; h.beforeWrite = undefined; h.afterFinalRead = undefined; h.failAudit = "";
  const tag = `m35r1-${randomUUID().slice(0,8)}`;
  const branch = await observer.branch.create({ data: { name: tag } });
  const center = await observer.center.create({ data: { name: tag } });
  const user = (role: UserRole) => observer.user.create({ data: { username: `${tag}-${role}`, fullName: `Synthetic ${role}`, role, branchId: branch.id, passwordHash: "!synthetic", needsActivation: false }, select: { id: true, role: true } });
  const resident = await user("RESIDENT"), therapist = await user("THERAPIST"), head = await user("HEAD_THERAPIST"), doctor = await user("DOCTOR"), admin = await user("ADMIN"), viewer = await user("VIEWER");
  await observer.centerMembership.createMany({ data: [{ userId: head.id, centerId: center.id, role: "HEAD_THERAPIST", startDate: new Date("2020-01-01") }, { userId: therapist.id, centerId: center.id, role: "THERAPIST", startDate: new Date("2020-01-01") }] });
  const patient = await observer.patient.create({ data: { fullName: tag, branchId: branch.id } });
  const plan = await observer.treatmentPlan.create({ data: { title: tag, patientId: patient.id, centerId: center.id, therapistId: therapist.id, specialistDoctorId: doctor.id, status: "ACTIVE", plannedSessions: 1 } });
  const session = await observer.therapySession.create({ data: { patientId: patient.id, treatmentPlanId: plan.id, centerId: center.id, therapistId: therapist.id, therapyType: "PHYSICAL", totalSessions: 1, actualSessions: 0 } });
  const appointment = await observer.appointment.create({ data: { patientId: patient.id, sessionId: session.id, assignedToId: therapist.id, scheduledAt: new Date("2030-01-01"), status: "SCHEDULED" } });
  return { resident, therapist, head, doctor, admin, viewer, patient, plan, session, appointment };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function snapshot(f: Fixture) { return {
  plan: await observer.treatmentPlan.findUnique({ where: { id: f.plan.id } }),
  sessions: await observer.therapySession.findMany({ where: { patientId: f.patient.id }, orderBy: { id: "asc" } }),
  appointments: await observer.appointment.findMany({ where: { patientId: f.patient.id }, orderBy: { id: "asc" } }),
  logs: await observer.therapySessionLog.findMany({ where: { patientId: f.patient.id }, orderBy: { id: "asc" } }),
  audits: await observer.auditLog.findMany({ where: { OR: [{ recordId: { in: [f.plan.id, f.session.id, f.appointment.id] } }, { tableName: "therapy_session_logs", userId: { in: [f.resident.id, f.admin.id] } }] }, orderBy: { id: "asc" } }),
  handoffs: await observer.patientHandoff.findMany({ where: { patientId: f.patient.id }, orderBy: { id: "asc" } }),
  notices: await observer.notification.findMany({ where: { targetUserId: f.doctor.id }, orderBy: { id: "asc" } }),
  queues: await observer.queueEntry.findMany({ where: { patientId: f.patient.id } }), tasks: await observer.task.findMany({ where: { patientId: f.patient.id } }),
}; }
async function unchanged(f: Fixture, label: string, run: () => Promise<unknown>) { const before = await snapshot(f); let rejected = false; try { await run(); } catch { rejected = true; } const after = await snapshot(f); evidence.push({ label, rejected, before, after }); expect(rejected).toBe(true); expect(after).toEqual(before); }
const complete = (f: Fixture) => as(f.therapist, "record", () => recordTherapyAppointment(f.appointment.id, form({ status: "COMPLETED", attended: "1" })));
const end = (f: Fixture) => as(f.head, "end", () => finalizeTherapyPlan(f.plan.id, final()));
async function ready(f: Fixture) { await complete(f); }
async function sealed(f: Fixture) { await ready(f); await end(f); }
async function waitForPlanBlock(label: string) {
  for (let i=0;i<100;i++) {
    const rows = await observer.$queryRaw<Array<{ pid: number; blockers: number[] }>>`SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%TreatmentPlan%' AND query LIKE '%FOR UPDATE%'`;
    if (rows.some(r => r.blockers.length)) { evidence.push({ label, actualPostgresWait: rows }); return rows; }
    await new Promise(r => setTimeout(r,20));
  }
  throw new Error(`No actual PostgreSQL plan-lock wait: ${label}`);
}
const settled = <T>(p: Promise<T>) => p.then(value => ({ ok: true, value, error: "" }), error => ({ ok: false, value: undefined, error: error instanceof Error ? error.message : String(error) }));
afterAll(async () => { if (process.env.SESSION_FINALITY_EVIDENCE_FILE) writeFileSync(process.env.SESSION_FINALITY_EVIDENCE_FILE, JSON.stringify({ evidence, sql: h.sql },null,2)); await observer.$disconnect(); await prisma.$disconnect(); });

describe("session / final END synchronization with independent PostgreSQL connections", () => {
  it("reproduces the original late-request ordering and revalidates after END commits", async () => {
    const f=await fixture(), entered=gate(), release=gate();
    h.afterPointer=async()=>{entered.release();await release.promise;};
    const pending=settled(as(f.resident,"late-edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit())));
    try { await entered.promise; await sealed(f); const before=await snapshot(f); release.release(); const outcome=await pending; const after=await snapshot(f); evidence.push({label:"original-M35-order-END-before-edit-lock",outcome,before,after}); expect(outcome.ok).toBe(false); expect(after).toEqual(before); expect(after.sessions[0].actualSessions).toBe(1); }
    finally { release.release(); await pending; }
  });
  it("END owns plan first: the session writer really waits, then rejects without effects", async () => {
    const f=await fixture();await ready(f);const entered=gate(),release=gate();h.afterFinalRead=async()=>{entered.release();await release.promise;};
    const finishing=settled(end(f));let pending: ReturnType<typeof settled> | undefined;
    try { await entered.promise;pending=settled(as(f.resident,"edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit())));await waitForPlanBlock("END-first");release.release();expect((await finishing).ok).toBe(true);const before=await snapshot(f);const outcome=await pending;const after=await snapshot(f);evidence.push({label:"END-first-rejected",outcome,before,after});expect(outcome.ok).toBe(false);expect(after).toEqual(before); }
    finally { release.release();await finishing;if(pending)await pending; }
  });
  it("edit owns plan first: completion waits, then END commits in a valid serial order", async () => {
    const f=await fixture(),entered=gate(),release=gate(),order:string[]=[];h.beforeWrite=async()=>{entered.release();await release.promise;};
    const writing=settled(as(f.resident,"edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit())).then(()=>order.push("edit-committed")));
    let finishing: ReturnType<typeof settled> | undefined;
    try { await entered.promise;finishing=settled(complete(f).then(async()=>{order.push("completion-committed");await end(f);order.push("END-committed");}));await waitForPlanBlock("edit-first");release.release();const writeOutcome=await writing,finalOutcome=await finishing;const after=await snapshot(f);evidence.push({label:"edit-first-serial-history",order,writeOutcome,finalOutcome,after});expect(writeOutcome.ok).toBe(true);expect(finalOutcome.ok).toBe(true);expect(order).toEqual(["edit-committed","completion-committed","END-committed"]);expect(after.plan).toMatchObject({status:"COMPLETED",finalDecision:"END"});expect(after.sessions[0].actualSessions).toBe(1); }
    finally { release.release();await writing;if(finishing)await finishing; }
  });
  it("rejects a concurrent stale metadata overwrite after waiting on the plan", async () => {
    const f=await fixture(),entered=gate(),release=gate();h.beforeWrite=async()=>{entered.release();await release.promise;};
    const first=settled(as(f.resident,"edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit("Synthetic first"))));let second: ReturnType<typeof settled> | undefined;
    try {await entered.promise;second=settled(as(f.resident,"late-edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit("Synthetic stale second"))));await waitForPlanBlock("two-edits");release.release();expect((await first).ok).toBe(true);expect((await second).ok).toBe(false);const after=await snapshot(f);evidence.push({label:"concurrent-edit-version-rejection",after});expect(after.sessions[0]).toMatchObject({actualSessions:0,notes:"Synthetic first"});expect(after.audits.filter(a=>a.tableName==="therapy_sessions")).toHaveLength(1);}
    finally {release.release();await first;if(second)await second;}
  });
  it("allows an authorized editable-plan edit and atomic success audit", async()=>{const f=await fixture();await as(f.resident,"edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit()));const after=await snapshot(f);expect(after.sessions[0].notes).toBe("Synthetic edit");expect(after.audits).toHaveLength(1);evidence.push({label:"authorized-pre-END-edit",after});});
  it("denies already finalized resident edits",async()=>{const f=await fixture();await sealed(f);await unchanged(f,"already-END",()=>as(f.resident,"edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit())));});
  it("preserves explicitly permitted ADMIN override",async()=>{const f=await fixture();await sealed(f);await as(f.admin,"edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit()));expect((await snapshot(f)).audits.some(a=>a.newValue&&typeof a.newValue==='object'&&!Array.isArray(a.newValue)&&a.newValue.administrativeOverride===true)).toBe(true);});
  it("denies ADMIN without its effective override permission",async()=>{const f=await fixture();await sealed(f);await observer.userPermission.create({data:{userId:f.admin.id,permKey:"therapy.admin.override",allowed:false}});await unchanged(f,"override-denied",()=>as(f.admin,"edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit())));});
  it("denies direct action without clinical.session",async()=>{const f=await fixture();await unchanged(f,"unauthorized-role",()=>as(f.viewer,"edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit())));});
  it("reloads effective permission inside the transaction after a pre-lock wait",async()=>{const f=await fixture(),entered=gate(),release=gate();h.afterPointer=async()=>{entered.release();await release.promise;};const pending=settled(as(f.resident,"late-edit",()=>updateSessionRecord(f.patient.id,f.session.id,edit())));try{await entered.promise;await observer.userPermission.create({data:{userId:f.resident.id,permKey:"clinical.session",allowed:false}});const before=await snapshot(f);release.release();expect((await pending).ok).toBe(false);expect(await snapshot(f)).toEqual(before);evidence.push({label:"transaction-permission-revalidation",before,after:await snapshot(f)});}finally{release.release();await pending;}});
  it("rolls back metadata, counts and success audit on a real audit FK error",async()=>{const f=await fixture();h.failAudit="edit";const fd=edit();fd.set("actualSessions","1");await unchanged(f,"edit-audit-FK",()=>as(f.resident,"edit",()=>updateSessionRecord(f.patient.id,f.session.id,fd)));});
  it("rolls back appointment completion, count and plan status on audit failure",async()=>{const f=await fixture();h.failAudit="record";await unchanged(f,"completion-audit-FK",()=>complete(f));});
  it("does not count repeated completion twice",async()=>{const f=await fixture();await complete(f);await unchanged(f,"repeat-completion-closed",()=>complete(f));expect((await snapshot(f)).sessions[0].actualSessions).toBe(1);});
  it("keeps legitimate END and the named physician follow-up",async()=>{const f=await fixture();await sealed(f);const after=await snapshot(f);expect(after.plan).toMatchObject({finalDecision:"END",status:"COMPLETED"});expect(after.handoffs).toHaveLength(1);expect(after.handoffs[0]).toMatchObject({toUserId:f.doctor.id,toRole:"DOCTOR",toCenterId:null,status:"SENT"});evidence.push({label:"approved-END-and-physician-followup",after});});
  it("blocks linked log append after END",async()=>{const f=await fixture();await sealed(f);await unchanged(f,"linked-log-END",()=>as(f.resident,"log",()=>addTherapySessionLog(f.patient.id,form({sessionId:f.session.id,notes:"Synthetic"}))));});
  it("resolves appointment-only log linkage before checking finality",async()=>{const f=await fixture();await sealed(f);await unchanged(f,"appointment-only-log-END",()=>as(f.resident,"log",()=>addTherapySessionLog(f.patient.id,form({appointmentId:f.appointment.id,notes:"Synthetic"}))));});
  it("preserves an authorized linked pre-END log and rolls it back on audit error",async()=>{const f=await fixture();await as(f.resident,"log",()=>addTherapySessionLog(f.patient.id,form({appointmentId:f.appointment.id,notes:"Synthetic"})));expect((await snapshot(f)).logs[0].sessionId).toBe(f.session.id);h.failAudit="log";await unchanged(f,"log-audit-FK",()=>as(f.resident,"log",()=>addTherapySessionLog(f.patient.id,form({sessionId:f.session.id,notes:"Synthetic rollback"}))));});
  it("prevents a foreign patient parameter from authorizing this session",async()=>{const f=await fixture();const foreign=await observer.patient.create({data:{fullName:"Synthetic alternate patient"}});await unchanged(f,"session-patient-mismatch",()=>as(f.admin,"edit",()=>updateSessionRecord(foreign.id,f.session.id,edit())));});
  it("keeps assigned therapist rescheduling before END",async()=>{const f=await fixture();await as(f.therapist,"reschedule",()=>rescheduleTherapyAppointment(f.appointment.id,form({scheduledAt:"2030-02-01T10:00:00Z"})));expect((await snapshot(f)).appointments[0].scheduledAt.toISOString()).toBe("2030-02-01T10:00:00.000Z");});
  it("denies session rescheduling after END",async()=>{const f=await fixture();await sealed(f);await unchanged(f,"reschedule-END",()=>as(f.therapist,"reschedule",()=>rescheduleTherapyAppointment(f.appointment.id,form({scheduledAt:"2030-02-01T10:00:00Z"}))));});
  it("requires existing override for ADMIN deletion of an ended linked session",async()=>{const f=await fixture();await sealed(f);await observer.userPermission.create({data:{userId:f.admin.id,permKey:"therapy.admin.override",allowed:false}});await unchanged(f,"delete-without-override",()=>as(f.admin,"delete",()=>deleteSession(f.patient.id,f.session.id)));});
  for (const action of ["completion", "reschedule"] as const) it(`keeps final END sealed for non-override ${action} after a status-only ADMIN reactivation`,async()=>{
    const f=await fixture();
    const pending=await observer.appointment.create({data:{patientId:f.patient.id,sessionId:f.session.id,assignedToId:f.therapist.id,scheduledAt:new Date("2030-03-01"),status:"SCHEDULED"}});
    await sealed(f);await as(f.admin,"admin",()=>setTreatmentPlanStatus(f.patient.id,f.plan.id,"ACTIVE"));
    await unchanged(f,`END-stamp-${action}`,()=>as(f.therapist,action,()=>action==="completion"
      ? recordTherapyAppointment(pending.id,form({status:"COMPLETED",attended:"1"}))
      : rescheduleTherapyAppointment(pending.id,form({scheduledAt:"2030-04-01T10:00:00Z"}))));
  });
});
