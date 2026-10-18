import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { acceptHandoff, cancelHandoff, finishHandoff, redirectHandoff, returnHandoff, sendHandoff } from "@/lib/handoff-service";

// Rehearsal database only (guarded). Default role permissions are used for the actors.
const prisma = new PrismaClient();
const tag = `m083b1-${randomUUID().slice(0, 8)}`;
let branchId = 0, centerId = 0, otherCenterId = 0;
let reception: { id: string }, secA: { id: string }, secB: { id: string }, secOther: { id: string }, resident: { id: string }, doctor: { id: string }, therapist: { id: string }, manager: { id: string };

const send = ["handoff.send"], recv = ["handoff.receive"];
const act = (u: { id: string }, role: any, perms: string[] = [...send, ...recv]) => ({ userId: u.id, role, permissions: new Set(perms) });
const newPatient = async () => (await prisma.patient.create({ data: { fullName: `${tag} p-${randomUUID().slice(0, 6)}`, branchId } })).id;
const handoff = (id: string) => prisma.patientHandoff.findUniqueOrThrow({ where: { id } });
const audits = (id: string) => prisma.auditLog.count({ where: { recordId: id } });

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  branchId = (await prisma.branch.create({ data: { name: `${tag} b` } })).id;
  centerId = (await prisma.center.create({ data: { name: `${tag} c` } })).id;
  otherCenterId = (await prisma.center.create({ data: { name: `${tag} c2` } })).id;
  const mk = (role: any, name: string) => prisma.user.create({ data: { username: `${tag}-${name}`, fullName: `${tag} ${name}`, role, branchId, passwordHash: "!" } });
  reception = await mk("RECEPTION", "rec"); secA = await mk("SECRETARY", "secA"); secB = await mk("SECRETARY", "secB");
  secOther = await mk("SECRETARY", "secOther"); resident = await mk("RESIDENT", "res"); doctor = await mk("DOCTOR", "doc");
  therapist = await mk("THERAPIST", "th"); manager = await mk("MANAGER", "mgr");
  await prisma.centerMembership.createMany({ data: [
    { centerId, userId: secA.id, role: "SECRETARY", status: "ACTIVE" },
    { centerId, userId: secB.id, role: "SECRETARY", status: "ACTIVE" },
    { centerId: otherCenterId, userId: secOther.id, role: "SECRETARY", status: "ACTIVE" },
    { centerId, userId: resident.id, role: "RESIDENT", status: "ACTIVE" },
    { centerId, userId: doctor.id, role: "SPECIALIST", status: "ACTIVE" },
    { centerId, userId: therapist.id, role: "THERAPIST", status: "ACTIVE" },
  ] });
});
afterAll(async () => {
  await prisma.user.updateMany({ where: { username: { startsWith: tag } }, data: { isActive: false } });
  await prisma.$disconnect();
});

