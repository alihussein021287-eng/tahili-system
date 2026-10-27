import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { roleDefaultSet } from "@/lib/perms";
import { createReferralRequest, transitionReferralRequest } from "@/lib/referral-service";
import { completeCenterStageWork } from "@/lib/care-stage-service";
import { transitionCareStage } from "@/lib/care-stage-service";
import { withSerializableRetry } from "@/lib/serializable-retry";

// Rehearsal database only. Bounded concurrency: 6 parallel confirmations, exactly one may change state.
createRequire(import.meta.url)("../../scripts/acceptance/guard.cjs").assertIsolatedTarget();
const prisma = new PrismaClient();
const tag = `m085c-${randomUUID().slice(0, 8)}`;
let branchId = 0, centerId = 0;
let member: { id: string }, member2: { id: string }, outsider: { id: string }, head: { id: string };

const confirm = (u: { id: string }, patientId: string, stageId: string, role: any = "DOCTOR") =>
  withSerializableRetry(() => prisma.$transaction(
    async (tx) => transitionCareStage(tx, { userId: u.id, role, name: "n" }, { patientId, stageId, to: "CONFIRMED", expectedOperationalCompletionId: (await tx.careStage.findUniqueOrThrow({ where: { id: stageId } })).operationalCompletionId ?? undefined }),
    { isolationLevel: "Serializable" },
  ), 5);

async function fixture(label: string) {
  const patient = await prisma.patient.create({ data: { fullName: `${tag} ${label}`, branchId } });
  const who = { userId: member.id, role: "DOCTOR" as const, permissions: roleDefaultSet("DOCTOR") };
  // CENTER final confirmation awaits owner policy; exercise actual authorized
  // SPECIALIST_REVIEW confirmation rather than mocking or bypassing that gate.
  const request = await createReferralRequest({ patientId: patient.id, type: "SPECIALIST", destinationScope: "INTERNAL_SPECIALIST", assignedReviewerId: member.id, requestedService: "Synthetic specialist", clinicalReason: "Synthetic only" }, who);
  await transitionReferralRequest(request.id, "READY", {}, who);
  const accepted = await transitionReferralRequest(request.id, "ACCEPTED", { acceptedById: member.id }, who);
  const stage = await prisma.careStage.findUniqueOrThrow({ where: { id: accepted.careStageId! } });
  const next = await prisma.careStage.create({ data: { patientId: patient.id, station: "محطة تالية", responsibleRole: "THERAPIST", responsibilityScope: "CENTER", responsibleCenterId: centerId, sequence: 1 } });
  await prisma.notification.create({ data: { targetRole: "HEAD_THERAPIST", title: `${tag} n`, link: `/patients/${patient.id}`, careStageId: stage.id } });
  return { patient, stage, next };
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  branchId = (await prisma.branch.create({ data: { name: `${tag} branch` } })).id;
  centerId = (await prisma.center.create({ data: { name: `${tag} center` } })).id;
  const mk = (n: string, role: any) => prisma.user.create({ data: { username: `${tag}-${n}`, fullName: `${tag} ${n}`, role, branchId, passwordHash: "!" } });
  member = await mk("m1", "DOCTOR"); member2 = await mk("m2", "DOCTOR"); outsider = await mk("out", "DOCTOR"); head = await mk("head", "HEAD_THERAPIST");
  await prisma.centerMembership.createMany({ data: [
    { centerId, userId: member.id, role: "SPECIALIST", status: "ACTIVE" },
    { centerId, userId: member2.id, role: "SPECIALIST", status: "ACTIVE" },
    { centerId, userId: head.id, role: "HEAD_THERAPIST", status: "ACTIVE" },
  ] });
});
afterAll(async () => {
  await prisma.user.updateMany({ where: { username: { startsWith: tag } }, data: { isActive: false } });
  await prisma.$disconnect();
});

describe("CareStage confirmation under concurrency (database)", () => {
  it("six parallel confirmations by the named physician change the stage exactly once", async () => {
    const f = await fixture("same");
    const results = await Promise.allSettled([member, member, member, member, member, member].map((u) => confirm(u, f.patient.id, f.stage.id)));
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ changed: boolean }>[];
    expect(ok.length).toBe(6);                       // every request ends cleanly (retry or no-op), none surfaces a conflict
    expect(ok.filter((r) => r.value.changed).length).toBe(1);
    const stage = await prisma.careStage.findUniqueOrThrow({ where: { id: f.stage.id } });
    expect(stage.status).toBe("CONFIRMED");
    expect([member.id, member2.id]).toContain(stage.confirmedById);
    expect(await prisma.auditLog.count({ where: { recordId: f.stage.id, tableName: "care_stages", userId: member.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { careStageId: f.next.id } })).toBe(1);   // next station told once
    expect(await prisma.notification.count({ where: { careStageId: f.stage.id, resolvedAt: null } })).toBe(0);
  });

  it("unauthorized requests racing an authorized one are all denied and cannot take the confirmation", async () => {
    const f = await fixture("denied");
    const attempts = [outsider, member, outsider, outsider].map((u) => confirm(u, f.patient.id, f.stage.id));
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === "rejected").length).toBe(3);
    expect((results[1] as PromiseFulfilledResult<{ changed: boolean }>).value.changed).toBe(true);
    const stage = await prisma.careStage.findUniqueOrThrow({ where: { id: f.stage.id } });
    expect(stage.confirmedById).toBe(member.id);
    expect(await prisma.auditLog.count({ where: { recordId: f.stage.id, tableName: "care_stages", userId: member.id } })).toBe(1);
  });

  it("a repeated confirmation after completion is an idempotent no-op", async () => {
    const f = await fixture("repeat");
    await confirm(member, f.patient.id, f.stage.id);
    await expect(confirm(member, f.patient.id, f.stage.id)).resolves.toEqual({ changed: false, status: "CONFIRMED" });
    await expect(confirm(member2, f.patient.id, f.stage.id)).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { recordId: f.stage.id, tableName: "care_stages", userId: member.id } })).toBe(1);
  });
});
