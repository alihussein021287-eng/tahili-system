import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { UserRole } from "@prisma/client";
import { createRequire } from "node:module";

// Refuse QA/production before loading the action or connecting. Uses the existing exact-target guard.
const require = createRequire(import.meta.url);
require("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();

// Only the framework session source and Next response/cache APIs are replaced.
// Session validation, effective permissions, patient scope, writes and audit are real DB-backed code.
const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.userId
  ? { user: { id: auth.userId, role: "PROSTHETICS", authVersion: 0 } }
  : null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

const { prisma } = await import("@/lib/db");
const { markReplaced, recordMaintenance, createDevice } = await import("@/app/(app)/devices/actions");
const tag = `m29-${randomUUID().slice(0, 8)}`;
const users: Record<string, string> = {};
const patients: Record<string, string> = {};
let branch = 0, foreignBranch = 0, center = 0, membership = "", device = "";
const evidence: unknown[] = [];

async function snapshot() {
  return {
    devices: await prisma.device.findMany({ orderBy: { id: "asc" } }),
    audits: await prisma.auditLog.findMany({ orderBy: { id: "asc" } }),
    tasks: await prisma.task.findMany({ orderBy: { id: "asc" } }),
    notices: await prisma.notification.findMany({ orderBy: { id: "asc" } }),
    queues: await prisma.queueEntry.findMany({ orderBy: { id: "asc" } }),
    handoffs: await prisma.patientHandoff.findMany({ orderBy: { id: "asc" } }),
  };
}

async function denied(label: string, run: () => Promise<unknown>) {
  const before = await snapshot();
  let rejected = false;
  try { await run(); } catch { rejected = true; }
  const after = await snapshot();
  // Persist even a failing regression's before/after evidence.
  evidence.push({ label, rejected, stateUnchanged: JSON.stringify(before) === JSON.stringify(after), before, after });
  expect(rejected).toBe(true);
  expect(after).toEqual(before);
}

beforeAll(async () => {
  // A fresh database is required, not just the right URL/name.
  expect(await prisma.user.count()).toBe(0);
  expect(await prisma.patient.count()).toBe(0);
  branch = (await prisma.branch.create({ data: { name: `${tag} own` } })).id;
  foreignBranch = (await prisma.branch.create({ data: { name: `${tag} foreign` } })).id;
  center = (await prisma.center.create({ data: { name: `${tag} center` } })).id;
  for (const [key, role, branchId] of [
    ["own", "PROSTHETICS", branch], ["center", "PROSTHETICS", null],
    ["viewer", "VIEWER", branch], ["admin", "ADMIN", null],
  ] as const) {
    const row = await prisma.user.create({ data: {
      username: `${tag}-${key}`, fullName: `${tag} ${key}`, role: role as UserRole,
      branchId, passwordHash: "!not-a-login-secret", needsActivation: false, authVersion: 0,
    } });
    users[key] = row.id;
  }
  for (const [key, branchId] of [["own", branch], ["foreign", foreignBranch]] as const) {
    patients[key] = (await prisma.patient.create({ data: { fullName: `${tag} ${key}`, branchId } })).id;
  }
  membership = (await prisma.centerMembership.create({ data: {
    centerId: center, userId: users.center, role: "DEVICE_OPERATOR", status: "ACTIVE",
    startDate: new Date("2020-01-01"),
  } })).id;
  await prisma.appointment.create({ data: { patientId: patients.foreign, centerId: center, scheduledAt: new Date() } });
});

beforeEach(async () => {
  auth.userId = users.own;
  // Only this brand-new disposable database is mutated by fixtures.
  await prisma.userPermission.deleteMany();
  await prisma.user.update({ where: { id: users.center }, data: { isActive: true } });
  await prisma.centerMembership.update({ where: { id: membership }, data: {
    status: "ACTIVE", startDate: new Date("2020-01-01"), endDate: null,
  } });
  device = (await prisma.device.create({ data: {
    patientId: patients.own, type: `${tag} device`, nextMaintenanceAt: new Date("2030-01-01"),
  } })).id;
});

afterAll(async () => {
  if (process.env.DEVICE_SCOPE_EVIDENCE_FILE) {
    writeFileSync(process.env.DEVICE_SCOPE_EVIDENCE_FILE, JSON.stringify({ tag, evidence }, null, 2));
  }
  await prisma.$disconnect();
});

describe("device replacement: direct action with real permission/scope and persisted state", () => {
  it("allows PROSTHETICS in own active branch and writes one attributable audit", async () => {
    const before = await snapshot();
    await markReplaced(device);
    const after = await snapshot();
    const row = await prisma.device.findUniqueOrThrow({ where: { id: device } });
    expect(row.status).toBe("REPLACED");
    expect(row.nextMaintenanceAt).toBeNull();
    expect(after.audits.length).toBe(before.audits.length + 1);
    expect(after.audits.at(-1)).toMatchObject({ userId: users.own, action: "UPDATE", tableName: "devices", recordId: device });
    evidence.push({ label: "own-branch-allowed", before, after });
  });

  it("denies a role without devices.maintain", async () => {
    auth.userId = users.viewer;
    await denied("missing-role-permission", () => markReplaced(device));
  });

  it("honors an explicit effective-permission denial for PROSTHETICS", async () => {
    await prisma.userPermission.create({ data: { userId: users.own, permKey: "devices.maintain", allowed: false } });
    await denied("explicit-permission-denial", () => markReplaced(device));
  });

  it("denies missing patients.view even with devices.maintain", async () => {
    await prisma.userPermission.create({ data: { userId: users.own, permKey: "patients.view", allowed: false } });
    await denied("missing-record-permission", () => markReplaced(device));
  });

  it("denies the original branchless operator / foreign device reproduction", async () => {
    auth.userId = users.center; // Membership exists, but the device's patient has NO relation to that center.
    await denied("original-foreign-device-scope", () => markReplaced(device));
  });

  it("denies foreign-branch replacement without any operational relationship", async () => {
    await prisma.device.update({ where: { id: device }, data: { patientId: patients.foreign } });
    await denied("foreign-branch-no-relation", () => markReplaced(device));
  });

  it("preserves valid cross-branch center/appointment scope", async () => {
    auth.userId = users.center;
    await prisma.device.update({ where: { id: device }, data: { patientId: patients.foreign } });
    await markReplaced(device);
    expect(await prisma.device.findUniqueOrThrow({ where: { id: device } })).toMatchObject({ status: "REPLACED", patientId: patients.foreign });
  });

  it.each(["expired", "suspended", "future"] as const)("denies %s center-only eligibility", async (kind) => {
    auth.userId = users.center;
    await prisma.device.update({ where: { id: device }, data: { patientId: patients.foreign } });
    await prisma.centerMembership.update({ where: { id: membership }, data: kind === "expired"
      ? { endDate: new Date("2020-01-02") }
      : kind === "suspended" ? { status: "SUSPENDED" } : { startDate: new Date("2100-01-01") } });
    await denied(`${kind}-center-only-membership`, () => markReplaced(device));
  });

  it("does not invent a membership requirement when own branch independently authorizes", async () => {
    await prisma.centerMembership.create({ data: {
      userId: users.own, centerId: center, role: "DEVICE_OPERATOR", startDate: new Date("2020-01-01"), endDate: new Date("2020-01-02"),
    } });
    await markReplaced(device);
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device } })).status).toBe("REPLACED");
  });

  it("denies inactive accounts and unauthenticated direct calls", async () => {
    auth.userId = users.center;
    await prisma.user.update({ where: { id: users.center }, data: { isActive: false } });
    await denied("inactive-account", () => markReplaced(device));
    auth.userId = "";
    await denied("no-session", () => markReplaced(device));
  });

  it("missing device produces neither mutation nor a success audit", async () => {
    await denied("missing-device", () => markReplaced(`${tag}-missing`));
  });

  it("ADMIN with effective permissions retains the existing global scope", async () => {
    auth.userId = users.admin;
    await prisma.device.update({ where: { id: device }, data: { patientId: patients.foreign } });
    await markReplaced(device);
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device } })).status).toBe("REPLACED");
  });

  it("neighboring create and maintenance keep their valid writes and foreign-scope denials", async () => {
    const fd = new FormData();
    fd.set("patientId", patients.own); fd.set("type", `${tag} created`);
    await expect(createDevice(fd)).rejects.toThrow("REDIRECT:");
    expect(await prisma.device.count({ where: { type: `${tag} created` } })).toBe(1);
    const m = new FormData(); m.set("nextMaintenanceAt", "2031-01-01");
    await recordMaintenance(device, m);
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device } })).status).toBe("MAINTAINED");
    fd.set("patientId", patients.foreign);
    await denied("neighbor-create-foreign", () => createDevice(fd));
    await prisma.device.update({ where: { id: device }, data: { patientId: patients.foreign } });
    await denied("neighbor-maintenance-foreign", () => recordMaintenance(device, m));
  });

  it("rechecks membership if revocation commits after device lookup but before scope evaluation", async () => {
    auth.userId = users.center;
    await prisma.device.update({ where: { id: device }, data: { patientId: patients.foreign } });
    // Controlled interleaving: the real lookup runs, then a separate connection commits revocation.
    // No guard or permission decision is stubbed. This is NOT a claim about revocation after the scope check.
    const { PrismaClient } = await import("@prisma/client");
    const revoker = new PrismaClient();
    const lookup = prisma.device.findUnique.bind(prisma.device);
    const spy = vi.spyOn(prisma.device, "findUnique").mockImplementationOnce((args) => {
      // Keep Prisma's fluent client return type; delay only resolution of its real query.
      const query = lookup(args);
      const then = query.then.bind(query);
      query.then = (onfulfilled, onrejected) => then(async (row) => {
        await revoker.centerMembership.update({ where: { id: membership }, data: { status: "INACTIVE" } });
        return row;
      }).then(onfulfilled, onrejected);
      return query;
    });
    try {
      await denied("committed-revocation-before-scope-check", () => markReplaced(device));
    } finally { spy.mockRestore(); await revoker.$disconnect(); }
  });
});
