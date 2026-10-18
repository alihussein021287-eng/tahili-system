import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { verifyPrescriptionVisit, eligiblePrescriptionVisitIds } from "@/lib/pharmacy-scope";
import { listAuthoredRecords } from "@/lib/authored-records";
import { roleDefaultSet } from "@/lib/perms";

// Rehearsal database only (Mission 08.8): prescription -> Visit relation, authored-record read exception, permission defaults.
const prisma = new PrismaClient();
const tag = `m088-${randomUUID().slice(0, 8)}`;
const U: Record<string, { id: string }> = {};
const P: Record<string, { id: string }> = {};
const V: Record<string, { id: string }> = {};
let A = 0, B = 0, dead = 0;

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  A = (await prisma.branch.create({ data: { name: `${tag} A` } })).id;
  B = (await prisma.branch.create({ data: { name: `${tag} B` } })).id;
  dead = (await prisma.branch.create({ data: { name: `${tag} dead`, isActive: false } })).id;
  const mk = async (n: string, role: any, branchId: number | null) => { U[n] = await prisma.user.create({ data: { username: `${tag}-${n}`, fullName: `${tag} ${n}`, role, branchId, passwordHash: "!" } }); };
  await mk("docA", "DOCTOR", A); await mk("docB", "DOCTOR", B); await mk("docNone", "DOCTOR", null); await mk("docOther", "DOCTOR", A);
  P.p1 = await prisma.patient.create({ data: { fullName: `${tag} p1`, branchId: A } });
  P.p2 = await prisma.patient.create({ data: { fullName: `${tag} p2`, branchId: A } });
  const now = new Date();
  V.a = await prisma.visit.create({ data: { patientId: P.p1.id, visitDate: now, branchId: A } });
  V.b = await prisma.visit.create({ data: { patientId: P.p1.id, visitDate: now, branchId: B } });
  V.old = await prisma.visit.create({ data: { patientId: P.p1.id, visitDate: new Date(Date.now() - 10 * 86400000), branchId: A } });
  V.noBranch = await prisma.visit.create({ data: { patientId: P.p1.id, visitDate: now } });
  V.dead = await prisma.visit.create({ data: { patientId: P.p1.id, visitDate: now, branchId: dead } });
  V.other = await prisma.visit.create({ data: { patientId: P.p2.id, visitDate: now, branchId: A } });
});
afterAll(async () => {
  await prisma.user.updateMany({ where: { username: { startsWith: tag } }, data: { isActive: false } });
  await prisma.$disconnect();
});

const verify = (patient: string, visit: string | null, issuer: string | undefined) => verifyPrescriptionVisit(prisma, P[patient].id, visit, issuer);

