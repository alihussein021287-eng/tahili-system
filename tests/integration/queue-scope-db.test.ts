import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { transitionQueueEntry } from "@/lib/queue-transitions";

// Rehearsal database only (guarded). Synthetic m083q-* fixtures, default RECEPTION permission set.
const prisma = new PrismaClient();
const tag = `m083q-${randomUUID().slice(0, 8)}`;
let a = 0, b = 0, dead = 0;
let recA: { id: string }, recB: { id: string }, recNone: { id: string }, recDead: { id: string }, admin: { id: string }, mgr: { id: string };
const RECEPTION_PERMS = new Set(["queue.view", "queue.manage"]);

const call = (u: { id: string }, role: any, entryId: string, to: any = "CALLED", perms: Set<string> = RECEPTION_PERMS) =>
  prisma.$transaction((tx) => transitionQueueEntry(tx, { userId: u.id, role, permissions: perms }, entryId, to));
const patient = async (branchId: number | null) => (await prisma.patient.create({ data: { fullName: `${tag} ${randomUUID().slice(0, 6)}`, branchId } })).id;
const entry = async (patientId: string, branchId: number | null = null) => (await prisma.queueEntry.create({ data: { patientId, branchId, status: "WAITING" } })).id;
const status = async (id: string) => (await prisma.queueEntry.findUniqueOrThrow({ where: { id } })).status;
const audits = (id: string) => prisma.auditLog.count({ where: { recordId: id, tableName: "queue_entries" } });

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  a = (await prisma.branch.create({ data: { name: `${tag} A` } })).id;
  b = (await prisma.branch.create({ data: { name: `${tag} B` } })).id;
  dead = (await prisma.branch.create({ data: { name: `${tag} dead`, isActive: false } })).id;
  const mk = (role: any, branchId: number | null, n: string) => prisma.user.create({ data: { username: `${tag}-${n}`, fullName: `${tag} ${n}`, role, branchId, passwordHash: "!" } });
  recA = await mk("RECEPTION", a, "recA"); recB = await mk("RECEPTION", b, "recB"); recNone = await mk("RECEPTION", null, "recNone");
  recDead = await mk("RECEPTION", dead, "recDead"); admin = await mk("ADMIN", null, "admin"); mgr = await mk("MANAGER", null, "mgr");
});
afterAll(async () => {
  await prisma.user.updateMany({ where: { username: { startsWith: tag } }, data: { isActive: false } });
  await prisma.$disconnect();
});

describe("queue scope (database, default permissions)", () => {
  it("own active branch is allowed, another branch is denied without state or audit change", async () => {
    const e = await entry(await patient(a));
    const before = await audits(e);
    await expect(call(recB, "RECEPTION", e)).rejects.toThrow();
    expect(await status(e)).toBe("WAITING");
    expect(await audits(e)).toBe(before);
    await expect(call(recA, "RECEPTION", e)).resolves.toMatchObject({ changed: true, status: "CALLED" });
    expect(await audits(e)).toBe(before + 1);
  });

  it("a branchless reception account has no global authority", async () => {
    const e = await entry(await patient(a));
    await expect(call(recNone, "RECEPTION", e)).rejects.toThrow();
    expect(await status(e)).toBe("WAITING");
  });

  it("an inactive branch confers no authority, even over its own patients", async () => {
    const e = await entry(await patient(dead));
    await expect(call(recDead, "RECEPTION", e)).rejects.toThrow();
    expect(await status(e)).toBe("WAITING");
  });

  it("a branchless patient is not an automatic allow: only the branch recorded on the entry counts", async () => {
    const p = await patient(null);
    const own = await entry(p, a);
    const unknown = await entry(p, null);
    await expect(call(recA, "RECEPTION", own)).resolves.toMatchObject({ status: "CALLED" });
    await expect(call(recB, "RECEPTION", await entry(p, a))).rejects.toThrow();
    await expect(call(recA, "RECEPTION", unknown)).rejects.toThrow();
    await expect(call(recNone, "RECEPTION", unknown)).rejects.toThrow();
    expect(await status(unknown)).toBe("WAITING");
  });

  it("viewing permission is not modification: a manager with central view is denied; ADMIN keeps authority", async () => {
    const e = await entry(await patient(a));
    await expect(call(mgr, "MANAGER", e, "CALLED", new Set(["queue.manage", "centers.central.view"]))).rejects.toThrow();
    expect(await status(e)).toBe("WAITING");
    await expect(call(admin, "ADMIN", e, "CALLED", new Set(["queue.manage"]))).resolves.toMatchObject({ status: "CALLED" });
  });

  it("normal progression works and DONE is terminal", async () => {
    const e = await entry(await patient(a));
    await call(recA, "RECEPTION", e, "CALLED");
    await call(recA, "RECEPTION", e, "IN_SESSION");
    await call(recA, "RECEPTION", e, "DONE");
    const done = await audits(e);
    await expect(call(recA, "RECEPTION", e, "CALLED")).rejects.toThrow();
    await expect(call(recA, "RECEPTION", e, "WAITING")).rejects.toThrow();
    expect(await status(e)).toBe("DONE");
    expect(await audits(e)).toBe(done);
  });
});

