import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { canAccessPatientRecord, exactIdentifierLookup, patientScopeWhere } from "@/lib/patient-access";

// Rehearsal database only (guarded). Synthetic m083a3-* fixtures, DEFAULT-like permission sets.
const prisma = new PrismaClient();
const tag = `m083a3-${randomUUID().slice(0, 8)}`;
let A = 0, B = 0, dead = 0, C = 0, C2 = 0;
const U: Record<string, { id: string }> = {};
const P: Record<string, { id: string; phone: string | null; fileNumber: number; fullName: string }> = {};
const perms = (...extra: string[]) => new Set(["patients.view", ...extra]);
const can = (who: string, role: any, patient: string, p = perms()) =>
  canAccessPatientRecord(prisma, { userId: U[who].id, role, permissions: p }, P[patient].id);

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  A = (await prisma.branch.create({ data: { name: `${tag} A` } })).id;
  B = (await prisma.branch.create({ data: { name: `${tag} B` } })).id;
  dead = (await prisma.branch.create({ data: { name: `${tag} dead`, isActive: false } })).id;
  C = (await prisma.center.create({ data: { name: `${tag} c1` } })).id;
  C2 = (await prisma.center.create({ data: { name: `${tag} c2` } })).id;
  const mk = async (n: string, role: any, branchId: number | null) => {
    U[n] = await prisma.user.create({ data: { username: `${tag}-${n}`, fullName: `${tag} ${n}`, role, branchId, passwordHash: "!" } });
  };
  await mk("recA", "RECEPTION", A); await mk("recB", "RECEPTION", B); await mk("recNone", "RECEPTION", null); await mk("recDead", "RECEPTION", dead);
  await mk("de", "DATA_ENTRY", A); await mk("secretary", "SECRETARY", B); await mk("doctor", "DOCTOR", null); await mk("referee", "HEAD_THERAPIST", null); await mk("admin", "ADMIN", null);
  await prisma.centerMembership.createMany({ data: [
    { centerId: C, userId: U.secretary.id, role: "SECRETARY", status: "ACTIVE" },
    { centerId: C, userId: U.doctor.id, role: "SPECIALIST", status: "ACTIVE" },
    { centerId: C2, userId: U.referee.id, role: "HEAD_THERAPIST", status: "ACTIVE" },
  ] });
  const mkp = async (n: string, branchId: number | null, createdById: string | null) => {
    P[n] = await prisma.patient.create({ data: { fullName: `${tag} ${n}`, branchId, createdById, phone: `07${Math.floor(100000000 + Math.random() * 899999999)}` } });
  };
  await mkp("pA", A, U.de.id); await mkp("pB", B, null); await mkp("pNull", null, U.de.id); await mkp("pOrphan", null, null);
});
afterAll(async () => {
  await prisma.user.updateMany({ where: { username: { startsWith: tag } }, data: { isActive: false } });
  await prisma.$disconnect();
});

describe("patient record access boundary (database)", () => {
  it("own active branch only; other branch, branchless and inactive-branch reception are denied", async () => {
    expect(await can("recA", "RECEPTION", "pA")).toBe(true);
    expect(await can("recA", "RECEPTION", "pB")).toBe(false);
    expect(await can("recB", "RECEPTION", "pA")).toBe(false);
    expect(await can("recNone", "RECEPTION", "pA")).toBe(false);
    expect(await can("recNone", "RECEPTION", "pNull")).toBe(false);
    expect(await can("recDead", "RECEPTION", "pA")).toBe(false);
  });

  it("a patient with no branch is not an all-branch bypass; the registering Data Entry user keeps access", async () => {
    expect(await can("recA", "RECEPTION", "pNull")).toBe(false);
    expect(await can("recA", "RECEPTION", "pOrphan")).toBe(false);
    expect(await can("de", "DATA_ENTRY", "pNull")).toBe(true);
    expect(await can("de", "DATA_ENTRY", "pA")).toBe(true);
    expect(await can("de", "DATA_ENTRY", "pOrphan")).toBe(false);
  });

  it("a live handoff authorizes exactly its holder; finishing it removes the access", async () => {
    expect(await can("secretary", "SECRETARY", "pA")).toBe(false);
    const h = await prisma.patientHandoff.create({ data: {
      patientId: P.pA.id, fromUserId: U.recA.id, fromRole: "RECEPTION", toRole: "SECRETARY", toCenterId: C, status: "SENT",
    } });
    expect(await can("secretary", "SECRETARY", "pA")).toBe(true);
    expect(await can("doctor", "DOCTOR", "pA")).toBe(false);
    expect(await can("recB", "RECEPTION", "pA")).toBe(false);
    await prisma.patientHandoff.update({ where: { id: h.id }, data: { status: "ACCEPTED", acceptedById: U.secretary.id } });
    const h2 = await prisma.patientHandoff.create({ data: {
      patientId: P.pA.id, fromUserId: U.secretary.id, fromRole: "SECRETARY", toRole: "DOCTOR", toCenterId: C, toUserId: U.doctor.id, status: "SENT", previousHandoffId: h.id,
    } });
    await prisma.patientHandoff.update({ where: { id: h.id }, data: { status: "DONE" } });
    expect(await can("doctor", "DOCTOR", "pA")).toBe(true);
    await prisma.patientHandoff.update({ where: { id: h2.id }, data: { status: "DONE" } });
    expect(await can("doctor", "DOCTOR", "pA")).toBe(false);
    expect(await can("secretary", "SECRETARY", "pA")).toBe(false);
  });

  it("an authorized referral recipient and ADMIN are allowed", async () => {
    await prisma.referralRequest.create({ data: {
      patientId: P.pB.id, createdById: U.de.id, type: "TREATMENT_CENTER", destinationScope: "INTERNAL_CENTER", destinationCenterId: C2,
      requestedService: tag, clinicalReason: tag, status: "READY",
    } });
    expect(await can("referee", "HEAD_THERAPIST", "pB", perms("referrals.view"))).toBe(true);
    expect(await can("referee", "HEAD_THERAPIST", "pA", perms("referrals.view"))).toBe(false);
    expect(await can("admin", "ADMIN", "pOrphan", perms())).toBe(true);
    expect(await patientScopeWhere(prisma, { userId: U.admin.id, role: "ADMIN", permissions: perms() })).toEqual({});
  });

  it("outside the record scope only an exact file number or phone finds a patient, with minimal fields", async () => {
    const scope = await patientScopeWhere(prisma, { userId: U.recB.id, role: "RECEPTION", permissions: perms() });
    const byPhone = await exactIdentifierLookup(prisma, P.pA.phone!, scope);
    expect(byPhone.map((r) => r.id)).toEqual([P.pA.id]);
    expect(Object.keys(byPhone[0]).sort()).toEqual(["fileNumber", "fullName", "id"]);
    expect((await exactIdentifierLookup(prisma, String(P.pA.fileNumber), scope)).map((r) => r.id)).toContain(P.pA.id);
    expect(await exactIdentifierLookup(prisma, P.pA.phone!.slice(0, 7), scope)).toEqual([]);
    expect(await exactIdentifierLookup(prisma, P.pA.fullName.slice(0, 12), scope)).toEqual([]);
    const own = await patientScopeWhere(prisma, { userId: U.recA.id, role: "RECEPTION", permissions: perms() });
    expect(await exactIdentifierLookup(prisma, P.pA.phone!, own)).toEqual([]);
    // A legacy patient whose createdById is NULL must still be found outside the scope.
    expect((await exactIdentifierLookup(prisma, P.pB.phone!, own)).map((r) => r.id)).toEqual([P.pB.id]);
  });
});