describe("handoff edge cases (database)", () => {
  it("concurrent acceptance by two pool members yields exactly one holder", async () => {
    const p = await newPatient();
    const h = await sendHandoff(act(reception, "RECEPTION"), { patientId: p, toRole: "SECRETARY", toCenterId: centerId });
    const results = await Promise.allSettled([acceptHandoff(act(secA, "SECRETARY"), h.id), acceptHandoff(act(secB, "SECRETARY"), h.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const row = await handoff(h.id);
    expect(row.status).toBe("ACCEPTED");
    expect([secA.id, secB.id]).toContain(row.acceptedById);
    expect(await prisma.patientHandoff.count({ where: { patientId: p, status: { in: ["SENT", "ACCEPTED"] } } })).toBe(1);
  });

  it("an unrelated-center secretary cannot accept or redirect", async () => {
    const p = await newPatient();
    const h = await sendHandoff(act(reception, "RECEPTION"), { patientId: p, toRole: "SECRETARY", toCenterId: centerId });
    const before = await audits(h.id);
    await expect(acceptHandoff(act(secOther, "SECRETARY"), h.id)).rejects.toThrow();
    await expect(redirectHandoff(act(secOther, "SECRETARY"), h.id, { toRole: "RESIDENT" })).rejects.toThrow();
    expect((await handoff(h.id)).status).toBe("SENT");
    expect(await audits(h.id)).toBe(before);
  });

  it("redirect: only the center secretariat or a manager; chain, center and responsibility stay consistent", async () => {
    const p = await newPatient();
    const h = await sendHandoff(act(reception, "RECEPTION"), { patientId: p, toRole: "SECRETARY", toCenterId: centerId });
    await expect(redirectHandoff(act(resident, "RESIDENT"), h.id, { toRole: "RESIDENT" })).rejects.toThrow();
    const moved = await redirectHandoff(act(secA, "SECRETARY"), h.id, { toRole: "RESIDENT" });
    expect((await handoff(h.id)).status).toBe("CANCELLED");
    expect(moved).toMatchObject({ status: "SENT", toRole: "RESIDENT", toCenterId: centerId, previousHandoffId: h.id, fromUserId: secA.id });
    expect(await prisma.patientHandoff.count({ where: { patientId: p, status: { in: ["SENT", "ACCEPTED"] } } })).toBe(1);
    // A second redirect of the already-cancelled original is refused.
    await expect(redirectHandoff(act(secA, "SECRETARY"), h.id, { toRole: "DOCTOR" })).rejects.toThrow();
    // A manager may redirect too.
    const again = await redirectHandoff(act(manager, "MANAGER", ["handoff.manage"]), moved.id, { toRole: "DOCTOR" });
    expect(again.toRole).toBe("DOCTOR");
    expect((await handoff(moved.id)).status).toBe("CANCELLED");
  });

  it("return needs a reason, goes back to the sender (non-secretary role), and can be re-accepted", async () => {
    const p = await newPatient();
    const h1 = await sendHandoff(act(resident, "RESIDENT"), { patientId: p, toRole: "DOCTOR", toCenterId: centerId, toUserId: doctor.id });
    await acceptHandoff(act(doctor, "DOCTOR"), h1.id);
    const before = await audits(h1.id);
    await expect(returnHandoff(act(doctor, "DOCTOR"), h1.id, "   ")).rejects.toThrow();
    expect((await handoff(h1.id)).status).toBe("ACCEPTED");
    expect(await audits(h1.id)).toBe(before);
    const back = await returnHandoff(act(doctor, "DOCTOR"), h1.id, "ينقص تقييم");
    expect((await handoff(h1.id)).status).toBe("RETURNED");
    expect(back).toMatchObject({ status: "SENT", toUserId: resident.id, toRole: "RESIDENT", previousHandoffId: h1.id, fromUserId: doctor.id });
    expect(await prisma.patientHandoff.count({ where: { patientId: p, status: { in: ["SENT", "ACCEPTED"] } } })).toBe(1);
    await acceptHandoff(act(resident, "RESIDENT"), back.id);
    expect((await handoff(back.id)).acceptedById).toBe(resident.id);
    // Wrong user cannot return someone else's accepted handoff.
    await expect(returnHandoff(act(therapist, "THERAPIST"), back.id, "x")).rejects.toThrow();
  });

  it("finish is permitted for the holder only, and a duplicate finish has no effect", async () => {
    const p = await newPatient();
    const h = await sendHandoff(act(resident, "RESIDENT"), { patientId: p, toRole: "THERAPIST", toCenterId: centerId, toUserId: therapist.id });
    await acceptHandoff(act(therapist, "THERAPIST"), h.id);
    await expect(finishHandoff(act(doctor, "DOCTOR"), h.id)).rejects.toThrow();
    await finishHandoff(act(therapist, "THERAPIST"), h.id);
    expect((await handoff(h.id)).status).toBe("DONE");
    const audited = await audits(h.id);
    await expect(finishHandoff(act(therapist, "THERAPIST"), h.id)).rejects.toThrow();
    expect((await handoff(h.id)).status).toBe("DONE");
    expect(await audits(h.id)).toBe(audited);
    expect(await prisma.patientHandoff.count({ where: { patientId: p, status: { in: ["SENT", "ACCEPTED"] } } })).toBe(0);
  });

  it("cancel by the sender closes the live responsibility and its notices", async () => {
    const p = await newPatient();
    const h = await sendHandoff(act(reception, "RECEPTION"), { patientId: p, toRole: "SECRETARY", toCenterId: centerId });
    await cancelHandoff(act(reception, "RECEPTION"), h.id);
    expect((await handoff(h.id)).status).toBe("CANCELLED");
    expect(await prisma.notification.count({ where: { handoffId: h.id, read: false } })).toBe(0);
  });
});