describe("queue figures follow the verified viewer scope (database)", () => {
  it("counts and lists never widen through a requested branch, a missing branch or legacy rows", async () => {
    const { queueViewerWhere } = await import("@/lib/queue-viewer");
    const pa = await patient(a), pb = await patient(b), pn = await patient(null), pl = await patient(null);
    const ids = [await entry(pa), await entry(pb), await entry(pn, a), await entry(pl, null)];
    const visible = async (u: { id: string }, role: any, requested: number | null = null) =>
      (await prisma.queueEntry.findMany({ where: { id: { in: ids }, ...(await queueViewerWhere({ userId: u.id, role }, requested)) }, select: { id: true } })).map((r) => r.id);
    // Own branch: its patient and the unbranched patient queued under its branch; a requested other branch changes nothing.
    expect((await visible(recA, "RECEPTION")).sort()).toEqual([ids[0], ids[2]].sort());
    expect((await visible(recA, "RECEPTION", b)).sort()).toEqual([ids[0], ids[2]].sort());
    expect(await visible(recB, "RECEPTION", a)).toEqual([ids[1]]);
    // No branch or an inactive branch: nothing, including legacy rows.
    expect(await visible(recNone, "RECEPTION")).toEqual([]);
    expect(await visible(recDead, "RECEPTION")).toEqual([]);
    // ADMIN: everything, and may narrow by branch; the legacy row only appears in the unfiltered view.
    expect((await visible(admin, "ADMIN")).sort()).toEqual([...ids].sort());
    expect((await visible(admin, "ADMIN", b)).sort()).toEqual([ids[1]]);
    expect(await visible(mgr, "MANAGER", a)).toEqual([]);
  });
});

describe("explicit receiving branch is authoritative (database)", () => {
  it("an entry recorded for branch B is operable by B and not by the patient's home branch A", async () => {
    const p = await patient(a);
    const e = await entry(p, b);
    await expect(call(recA, "RECEPTION", e)).rejects.toThrow();
    expect(await status(e)).toBe("WAITING");
    await expect(call(recB, "RECEPTION", e)).resolves.toMatchObject({ status: "CALLED" });
  });

  it("visit visibility follows the recorded receiving branch and never the home branch for explicit visits", async () => {
    const { visitScopeWhere } = await import("@/lib/patient-access");
    const p = await patient(a);
    const crossVisit = await prisma.visit.create({ data: { patientId: p, branchId: b, visitDate: new Date() } });
    const legacyVisit = await prisma.visit.create({ data: { patientId: p, branchId: null, visitDate: new Date() } });
    const seen = async (u: { id: string }, role: any) => {
      const where = await visitScopeWhere(prisma, { userId: u.id, role, permissions: new Set(["visits.view", "patients.view"]) });
      return (await prisma.visit.findMany({ where: { id: { in: [crossVisit.id, legacyVisit.id] }, AND: [where] }, select: { id: true } })).map((r) => r.id).sort();
    };
    expect(await seen(recB, "RECEPTION")).toEqual([crossVisit.id]);
    expect(await seen(recA, "RECEPTION")).toEqual([legacyVisit.id]);
    expect(await seen(recNone, "RECEPTION")).toEqual([]);
    expect((await seen(admin, "ADMIN")).sort()).toEqual([crossVisit.id, legacyVisit.id].sort());
  });
});
