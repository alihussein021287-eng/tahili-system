import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { transitionReferralRequest } from "@/lib/referral-service";

// Runs only against the isolated rehearsal database (guarded below).
const prisma = new PrismaClient();
const tag = `m082r-c-${randomUUID().slice(0, 8)}`;
const patientId = "cmv8fh8j2005io30iodx1746u";
const actorFor = (u: { id: string }) => ({ userId: u.id, role: "HEAD_THERAPIST" as const, permissions: new Set<string>() });

let referralId = "";
let outsider: { id: string }, inactive: { id: string }, authorized: { id: string };
let stages = 0;

async function state() {
  const r = await prisma.referralRequest.findUniqueOrThrow({ where: { id: referralId } });
  return {
    status: r.status, acceptedById: r.acceptedById, acceptedAt: r.acceptedAt, careStageId: r.careStageId,
    stages: await prisma.careStage.count({ where: { patientId } }),
    notes: await prisma.notification.count({ where: { link: `/referrals/${referralId}` } }),
    audits: await prisma.auditLog.count({ where: { recordId: referralId } }),
  };
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
  expect(patient.fullName.startsWith("m082-")).toBe(true);
  const branch = await prisma.branch.create({ data: { name: `${tag} branch` } });
  const destination = await prisma.center.create({ data: { name: `${tag} destination` } });
  const other = await prisma.center.create({ data: { name: `${tag} other` } });
  const mk = (name: string, branchId: number) => prisma.user.create({ data: { username: `${tag}-${name}`, fullName: `${tag} ${name}`, role: "HEAD_THERAPIST", branchId, passwordHash: "!" } });
  const creator = await prisma.user.create({ data: { username: `${tag}-creator`, fullName: `${tag} creator`, role: "DOCTOR", branchId: patient.branchId, passwordHash: "!" } });
  outsider = await mk("outsider", branch.id); inactive = await mk("inactive", branch.id); authorized = await mk("authorized", branch.id);
  await prisma.centerMembership.createMany({ data: [
    { centerId: other.id, userId: outsider.id, role: "HEAD_THERAPIST", status: "ACTIVE" },
    { centerId: destination.id, userId: inactive.id, role: "HEAD_THERAPIST", status: "INACTIVE" },
    { centerId: destination.id, userId: authorized.id, role: "HEAD_THERAPIST", status: "ACTIVE" },
  ] });
  const r = await prisma.referralRequest.create({ data: {
    patientId, createdById: creator.id, type: "TREATMENT_CENTER", destinationScope: "INTERNAL_CENTER",
    destinationCenterId: destination.id, requestedService: `${tag} service`, clinicalReason: `${tag} reason`, status: "READY",
  } });
  referralId = r.id;
  stages = await prisma.careStage.count({ where: { patientId } });
});

afterAll(async () => {
  await prisma.user.updateMany({ where: { username: { startsWith: tag } }, data: { isActive: false } });
  await prisma.$disconnect();
});

describe("referral acceptance authorization (service boundary used by the server action)", () => {
  it.each([["unrelated center", () => outsider], ["inactive destination membership", () => inactive]])(
    "rejects %s without side effects", async (_label, who) => {
      const before = await state();
      await expect(transitionReferralRequest(referralId, "ACCEPTED", { acceptedById: who().id }, actorFor(who()))).rejects.toThrow();
      expect(await state()).toEqual(before);
      expect(before.stages).toBe(stages);
    });

  it("accepts for an active destination-center member", async () => {
    const before = await state();
    const updated = await transitionReferralRequest(referralId, "ACCEPTED", { acceptedById: authorized.id }, actorFor(authorized));
    expect(updated.status).toBe("ACCEPTED");
    const after = await state();
    expect(after.acceptedById).toBe(authorized.id);
    expect(after.stages).toBe(before.stages + 1);
  });
});
