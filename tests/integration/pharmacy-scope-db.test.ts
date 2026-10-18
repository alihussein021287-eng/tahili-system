import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { canPharmacyActOnPatient, pharmacyPatientWhere, resolvePrescriptionOrigin, resolvePrescriptionOriginDetailed, resolveCareExecutionBranch } from "@/lib/pharmacy-scope";

// Rehearsal database only. Independent branch pharmacies: a prescription belongs to ONE origin branch pharmacy
// (receiving-branch visit of the day, else the issuer's active branch). Home branch never decides. ADMIN is read-only.
const prisma = new PrismaClient();
const tag = `m087s-${randomUUID().slice(0, 8)}`;
const U: Record<string, { id: string }> = {};
const P: Record<string, { id: string }> = {};
let A = 0, B = 0, C = 0, dead = 0;

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  A = (await prisma.branch.create({ data: { name: `${tag} A` } })).id;
  B = (await prisma.branch.create({ data: { name: `${tag} B` } })).id;
  C = (await prisma.branch.create({ data: { name: `${tag} C` } })).id;
  dead = (await prisma.branch.create({ data: { name: `${tag} dead`, isActive: false } })).id;
  const mk = async (n: string, role: any, branchId: number | null, isActive = true) => {
    U[n] = await prisma.user.create({ data: { username: `${tag}-${n}`, fullName: `${tag} ${n}`, role, branchId, passwordHash: "!", isActive } });
  };
  await mk("phA", "PHARMACIST", A); await mk("phB", "PHARMACIST", B); await mk("phC", "PHARMACIST", C);
  await mk("phNone", "PHARMACIST", null); await mk("phDead", "PHARMACIST", dead); await mk("phOff", "PHARMACIST", A, false);
  await mk("admin", "ADMIN", null); await mk("mgr", "MANAGER", null);
  await mk("docB", "DOCTOR", B); await mk("docC", "DOCTOR", C); await mk("nurseA", "DRESSING", A); await mk("nurseB", "DRESSING", B);
  await mk("docA", "DOCTOR", A); await mk("docNone", "DOCTOR", null); await mk("docDead", "DOCTOR", dead);
  P.home = await prisma.patient.create({ data: { fullName: `${tag} home`, branchId: A } });
  P.visited = await prisma.patient.create({ data: { fullName: `${tag} visited`, branchId: A } });
  P.orphan = await prisma.patient.create({ data: { fullName: `${tag} orphan`, branchId: null } });
  await prisma.visit.create({ data: { patientId: P.visited.id, visitDate: new Date(), branchId: B } });
  P.multi = await prisma.patient.create({ data: { fullName: `${tag} multi`, branchId: A } });
  await prisma.visit.create({ data: { patientId: P.multi.id, visitDate: new Date(), branchId: A } });
  await prisma.visit.create({ data: { patientId: P.multi.id, visitDate: new Date(), branchId: B } });
  P.twoInB = await prisma.patient.create({ data: { fullName: `${tag} twoInB`, branchId: A } });
  await prisma.visit.create({ data: { patientId: P.twoInB.id, visitDate: new Date(), branchId: B } });
  await prisma.visit.create({ data: { patientId: P.twoInB.id, visitDate: new Date(), branchId: B } });
  P.yesterdayB = await prisma.patient.create({ data: { fullName: `${tag} yesterdayB`, branchId: A } });
  await prisma.visit.create({ data: { patientId: P.yesterdayB.id, visitDate: new Date(Date.now() - 3 * 86400000), branchId: B } });
  // prescriptions with explicit origin
  await prisma.prescription.create({ data: { patientId: P.home.id, materialName: `${tag} x`, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", originBranchId: A } });
  await prisma.prescription.create({ data: { patientId: P.visited.id, materialName: `${tag} y`, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", originBranchId: B } });
  await prisma.prescription.create({ data: { patientId: P.orphan.id, materialName: `${tag} z`, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", originBranchId: null } });
});
afterAll(async () => {
  await prisma.user.updateMany({ where: { username: { startsWith: tag } }, data: { isActive: false } });
  await prisma.$disconnect();
});

const can = (who: string, role: any, patient: string) => canPharmacyActOnPatient({ userId: U[who].id, role }, P[patient].id);

describe("pharmacy origin-branch relationship (database)", () => {
  it("only the pharmacist of the prescription's ORIGIN branch is authorized (home branch never decides)", async () => {
    expect(await can("phA", "PHARMACIST", "home")).toBe(true);
    expect(await can("phB", "PHARMACIST", "home")).toBe(false);
    expect(await can("phC", "PHARMACIST", "home")).toBe(false);
    // visited patient: home branch A, prescription originated at receiving branch B
    expect(await can("phB", "PHARMACIST", "visited")).toBe(true);
    expect(await can("phA", "PHARMACIST", "visited")).toBe(false);
    expect(await can("phC", "PHARMACIST", "visited")).toBe(false);
  });

  it("branchless, inactive-branch and inactive pharmacists have no authority; a legacy prescription without origin grants none", async () => {
    for (const who of ["phNone", "phDead", "phOff"]) expect(await can(who, "PHARMACIST", "home")).toBe(false);
    expect(await can("phA", "PHARMACIST", "orphan")).toBe(false);
    expect(await can("phNone", "PHARMACIST", "orphan")).toBe(false);
  });

  it("a role mismatch (stale session) is refused; a central MANAGER gains nothing; ADMIN may read all (never mutate)", async () => {
    expect(await can("phA", "DOCTOR", "home")).toBe(false);
    expect(await can("mgr", "MANAGER", "home")).toBe(false);
    expect(await pharmacyPatientWhere({ userId: U.admin.id, role: "ADMIN" })).toEqual({});
  });

  it("new prescription origin: receiving-branch visit of today wins, else the issuer's active branch, never the home branch", async () => {
    expect(await resolvePrescriptionOrigin(prisma, P.visited.id, U.docA.id)).toBe(B);
    expect(await resolvePrescriptionOrigin(prisma, P.home.id, U.docA.id)).toBe(A);
    expect(await resolvePrescriptionOrigin(prisma, P.home.id, U.docNone.id)).toBeNull();
    expect(await resolvePrescriptionOrigin(prisma, P.home.id, U.docDead.id)).toBeNull();
    expect(await resolvePrescriptionOrigin(prisma, P.home.id, undefined)).toBeNull();
  });

  it("same-day visits in several branches: issuer branch among them wins, otherwise AMBIGUOUS (fail closed, reason reported)", async () => {
    expect((await resolvePrescriptionOriginDetailed(prisma, P.multi.id, U.docA.id)).branchId).toBe(A);
    expect((await resolvePrescriptionOriginDetailed(prisma, P.multi.id, U.docB.id)).branchId).toBe(B);
    const amb = await resolvePrescriptionOriginDetailed(prisma, P.multi.id, U.docC.id);
    expect(amb.branchId).toBeNull();
    expect(amb.basis).toBe("AMBIGUOUS_MULTI_BRANCH_VISITS");
    expect((await resolvePrescriptionOriginDetailed(prisma, P.multi.id, U.docNone.id)).branchId).toBeNull();
  });

  it("several visits in ONE branch resolve to that branch; a visit of another day is not evidence; no evidence = null", async () => {
    expect((await resolvePrescriptionOriginDetailed(prisma, P.twoInB.id, U.docA.id)).branchId).toBe(B);
    expect((await resolvePrescriptionOriginDetailed(prisma, P.yesterdayB.id, U.docA.id)).branchId).toBe(A);
    const none = await resolvePrescriptionOriginDetailed(prisma, P.yesterdayB.id, U.docNone.id);
    expect(none.branchId).toBeNull();
    expect(none.basis).toBe("NO_EVIDENCE");
  });

  it("care consumption branch: recorder branch unless today's visit evidence contradicts it; branchless fails closed", async () => {
    expect((await resolveCareExecutionBranch(prisma, P.twoInB.id, U.nurseB.id)).branchId).toBe(B);
    const contradict = await resolveCareExecutionBranch(prisma, P.twoInB.id, U.nurseA.id);
    expect(contradict.branchId).toBeNull();
    expect(contradict.basis).toBe("SERVICE_LOCATION_CONTRADICTS_RECORDER_BRANCH");
    expect((await resolveCareExecutionBranch(prisma, P.home.id, U.nurseA.id)).branchId).toBe(A);
    expect((await resolveCareExecutionBranch(prisma, P.home.id, U.docNone.id)).branchId).toBeNull();
    expect((await resolveCareExecutionBranch(prisma, P.multi.id, U.nurseA.id)).branchId).toBe(A);
    expect((await resolveCareExecutionBranch(prisma, P.multi.id, U.docC.id)).branchId).toBeNull();
    expect((await resolveCareExecutionBranch(prisma, P.yesterdayB.id, U.nurseA.id)).branchId).toBe(A);
  });
});
