import { afterAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
const state = vi.hoisted((): {
  userId: string; membershipReads: number;
  afterMembershipRead?: (read: number) => Promise<void>;
  beforeUpdate?: () => Promise<void>; failAudit: boolean; sql: string[];
} => ({ userId: "", membershipReads: 0, failAudit: false, sql: [] }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: state.userId, role: "PROSTHETICS", authVersion: 0 } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", event => { state.sql.push(event.query); }); // SQL text only, never parameters/session material.
  return { prisma: client.$extends({ query: {
    centerMembership: { async findMany({ args, query }) {
      const rows = await query(args);
      if (state.afterMembershipRead) await state.afterMembershipRead(++state.membershipReads);
      return rows;
    } },
    device: { async updateMany({ args, query }) {
      if (state.beforeUpdate) await state.beforeUpdate();
      return query(args);
    } },
    auditLog: { async create({ args, query }) {
      // A real PostgreSQL FK error AFTER the device SQL, not a stubbed success/failure of authorization.
      if (state.failAudit) args.data.userId = "m30r1-nonexistent-synthetic-actor";
      return query(args);
    } },
  } }) };
});
const { prisma } = await import("@/lib/db");
const { PrismaClient } = await import("@prisma/client");
const writer = new PrismaClient();
const observer = new PrismaClient();
const { markReplaced } = await import("@/app/(app)/devices/actions");
const evidence: unknown[] = [];
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

async function fixture(ownBranch = false) {
  state.afterMembershipRead = undefined; state.beforeUpdate = undefined; state.failAudit = false; state.membershipReads = 0;
  const tag = `m30r1-${randomUUID().slice(0, 8)}`;
  const center = await writer.center.create({ data: { name: tag } });
  const branch = await writer.branch.create({ data: { name: tag } });
  const user = await writer.user.create({ data: {
    username: tag, fullName: tag, role: "PROSTHETICS", branchId: ownBranch ? branch.id : null,
    passwordHash: "!synthetic-not-a-login", needsActivation: false, authVersion: 0,
  } });
  const patient = await writer.patient.create({ data: { fullName: tag, branchId: branch.id } });
  const membership = await writer.centerMembership.create({ data: {
    userId: user.id, centerId: center.id, role: "DEVICE_OPERATOR", status: "ACTIVE", startDate: new Date("2020-01-01"),
  } });
  const appointment = await writer.appointment.create({ data: { patientId: patient.id, centerId: center.id, scheduledAt: new Date() } });
  const device = await writer.device.create({ data: { patientId: patient.id, type: tag, nextMaintenanceAt: new Date("2030-01-01") } });
  state.userId = user.id;
  return { user, patient, membership, appointment, device };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function snapshot(f: Fixture) {
  return {
    device: await observer.device.findUniqueOrThrow({ where: { id: f.device.id } }),
    audits: await observer.auditLog.findMany({ where: { recordId: f.device.id }, orderBy: { id: "asc" } }),
    appointments: await observer.appointment.findMany({ where: { patientId: f.patient.id }, orderBy: { id: "asc" } }),
    tasks: await observer.task.findMany({ where: { patientId: f.patient.id } }),
    queue: await observer.queueEntry.findMany({ where: { patientId: f.patient.id } }),
    handoffs: await observer.patientHandoff.findMany({ where: { patientId: f.patient.id } }),
    notices: await observer.notification.findMany({ orderBy: { id: "asc" } }),
  };
}
async function outcome(f: Fixture) {
  try { await markReplaced(f.device.id); return { committed: true, error: null }; }
  catch (error) { return { committed: false, error: error instanceof Error ? error.message : "error" }; }
}
type Block = { pid: number; blockers: number[]; wait_event_type: string; query: string };
async function blocked() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await observer.$queryRaw<Block[]>`SELECT pid, pg_blocking_pids(pid) AS blockers, wait_event_type, query
      FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`;
    if (rows.length) return rows;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Expected real PostgreSQL lock wait was not observed");
}
async function unchanged(label: string, f: Fixture) {
  const before = await snapshot(f), result = await outcome(f), after = await snapshot(f);
  evidence.push({ label, before, result, after });
  expect(result.committed).toBe(false); expect(after).toEqual(before);
}