describe("prescription -> Visit association (database)", () => {
  it("same-day visits in two branches: the EXPLICITLY chosen visit decides the pharmacy origin", async () => {
    expect((await verify("p1", V.a.id, U.docA.id)).branchId).toBe(A);
    // doctor of A issuing for the visit received in B needs an explicit assignment (handoff)
    await expect(verify("p1", V.b.id, U.docA.id)).rejects.toThrow(/سياقك السريري/);
    await prisma.patientHandoff.create({ data: { patientId: P.p1.id, fromUserId: U.docB.id, fromRole: "DOCTOR", toRole: "DOCTOR", toUserId: U.docA.id, status: "SENT" } });
    expect((await verify("p1", V.b.id, U.docA.id)).branchId).toBe(B);
    expect((await verify("p1", V.b.id, U.docB.id)).branchId).toBe(B);
  });

  it("no visit, another patient's visit, stale, branchless or inactive-branch visit: refused (nothing dispensable is created)", async () => {
    await expect(verify("p1", null, U.docA.id)).rejects.toThrow(/اختر الزيارة/);
    await expect(verify("p1", V.other.id, U.docA.id)).rejects.toThrow(/لا تخص هذا المراجع/);
    await expect(verify("p1", V.old.id, U.docA.id)).rejects.toThrow(/تاريخية/); // superseded by newer visits of the same patient at the branch
    await expect(verify("p1", V.noBranch.id, U.docA.id)).rejects.toThrow(/بلا فرع/);
    await expect(verify("p1", V.dead.id, U.docA.id)).rejects.toThrow(/بلا فرع/);
    await expect(verify("p1", V.a.id, undefined)).rejects.toThrow();
  });

  it("a branchless prescriber without an assignment is refused even for a same-patient visit", async () => {
    await expect(verify("p1", V.a.id, U.docNone.id)).rejects.toThrow(/سياقك السريري/);
  });

  it("the database refuses a prescription whose visit belongs to another patient, and accepts legacy NULL visits", async () => {
    await expect(prisma.prescription.create({ data: { patientId: P.p1.id, visitId: V.other.id, materialName: `${tag} x`, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", originBranchId: A } })).rejects.toThrow();
    const ok = await prisma.prescription.create({ data: { patientId: P.p1.id, visitId: V.a.id, materialName: `${tag} ok`, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", originBranchId: A } });
    expect(ok.visitId).toBe(V.a.id);
    const legacy = await prisma.prescription.create({ data: { patientId: P.p1.id, materialName: `${tag} legacy`, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", originBranchId: A } });
    expect(legacy.visitId).toBeNull();
  });
});

describe("visit eligibility without an arbitrary age cutoff (database)", () => {
  const day = 86400000;
  it("an old visit is NOT automatically valid: no live responsibility -> refused", async () => {
    P.p3 = await prisma.patient.create({ data: { fullName: `${tag} p3`, branchId: A } });
    V.p3old = await prisma.visit.create({ data: { patientId: P.p3.id, visitDate: new Date(Date.now() - 20 * day), branchId: A } });
    await expect(verify("p3", V.p3old.id, U.docA.id)).rejects.toThrow(/لا مسؤولية سريرية قائمة/);
    expect(await eligiblePrescriptionVisitIds(prisma, P.p3.id, U.docA.id)).toEqual([]);
  });
  it("ongoing treatment: a LIVE handoff makes the latest visit valid even weeks later (no 48 h limit)", async () => {
    const h = await prisma.patientHandoff.create({ data: { patientId: P.p3.id, fromUserId: U.docB.id, fromRole: "DOCTOR", toRole: "DOCTOR", toUserId: U.docA.id, status: "ACCEPTED", acceptedById: U.docA.id } });
    const ok = await verify("p3", V.p3old.id, U.docA.id);
    expect(ok.branchId).toBe(A); expect(ok.basis).toBe("ONGOING_LIVE_HANDOFF");
    expect(await eligiblePrescriptionVisitIds(prisma, P.p3.id, U.docA.id)).toEqual([V.p3old.id]);
    V.p3h = h;
  });
  it("a newer visit at the same branch supersedes the old one (follow-up visit is the way forward)", async () => {
    V.p3new = await prisma.visit.create({ data: { patientId: P.p3.id, visitDate: new Date(Date.now() - 3 * day), branchId: A } });
    await expect(verify("p3", V.p3old.id, U.docA.id)).rejects.toThrow(/تاريخية/);
    expect((await verify("p3", V.p3new.id, U.docA.id)).visitId).toBe(V.p3new.id);
  });
  it("a finished handoff ends the ongoing context; a different clinician and a wrong patient are refused", async () => {
    await prisma.patientHandoff.update({ where: { id: V.p3h.id }, data: { status: "DONE", doneAt: new Date() } });
    await expect(verify("p3", V.p3new.id, U.docA.id)).rejects.toThrow(/لا مسؤولية سريرية قائمة/);
    await expect(verify("p3", V.p3new.id, U.docNone.id)).rejects.toThrow(/سياقك السريري/);
    await expect(verify("p3", V.a.id, U.docA.id)).rejects.toThrow(/لا تخص هذا المراجع/);
  });
  it("an ADMITTED stay at the prescriber's branch keeps the latest visit valid; a discharged stay does not", async () => {
    const adm = await prisma.admission.create({ data: { patientId: P.p3.id, status: "ADMITTED", admissionDate: new Date(Date.now() - 2 * 86400000) } });
    expect((await verify("p3", V.p3new.id, U.docA.id)).basis).toBe("ONGOING_ADMISSION");
    await expect(verify("p3", V.p3new.id, U.docB.id)).rejects.toThrow(/سياقك السريري/);
    await prisma.admission.update({ where: { id: adm.id }, data: { status: "DISCHARGED" } });
    await expect(verify("p3", V.p3new.id, U.docA.id)).rejects.toThrow(/لا مسؤولية سريرية قائمة/);
  });
  it("today's encounter is valid for the prescriber's own branch; several same-day visits are chosen explicitly", async () => {
    expect((await verify("p1", V.a.id, U.docA.id)).basis).toBe("ENCOUNTER_TODAY");
    const second = await prisma.visit.create({ data: { patientId: P.p1.id, visitDate: new Date(), branchId: A } });
    expect((await verify("p1", second.id, U.docA.id)).visitId).toBe(second.id);
    expect((await verify("p1", V.a.id, U.docA.id)).visitId).toBe(V.a.id);
  });
});

describe("invoice -> visit association (database)", () => {
  it("accepts a visit of the same patient, refuses another patient's visit, keeps legacy invoices without visit", async () => {
    const ok = await prisma.invoice.create({ data: { patientId: P.p1.id, visitId: V.b.id, amount: 100, description: `${tag} inv` } });
    expect(ok.visitId).toBe(V.b.id);
    await expect(prisma.invoice.create({ data: { patientId: P.p1.id, visitId: V.other.id, amount: 100, description: `${tag} bad` } })).rejects.toThrow();
    const legacy = await prisma.invoice.create({ data: { patientId: P.p1.id, amount: 50, description: `${tag} legacy` } });
    expect(legacy.visitId).toBeNull();
  });
});

describe("historical authored-record read exception (database)", () => {
  it("only records with a proven author id, only after a DONE handoff involving the clinician; no name-based inference", async () => {
    await prisma.medicalReport.create({ data: { patientId: P.p2.id, content: `${tag} mine`, doctorId: U.docOther.id, doctor: `${tag} docOther` } });
    await prisma.medicalReport.create({ data: { patientId: P.p2.id, content: `${tag} same-name-no-id`, doctor: `${tag} docOther` } });
    await prisma.medicalReport.create({ data: { patientId: P.p2.id, content: `${tag} colleague`, doctorId: U.docA.id } });
    expect((await listAuthoredRecords(U.docOther.id)).reports.length).toBe(0); // no DONE handoff yet
    await prisma.patientHandoff.create({ data: { patientId: P.p2.id, fromUserId: U.docA.id, fromRole: "DOCTOR", toRole: "DOCTOR", toUserId: U.docOther.id, status: "DONE", acceptedById: U.docOther.id } });
    const mine = await listAuthoredRecords(U.docOther.id);
    expect(mine.reports.map((r) => r.content)).toEqual([`${tag} mine`]);
    const colleague = await listAuthoredRecords(U.docA.id);
    expect(colleague.reports.map((r) => r.content)).toContain(`${tag} colleague`);
    expect(colleague.reports.map((r) => r.content)).not.toContain(`${tag} mine`);
    expect((await listAuthoredRecords(U.docB.id)).reports.length).toBe(0);
  });
});

describe("medical report print policy defaults", () => {
  it("approved role families may print; only the manager (and ADMIN) may approve; no one else gains approval", () => {
    for (const role of ["DOCTOR", "RESIDENT", "SECRETARY", "MANAGER", "ADMIN"] as const) expect(roleDefaultSet(role).has("reports.print")).toBe(true);
    for (const role of ["RECEPTION", "PHARMACIST", "ACCOUNTANT", "DATA_ENTRY", "VIEWER", "LAB", "RADIOLOGY", "DRESSING"] as const) expect(roleDefaultSet(role).has("reports.print")).toBe(false);
    expect(roleDefaultSet("MANAGER").has("reports.medical.approve")).toBe(true);
    expect(roleDefaultSet("ADMIN").has("reports.medical.approve")).toBe(true);
    for (const role of ["DOCTOR", "RESIDENT", "SECRETARY", "THERAPIST"] as const) expect(roleDefaultSet(role).has("reports.medical.approve")).toBe(false);
  });
});
