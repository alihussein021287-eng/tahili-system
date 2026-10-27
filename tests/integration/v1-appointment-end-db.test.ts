import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaClient, type UserRole } from "@prisma/client";
createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
const auth = vi.hoisted(() => ({ id: "", role: "RECEPTION" as UserRole, failAudit: false }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: auth.id, role: auth.role, authVersion: 0 } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath() {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient().$extends({ query: { auditLog: { create({ args, query }) {
    if (auth.failAudit) args.data.userId = "synthetic-missing-audit-user";
    return query(args);
  } } } }) };
});
const { prisma: db } = await import("@/lib/db");
const actions = await import("@/app/(app)/appointments/actions");
const { respondAppointment } = await import("@/app/portal/[token]/actions");
const { completeCenterProgramWork } = await import("@/lib/center-program-lifecycle");
const clients = [new PrismaClient(), new PrismaClient()];
let branch: number, center: number, editor: string, admin: string, head: string, outsider: string;
const evidence: unknown[] = [];
function save(label: string, result: unknown) {
  evidence.push({ label, result });
  writeFileSync(process.env.END_APPOINTMENT_STATE!, JSON.stringify(evidence, null, 2));
}
function login(id = editor, role: UserRole = "RECEPTION") { auth.id = id; auth.role = role; }
const form = (values: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; };
const reschedule = (id: string) => actions.rescheduleAppointment(id, form({ scheduledAt: "2026-11-01T10:00:00Z" }));
async function success(call: () => Promise<unknown>) {
  try { await call(); } catch (e) { if (!(e instanceof Error && e.message.startsWith("REDIRECT:"))) throw e; }
}
async function fixture(state: "OPEN" | "OPERATIONAL" | "MEDICAL" | "UNRELATED" = "OPEN") {
  const patient = await db.patient.create({ data: { fullName: "END APPOINTMENT SYNTHETIC", branchId: branch } });
  const appointment = await db.appointment.create({ data: { patientId: patient.id, scheduledAt: new Date("2026-10-26T10:00:00Z"), status: "COMPLETED" } });
  if (state === "UNRELATED") return { appointment, program: null };
  const at = new Date();
  const program = await db.centerProgram.create({ data: { centerId: center, patientId: patient.id, serviceType: "PSYCHOLOGICAL",
    status: state === "MEDICAL" ? "COMPLETED" : "ACTIVE",
    ...(state !== "OPEN" ? { operationalCompletedById: head, operationalCompletedAt: at, operationalCompletionId: randomUUID() } : {}),
    ...(state === "MEDICAL" ? { medicalClosedById: admin, medicalClosedAt: at, closedAt: at } : {}),
  } });
  await db.centerSession.create({ data: { centerId: center, programId: program.id, patientId: patient.id, appointmentId: appointment.id,
    scheduledAt: appointment.scheduledAt, endsAt: new Date(appointment.scheduledAt.getTime() + 3600000), status: "COMPLETED", completedAt: at } });
  return { appointment, program };
}
async function snapshot(id: string) {
  return JSON.parse(JSON.stringify({ appointment: await db.appointment.findUnique({ where: { id }, include: { centerSession: { include: { program: true } } } }),
    audits: await db.auditLog.findMany({ where: { recordId: id }, orderBy: { id: "asc" } }) }));
}
async function denied(id: string, call: () => Promise<unknown>) {
  const before = await snapshot(id);
  await expect(call()).rejects.toThrow();
  expect(await snapshot(id)).toEqual(before);
  save("DENIED_UNCHANGED", { id, state: before });
}
beforeAll(async () => {
  branch = (await db.branch.create({ data: { name: "END APPOINTMENT SYNTHETIC" } })).id;
  center = (await db.center.create({ data: { name: "END APPOINTMENT SYNTHETIC" } })).id;
  const user = async (name: string, role: UserRole, branchId = branch) => (await db.user.create({ data: { username: name, fullName: name, role, branchId, passwordHash: "!synthetic", needsActivation: false } })).id;
  editor = await user("end-appointment-editor", "RECEPTION"); admin = await user("end-appointment-admin", "ADMIN"); head = await user("end-appointment-head", "HEAD_THERAPIST");
  const other = (await db.branch.create({ data: { name: "END APPOINTMENT OTHER SYNTHETIC" } })).id;
  outsider = await user("end-appointment-outsider", "RECEPTION", other);
  await db.centerMembership.create({ data: { centerId: center, userId: head, role: "HEAD_THERAPIST" } });
  await db.orgSetting.upsert({ where: { id: 1 }, create: { id: 1, adminConfig: { workDays: ["0", "1", "2", "3", "4", "5", "6"], workStart: "00:00", workEnd: "23:59" } },
    update: { adminConfig: { workDays: ["0", "1", "2", "3", "4", "5", "6"], workStart: "00:00", workEnd: "23:59" } } });
});
beforeEach(() => { login(); auth.failAudit = false; });
afterAll(async () => { await Promise.all([db.$disconnect(), ...clients.map(c => c.$disconnect())]); });