describe("device replacement transaction: actual PostgreSQL ordering", () => {
  it("keeps patient-scope predicates inside the single database UPDATE", async () => {
    const f = await fixture(), start = state.sql.length;
    expect((await outcome(f)).committed).toBe(true);
    const sql = state.sql.slice(start);
    const updates = sql.filter(q => /^UPDATE\s+"public"\."Device"/.test(q));
    evidence.push({ label: "atomic-scope-sql", sql });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('"patients"');
    expect(updates[0]).toContain('"appointments"');
    expect(updates[0]).toContain('WHERE');
    expect(sql.some(q => q === "COMMIT")).toBe(true);
  });
  it.each([false, true])("allows existing scope (own branch=%s), with exactly one atomic audit", async own => {
    const f = await fixture(own);
    // An actual different home branch, not merely a branchless operator with a center relationship.
    const actorBranchId = own ? f.patient.branchId : (await writer.branch.create({ data: { name: `${f.user.username}-other-branch` } })).id;
    if (!own) await writer.user.update({ where: { id: f.user.id }, data: { branchId: actorBranchId } });
    const before = await snapshot(f), result = await outcome(f), after = await snapshot(f);
    evidence.push({ label: own ? "own-branch" : "cross-branch-center", actorBranchId, patientBranchId: f.patient.branchId, before, result, after });
    expect(result.committed).toBe(true); expect(after.device.status).toBe("REPLACED");
    expect(after.device.nextMaintenanceAt).toBeNull(); expect(after.audits).toHaveLength(1);
    expect(after.audits[0]).toMatchObject({ userId: f.user.id, action: "UPDATE", recordId: f.device.id });
    expect(after.appointments).toEqual(before.appointments);
  });

  it("revocation-first: an actual lock wait ends in fresh denial after the writer commits", async () => {
    const f = await fixture(), before = await snapshot(f), held = gate(), release = gate();
    let writerPid = 0;
    const revocation = writer.$transaction(async tx => {
      writerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      await tx.centerMembership.update({ where: { id: f.membership.id }, data: { status: "INACTIVE", endDate: new Date() } });
      held.release(); await release.promise;
    }, { timeout: 12000 });
    await held.promise;
    const replacement = outcome(f);
    let waits: Block[] = [];
    try { waits = await blocked(); expect(waits.some(r => r.blockers.includes(writerPid))).toBe(true); }
    finally { release.release(); await revocation; }
    const result = await replacement, after = await snapshot(f);
    evidence.push({ label: "revoke-first", writerPid, waits, before, result, after });
    expect(result.committed).toBe(false); expect(after).toEqual(before);
  });

  for (const position of ["after-scope-before-write", "during-membership-scope-read"] as const) {
    it(`replacement-first: revocation really waits (${position})`, async () => {
      const f = await fixture(), before = await snapshot(f), authority = gate(), release = gate();
      const hold = async () => { authority.release(); await release.promise; };
      if (position === "after-scope-before-write") state.beforeUpdate = hold;
      else state.afterMembershipRead = async read => { if (read === 2) await hold(); };
      const replacement = outcome(f);
      await authority.promise;
      let revocationCommitted = false;
      const revocation = writer.centerMembership.update({ where: { id: f.membership.id }, data: { status: "INACTIVE", endDate: new Date() } })
        .then(() => { revocationCommitted = true; });
      let waits: Block[] = [];
      try {
        waits = await blocked(); expect(revocationCommitted).toBe(false);
        expect(waits.some(r => r.query.includes('UPDATE') && r.query.includes('center_memberships'))).toBe(true);
        expect(await snapshot(f)).toEqual(before);
      } finally { release.release(); }
      const result = await replacement; await revocation;
      const after = await snapshot(f);
      evidence.push({ label: position, waits, before, result, after, revocationCommitted });
      expect(result.committed).toBe(true); expect(revocationCommitted).toBe(true);
      expect(after.device.status).toBe("REPLACED"); expect(after.audits).toHaveLength(1);
      expect((await observer.centerMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).status).toBe("INACTIVE");
      state.beforeUpdate = undefined; state.afterMembershipRead = undefined;
      await unchanged(`${position}-new-request-denied`, f);
    });
  }

  it.each(["expired", "revoked"] as const)("denies %s membership before start", async kind => {
    const f = await fixture();
    await writer.centerMembership.update({ where: { id: f.membership.id }, data: kind === "expired"
      ? { endDate: new Date("2020-01-02") } : { status: "INACTIVE" } });
    await unchanged(kind, f);
  });

  it("direct Server Action outside patient scope cannot modify anything", async () => {
    const f = await fixture();
    await writer.appointment.delete({ where: { id: f.appointment.id } });
    await unchanged("outside-scope-direct-action", f);
  });

  it("revalidates a permission revoked after the preliminary guard", async () => {
    const f = await fixture();
    state.afterMembershipRead = async read => { if (read === 1) {
      await writer.userPermission.create({ data: { userId: f.user.id, permKey: "devices.maintain", allowed: false } });
    } };
    await unchanged("permission-revalidation", f);
  });

  it("permission deny insertion waits until authorized replacement commits", async () => {
    const f = await fixture(), held = gate(), release = gate();
    state.beforeUpdate = async () => { held.release(); await release.promise; };
    const replacement = outcome(f); await held.promise;
    let committed = false;
    const deny = writer.userPermission.create({ data: { userId: f.user.id, permKey: "devices.maintain", allowed: false } })
      .then(() => { committed = true; });
    let waits: Block[] = [];
    try { waits = await blocked(); expect(committed).toBe(false); }
    finally { release.release(); }
    const result = await replacement; await deny;
    const after = await snapshot(f);
    evidence.push({ label: "permission-insert-order", waits, result, after, committed });
    expect(result.committed).toBe(true); expect(committed).toBe(true);
    state.beforeUpdate = undefined;
    await unchanged("new-request-after-permission-denial", f);
  });

  it("removal of the sole appointment before UPDATE is checked by the SQL predicate", async () => {
    const f = await fixture();
    const before = await snapshot(f);
    state.beforeUpdate = async () => { await writer.appointment.delete({ where: { id: f.appointment.id } }); };
    const result = await outcome(f), after = await snapshot(f);
    evidence.push({ label: "relationship-removal-before-statement", before, result, after });
    expect(result.committed).toBe(false); expect(after.device).toEqual(before.device);
    expect(after.audits).toEqual(before.audits); expect(after.appointments).toHaveLength(0);
    expect(after.tasks).toEqual(before.tasks); expect(after.notices).toEqual(before.notices);
  });

  it("database audit failure rolls back the real preceding device SQL", async () => {
    const f = await fixture(); state.failAudit = true;
    await unchanged("audit-fk-failure-rollback", f);
  });
});

afterAll(async () => {
  if (process.env.DEVICE_CONCURRENCY_EVIDENCE_FILE) writeFileSync(process.env.DEVICE_CONCURRENCY_EVIDENCE_FILE, JSON.stringify({ evidence, sql: state.sql }, null, 2));
  await prisma.$disconnect(); await writer.$disconnect(); await observer.$disconnect();
});