describe("administrative patient operations (database)", () => {
  it("a live handoff or referral gives clinical visibility but never administrative authority", async () => {
    const { patientAdministrativeWhere } = await import("@/lib/patient-access");
    const admin = async (who: string, role: any, patient: string) => {
      const where = await patientAdministrativeWhere(prisma, { userId: U[who].id, role, permissions: perms() });
      return !!(await prisma.patient.findFirst({ where: { id: P[patient].id, AND: [where] }, select: { id: true } }));
    };
    expect(await admin("recA", "RECEPTION", "pA")).toBe(true);
    expect(await admin("de", "DATA_ENTRY", "pNull")).toBe(true);
    expect(await admin("recB", "RECEPTION", "pA")).toBe(false);
    expect(await admin("recNone", "RECEPTION", "pA")).toBe(false);
    expect(await admin("recDead", "RECEPTION", "pA")).toBe(false);
    expect(await admin("admin", "ADMIN", "pOrphan")).toBe(true);
    // secretary holds no live handoff here anymore; even with one, administrative scope ignores handoffs.
    const h = await prisma.patientHandoff.create({ data: {
      patientId: P.pA.id, fromUserId: U.recA.id, fromRole: "RECEPTION", toRole: "SECRETARY", toCenterId: C, status: "SENT",
    } });
    expect(await can("secretary", "SECRETARY", "pA")).toBe(true);
    expect(await admin("secretary", "SECRETARY", "pA")).toBe(false);
    await prisma.patientHandoff.update({ where: { id: h.id }, data: { status: "DONE" } });
  });
});

describe("handoff states and role-wide notices (database)", () => {
  it("only SENT and ACCEPTED handoffs open the record; RETURNED, CANCELLED and DONE do not", async () => {
    const h = await prisma.patientHandoff.create({ data: {
      patientId: P.pB.id, fromUserId: U.recB.id, fromRole: "RECEPTION", toRole: "DOCTOR", toCenterId: C, toUserId: U.doctor.id, status: "SENT",
    } });
    const results: Record<string, boolean> = {};
    for (const status of ["SENT", "ACCEPTED", "RETURNED", "CANCELLED", "DONE"] as const) {
      await prisma.patientHandoff.update({ where: { id: h.id }, data: { status, acceptedById: status === "ACCEPTED" ? U.doctor.id : null } });
      results[status] = await can("doctor", "DOCTOR", "pB");
    }
    expect(results).toEqual({ SENT: true, ACCEPTED: true, RETURNED: false, CANCELLED: false, DONE: false });
  });

  it("a role-wide patient notice is hidden from viewers without access; named notices and non-patient notices stay", async () => {
    const { filterRoleNoticesToPatientScope } = await import("@/lib/patient-access");
    const rows = [
      { id: "role-own", targetUserId: null, link: `/patients/${P.pA.id}` },
      { id: "role-other", targetUserId: null, link: `/patients/${P.pB.id}` },
      { id: "named", targetUserId: U.recA.id, link: `/patients/${P.pB.id}` },
      { id: "plain", targetUserId: null, link: "/my-work" },
    ];
    const kept = await filterRoleNoticesToPatientScope(prisma, { userId: U.recA.id, role: "RECEPTION", permissions: perms() }, rows);
    expect(kept.map((r) => r.id).sort()).toEqual(["named", "plain", "role-own"]);
  });
});