it.each(["OPEN", "UNRELATED"] as const)("%s retains actual status and rescheduling actions with durable audits", async state => {
  const { appointment } = await fixture(state);
  await actions.setAppointmentStatus(appointment.id, "CANCELLED"); await success(() => reschedule(appointment.id));
  expect(await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toMatchObject({ status: "CANCELLED", scheduledAt: new Date("2026-11-01T10:00:00Z") });
  expect(await db.auditLog.count({ where: { recordId: appointment.id } })).toBe(2);
  await actions.setAppointmentStatus(appointment.id, "CANCELLED");
  expect(await db.auditLog.count({ where: { recordId: appointment.id } })).toBe(2);
  save("POSITIVE_" + state, await snapshot(appointment.id));
});
it.each(["OPERATIONAL", "MEDICAL"] as const)("%s blocks status, reschedule, center/hall and ADMIN deletion without mutation or audit", async state => {
  const { appointment } = await fixture(state);
  await denied(appointment.id, () => actions.setAppointmentStatus(appointment.id, "CANCELLED"));
  await denied(appointment.id, () => reschedule(appointment.id));
  await denied(appointment.id, () => actions.updateAppointmentCenterHall(appointment.id, form({ centerId: String(center) })));
  login(admin, "ADMIN"); await denied(appointment.id, () => actions.deleteAppointment(appointment.id));
});
it("open center/hall edits and ADMIN deletion remain available", async () => {
  const { appointment } = await fixture();
  await success(() => actions.updateAppointmentCenterHall(appointment.id, form({ centerId: String(center) })));
  expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).centerId).toBe(center);
  login(admin, "ADMIN"); await actions.deleteAppointment(appointment.id);
  expect(await db.appointment.count({ where: { id: appointment.id } })).toBe(0);
  expect(await db.auditLog.count({ where: { recordId: appointment.id, action: "DELETE" } })).toBe(1);
});
it("permission denial and other-branch access leave every affected action unchanged", async () => {
  const { appointment } = await fixture();
  for (const mode of ["permission", "scope"]) {
    if (mode === "permission") await db.userPermission.create({ data: { userId: editor, permKey: "appointments.edit", allowed: false } }); else login(outsider);
    await denied(appointment.id, () => actions.setAppointmentStatus(appointment.id, "CANCELLED"));
    await denied(appointment.id, () => reschedule(appointment.id));
    await denied(appointment.id, () => actions.updateAppointmentCenterHall(appointment.id, form({})));
    await denied(appointment.id, () => actions.deleteAppointment(appointment.id));
    if (mode === "permission") await db.userPermission.delete({ where: { userId_permKey: { userId: editor, permKey: "appointments.edit" } } });
  }
});
it("TreatmentPlan restrictions and the existing authorized override are preserved", async () => {
  const { appointment } = await fixture("UNRELATED");
  const plan = await db.treatmentPlan.create({ data: { patientId: appointment.patientId, title: "SYNTHETIC", status: "COMPLETED" } });
  const session = await db.therapySession.create({ data: { patientId: appointment.patientId, treatmentPlanId: plan.id, therapyType: "PHYSICAL" } });
  await db.appointment.update({ where: { id: appointment.id }, data: { sessionId: session.id } });
  await denied(appointment.id, () => actions.setAppointmentStatus(appointment.id, "CANCELLED"));
  await denied(appointment.id, () => reschedule(appointment.id));
  login(admin, "ADMIN"); await actions.setAppointmentStatus(appointment.id, "CANCELLED"); await success(() => reschedule(appointment.id));
  await db.treatmentPlan.update({ where: { id: plan.id }, data: { status: "ACTIVE" } }); login();
  await denied(appointment.id, () => actions.setAppointmentStatus(appointment.id, "COMPLETED"));
  await actions.setAppointmentStatus(appointment.id, "NOSHOW"); await success(() => reschedule(appointment.id));
});
it("real audit FK failures roll back each appointment mutation", async () => {
  for (const kind of ["status", "reschedule", "center", "delete"]) {
    const { appointment } = await fixture(); if (kind === "delete") login(admin, "ADMIN");
    auth.failAudit = true;
    const call = () => kind === "status" ? actions.setAppointmentStatus(appointment.id, "CANCELLED") : kind === "reschedule" ? reschedule(appointment.id)
      : kind === "center" ? actions.updateAppointmentCenterHall(appointment.id, form({ centerId: String(center) })) : actions.deleteAppointment(appointment.id);
    const before = await snapshot(appointment.id); await expect(call()).rejects.toMatchObject({ code: "P2003" }); expect(await snapshot(appointment.id)).toEqual(before);
    auth.failAudit = false; login(); save("FK_ROLLBACK_" + kind, { persistedUnchanged: true, code: "P2003" });
  }
});
it("portal cancellation preserves open/unrelated behavior and denies END, invalid tokens and wrong-patient references", async () => {
  for (const state of ["OPEN", "UNRELATED", "OPERATIONAL", "MEDICAL"] as const) {
    const { appointment } = await fixture(state), token = randomUUID();
    await db.patient.update({ where: { id: appointment.patientId }, data: { accessToken: token } });
    await db.appointment.update({ where: { id: appointment.id }, data: { status: "SCHEDULED", scheduledAt: new Date("2099-01-01T10:00:00Z") } });
    const before = await snapshot(appointment.id);
    await respondAppointment("invalid-token", appointment.id, "CANCELLED"); expect(await snapshot(appointment.id)).toEqual(before);
    const other = await fixture("UNRELATED"); await respondAppointment(token, other.appointment.id, "CANCELLED"); expect(await snapshot(appointment.id)).toEqual(before);
    await respondAppointment(token, appointment.id, "CANCELLED");
    if (state === "OPEN" || state === "UNRELATED") {
      expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("CANCELLED");
      expect(await db.auditLog.count({ where: { recordId: appointment.id } })).toBe(1);
    } else expect(await snapshot(appointment.id)).toEqual(before);
    save("PORTAL_" + state, await snapshot(appointment.id));
  }
  const { appointment } = await fixture(), token = randomUUID();
  await db.patient.update({ where: { id: appointment.patientId }, data: { accessToken: token } });
  await db.appointment.update({ where: { id: appointment.id }, data: { status: "SCHEDULED", scheduledAt: new Date("2099-01-01T10:00:00Z") } });
  const before = await snapshot(appointment.id); auth.failAudit = true;
  await expect(respondAppointment(token, appointment.id, "CANCELLED")).rejects.toMatchObject({ code: "P2003" });
  expect(await snapshot(appointment.id)).toEqual(before); auth.failAudit = false;
  save("PORTAL_FK_ROLLBACK", { persistedUnchanged: true, code: "P2003" });
});

