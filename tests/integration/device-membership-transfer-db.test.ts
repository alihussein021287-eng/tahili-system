import { afterAll, describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";

createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
type Context = { userId: string; role: UserRole; kind: "membership" | "device" };
const h = vi.hoisted((): {
  context?: AsyncLocalStorage<Context>; afterMembershipUpdate?: () => Promise<void>;
  beforeDeviceUpdate?: () => Promise<void>; failMembershipAudit: boolean; sql: string[];
} => ({ failMembershipAudit: false, sql: [] }));
h.context = new AsyncLocalStorage<Context>();
vi.mock("next-auth", () => ({ getServerSession: async () => {
  const actor = h.context?.getStore();
  return actor ? { user: { id: actor.userId, role: actor.role, authVersion: 0 } } : null;
} }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", event => h.sql.push(event.query)); // No parameters, credentials or sessions.
  return { prisma: client.$extends({ query: {
    centerMembership: { async update({ args, query }) {
      const row = await query(args);
      if (h.context?.getStore()?.kind === "membership" && h.afterMembershipUpdate) await h.afterMembershipUpdate();
      return row;
    } },
    device: { async updateMany({ args, query }) {
      if (h.context?.getStore()?.kind === "device" && h.beforeDeviceUpdate) await h.beforeDeviceUpdate();
      return query(args);
    } },
    auditLog: { async create({ args, query }) {
      if (h.failMembershipAudit && h.context?.getStore()?.kind === "membership") args.data.userId = "m31r1-missing-synthetic-user";
      return query(args);
    } },
  } }) };
});
const { prisma } = await import("@/lib/db");
const { PrismaClient } = await import("@prisma/client");
const observer = new PrismaClient();
const { markReplaced } = await import("@/app/(app)/devices/actions");
const { updateUserCenterMembership, placeUserInCenter } = await import("@/app/(app)/users/actions");
const evidence: unknown[] = [];
const gate = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };

async function fixture(role: UserRole = "PROSTHETICS") {
  h.afterMembershipUpdate = undefined; h.beforeDeviceUpdate = undefined; h.failMembershipAudit = false;
  const tag = `m31r1-${randomUUID().slice(0, 8)}`;
  const admin = await observer.user.create({ data: { username: `${tag}-admin`, fullName: tag, role: "ADMIN", passwordHash: "!synthetic", authVersion: 0, needsActivation: false }, select: { id: true, role: true } });
  const actor = await observer.user.create({ data: { username: `${tag}-staff`, fullName: tag, role, passwordHash: "!synthetic", authVersion: 0, needsActivation: false }, select: { id: true, role: true, branchId: true, authVersion: true } });
  const oldCenter = await observer.center.create({ data: { name: `${tag}-old` } });
  const newCenter = await observer.center.create({ data: { name: `${tag}-new` } });
  const branch = await observer.branch.create({ data: { name: tag } });
  const patient = await observer.patient.create({ data: { fullName: tag, branchId: branch.id } });
  const membershipRole = role === "DOCTOR" ? "SPECIALIST" : "DEVICE_OPERATOR";
  const membership = await observer.centerMembership.create({ data: { userId: actor.id, centerId: oldCenter.id, role: membershipRole, status: "ACTIVE", startDate: new Date("2020-01-01") } });
  await observer.appointment.create({ data: { patientId: patient.id, centerId: oldCenter.id, scheduledAt: new Date() } });
  const device = await observer.device.create({ data: { patientId: patient.id, type: tag, nextMaintenanceAt: new Date("2030-01-01") } });
  const form = new FormData(); form.set("centerId", String(newCenter.id)); form.set("role", membershipRole); form.set("specialty", "synthetic transfer");
  return { admin, actor, oldCenter, newCenter, patient, membership, device, form, membershipRole };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function snapshot(f: Fixture) {
  return {
    user: await observer.user.findUniqueOrThrow({ where: { id: f.actor.id }, select: { id: true, role: true, branchId: true, authVersion: true, isActive: true } }),
    patient: await observer.patient.findUniqueOrThrow({ where: { id: f.patient.id }, select: { id: true, branchId: true, createdById: true } }),
    device: await observer.device.findUniqueOrThrow({ where: { id: f.device.id } }),
    memberships: await observer.centerMembership.findMany({ where: { userId: f.actor.id }, orderBy: { id: "asc" } }),
    audits: await observer.auditLog.findMany({ where: { OR: [{ recordId: f.device.id }, { tableName: "center_memberships", newValue: { path: ["userId"], equals: f.actor.id } }] }, orderBy: { id: "asc" } }),
    appointments: await observer.appointment.findMany({ where: { patientId: f.patient.id } }),
    tasks: await observer.task.findMany({ where: { patientId: f.patient.id } }),
    handoffs: await observer.patientHandoff.findMany({ where: { patientId: f.patient.id } }),
    queues: await observer.queueEntry.findMany({ where: { patientId: f.patient.id } }),
    notices: await observer.notification.findMany({ orderBy: { id: "asc" } }),
  };
}
const settle = async (fn: () => Promise<unknown>) => {
  try { await fn(); return { committed: true, code: null, error: null }; }
  catch (e) { return { committed: false, code: e && typeof e === "object" && "code" in e ? String(e.code) : null, error: e instanceof Error ? e.message : String(e) }; }
};
const deviceAction = (f: Fixture) => settle(() => h.context!.run({ userId: f.actor.id, role: f.actor.role, kind: "device" }, () => markReplaced(f.device.id)));
const transferAction = (f: Fixture, placement = false) => settle(() => h.context!.run({ userId: f.admin.id, role: f.admin.role, kind: "membership" }, () => placement ? placeUserInCenter(f.actor.id, f.form) : updateUserCenterMembership(f.actor.id, f.membership.id, f.form)));
type Wait = { pid: number; blockers: number[]; query: string; wait_event_type: string | null };
async function accountWait() {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const rows = await observer.$queryRaw<Wait[]>`SELECT pid, pg_blocking_pids(pid) AS blockers, query, wait_event_type
      FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`;
    const account = rows.filter(row => row.query.includes("FROM users") && row.query.includes("FOR UPDATE"));
    if (account.length) return account;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Actual PostgreSQL account-lock wait not observed");
}
function unrelatedStable(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) {
  for (const key of ["user", "patient", "appointments", "tasks", "handoffs", "queues", "notices"] as const) expect(after[key]).toEqual(before[key]);
}
function transferred(f: Fixture, after: Awaited<ReturnType<typeof snapshot>>) {
  expect(after.memberships).toHaveLength(2);
  expect(after.memberships.find(m => m.id === f.membership.id)).toMatchObject({ status: "INACTIVE" });
  expect(after.memberships.find(m => m.id === f.membership.id)?.endDate).toBeInstanceOf(Date);
  expect(after.memberships.find(m => m.centerId === f.newCenter.id)).toMatchObject({ userId: f.actor.id, role: f.membershipRole, status: "ACTIVE", endDate: null, specialty: "synthetic transfer" });
  const audits = after.audits.filter(a => a.tableName === "center_memberships");
  expect(audits).toHaveLength(1);
  expect(audits[0].newValue).toMatchObject({ userId: f.actor.id, centerId: f.newCenter.id, role: f.membershipRole, placement: "updated" });
}

describe("device and actual membership actions use account-before-membership ordering", () => {
  it("device first: real membership transfer waits, then both commit once without a deadlock", async () => {
    const f = await fixture(), before = await snapshot(f), held = gate(), release = gate();
    h.beforeDeviceUpdate = async () => { held.release(); await release.promise; };
    const replacement = deviceAction(f); await held.promise;
    let transferFinished = false;
    const moving = transferAction(f).then(outcome => { transferFinished = true; return outcome; });
    let waits: Wait[] = [];
    try { waits = await accountWait(); expect(transferFinished).toBe(false); expect(await snapshot(f)).toEqual(before); }
    finally { release.release(); }
    const [deviceOutcome, transferOutcome] = await Promise.all([replacement, moving]), after = await snapshot(f);
    evidence.push({ label: "device-first", before, waits, deviceOutcome, transferOutcome, after });
    expect(deviceOutcome.committed).toBe(true); expect(transferOutcome.committed).toBe(true);
    expect(after.device).toMatchObject({ status: "REPLACED", nextMaintenanceAt: null, patientId: f.patient.id, createdById: before.device.createdById });
    expect(after.audits.filter(a => a.tableName === "devices")).toHaveLength(1);
    transferred(f, after); unrelatedStable(before, after);
  });

  it("membership first: replacement waits for the actual transfer and denies obsolete eligibility", async () => {
    const f = await fixture(), before = await snapshot(f), held = gate(), release = gate();
    h.afterMembershipUpdate = async () => { held.release(); await release.promise; };
    const moving = transferAction(f); await held.promise;
    const replacement = deviceAction(f);
    let waits: Wait[] = [];
    try { waits = await accountWait(); expect(await snapshot(f)).toEqual(before); }
    finally { release.release(); }
    const [deviceOutcome, transferOutcome] = await Promise.all([replacement, moving]), after = await snapshot(f);
    evidence.push({ label: "membership-first", before, waits, deviceOutcome, transferOutcome, after });
    expect(transferOutcome.committed).toBe(true); expect(deviceOutcome.committed).toBe(false);
    expect(deviceOutcome.error).not.toMatch(/40P01|deadlock/i);
    expect(deviceOutcome.code).not.toBe("P2034");
    expect(after.device).toEqual(before.device); expect(after.audits.filter(a => a.tableName === "devices")).toHaveLength(0);
    transferred(f, after); unrelatedStable(before, after);
  });

  it.each(["DOCTOR", "PROSTHETICS"] as const)("placement preserves existing single/multiple-center semantics for %s", async role => {
    const f = await fixture(role), before = await snapshot(f), outcome = await transferAction(f, true), after = await snapshot(f);
    evidence.push({ label: `placement-${role}`, before, outcome, after });
    expect(outcome.committed).toBe(true); expect(after.memberships).toHaveLength(2);
    expect(after.memberships.find(m => m.id === f.membership.id)?.status).toBe(role === "DOCTOR" ? "INACTIVE" : "ACTIVE");
    expect(after.memberships.find(m => m.centerId === f.newCenter.id)).toMatchObject({ status: "ACTIVE", role: f.membershipRole });
    expect(after.audits).toHaveLength(1); expect(after.audits[0].newValue).toMatchObject({ placement: "active", userId: f.actor.id });
    expect(after.device).toEqual(before.device); unrelatedStable(before, after);
  });

  it("a real membership-audit failure rolls back old/new placements without duplicate or partial writes", async () => {
    const f = await fixture(), before = await snapshot(f); h.failMembershipAudit = true;
    const outcome = await transferAction(f), after = await snapshot(f);
    evidence.push({ label: "membership-audit-rollback", before, outcome, after });
    expect(outcome.committed).toBe(false); expect(outcome.code).toBe("P2003"); expect(after).toEqual(before);
  });
});

afterAll(async () => {
  if (process.env.MEMBERSHIP_TRANSFER_EVIDENCE_FILE) writeFileSync(process.env.MEMBERSHIP_TRANSFER_EVIDENCE_FILE, JSON.stringify({ evidence, sql: h.sql }, null, 2));
  await prisma.$disconnect(); await observer.$disconnect();
});