it("actual END versus actual appointment reschedule waits, retries and denies the stale writer", async () => {
  const { appointment, program } = await fixture();
  let release!: () => void, held!: () => void, blocker = 0;
  const waiting = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { held = r; });
  const end = clients[0].$transaction(async tx => {
    blocker = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
    await completeCenterProgramWork(tx, { userId: head, role: "HEAD_THERAPIST", authVersion: 0 }, center, program!.id,
      { finalSummary: "SYNTHETIC", improvementLevel: "SYNTHETIC", recommendation: "SYNTHETIC", returnToConsultancy: false });
    held(); await waiting;
  }, { isolationLevel: "Serializable", timeout: 15000 });
  await locked;
  const mutation = reschedule(appointment.id).then(() => ({ ok: true, error: "" }), e => ({ ok: false, error: String(e) }));
  let proof: unknown;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await clients[1].$queryRaw<{ pid: number; blockers: number[]; wait_event_type: string; query: string }[]>`SELECT pid,pg_blocking_pids(pid) AS blockers,wait_event_type,query FROM pg_stat_activity WHERE ${blocker}=ANY(pg_blocking_pids(pid))`;
      if (rows[0]?.wait_event_type === "Lock" && rows[0].query.includes("center_programs")) { proof = rows[0]; break; }
      await new Promise(r => setTimeout(r, 25));
    }
    expect(proof).toBeTruthy();
  } finally { release(); }
  await end; const result = await mutation; expect(result.ok).toBe(false);
  expect((await db.centerProgram.findUniqueOrThrow({ where: { id: program!.id } })).operationalCompletedAt).not.toBeNull();
  expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).scheduledAt).toEqual(appointment.scheduledAt);
  expect(await db.auditLog.count({ where: { recordId: appointment.id } })).toBe(0);
  save("END_APPOINTMENT_RACE", { proof, result, persisted: await snapshot(appointment.id) });
});
