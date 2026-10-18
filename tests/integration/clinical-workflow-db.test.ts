import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { transitionCareStage, reassignCenterStage, listStagesAwaitingAssignment } from "@/lib/care-stage-service";
import { transitionQueueEntry } from "@/lib/queue-transitions";
import { acceptHandoff, sendHandoff } from "@/lib/handoff-service";
import { transitionReferralRequest } from "@/lib/referral-service";

// Rehearsal database only (guarded). Synthetic m083ar-* fixtures.
const prisma = new PrismaClient();
const tag = `m083ar-${randomUUID().slice(0, 8)}`;
let patientId = "";
let doctor: { id: string }, wrongRole: { id: string }, otherBranchDoctor: { id: string }, inactiveDoctor: { id: string };
let doctorStage = "", pharmacyStage = "", queueId = "", apptId = "";
let reception: { id: string };

const asDoctor = (u: { id: string }) => ({ userId: u.id, role: "DOCTOR" as const, name: "doc" });
const confirm = (u: { id: string }, stageId: string, role: "DOCTOR" | "THERAPIST" = "DOCTOR") =>
  prisma.$transaction((tx) => transitionCareStage(tx, { ...asDoctor(u), role }, { patientId, stageId, to: "CONFIRMED" }), { isolationLevel: "Serializable" });
const queuePerms = new Set(["queue.manage"]);

async function snapshot() {
  return {
    stages: await prisma.careStage.findMany({ where: { patientId }, orderBy: { sequence: "asc" }, select: { id: true, status: true, confirmedById: true } }),
    audits: await prisma.auditLog.count({ where: { tableName: "care_stages", recordId: { in: [doctorStage, pharmacyStage] } } }),
    notes: await prisma.notification.count({ where: { link: `/patients/${patientId}` } }),
  };
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? "").toMatch(/127\.0\.0\.1:55432/);
  const branch = await prisma.branch.create({ data: { name: `${tag} branch` } });
  const other = await prisma.branch.create({ data: { name: `${tag} other branch` } });
  const mk = (role: any, name: string, branchId: number, isActive = true) =>
    prisma.user.create({ data: { username: `${tag}-${name}`, fullName: `${tag} ${name}`, role, branchId, passwordHash: "!", isActive } });
  doctor = await mk("DOCTOR", "doctor", branch.id);
  wrongRole = await mk("THERAPIST", "therapist", branch.id);
  otherBranchDoctor = await mk("DOCTOR", "otherdoc", other.id);
  inactiveDoctor = await mk("DOCTOR", "inactive", branch.id, false);
  reception = await mk("RECEPTION", "reception", branch.id);
  patientId = (await prisma.patient.create({ data: { fullName: `${tag} patient`, branchId: branch.id } })).id;
  doctorStage = (await prisma.careStage.create({ data: { patientId, station: "طبيب/تشخيص", responsibleRole: "DOCTOR", responsibilityScope: "SERVICE", assignedUserId: doctor.id, assignedAt: new Date(), sequence: 0 } })).id;
  pharmacyStage = (await prisma.careStage.create({ data: { patientId, station: "صيدلية", responsibleRole: "PHARMACIST", responsibilityScope: "SERVICE", sequence: 1 } })).id;
  queueId = (await prisma.queueEntry.create({ data: { patientId, status: "IN_SESSION" } })).id;
  apptId = (await prisma.appointment.create({ data: { patientId, scheduledAt: new Date(), status: "SCHEDULED" } })).id;
  await prisma.notification.create({ data: { targetRole: "DOCTOR", title: `${tag} unrelated`, link: `/patients/${patientId}`, read: false } });
});

afterAll(async () => {
  await prisma.user.updateMany({ where: { username: { startsWith: tag } }, data: { isActive: false } });
  await prisma.$disconnect();
});

describe("clinical stage confirmation (database)", () => {
  it("denies wrong role, other branch and inactive accounts without side effects", async () => {
    const before = await snapshot();
    await expect(confirm(wrongRole, doctorStage, "THERAPIST")).rejects.toThrow();
    await expect(confirm(otherBranchDoctor, doctorStage)).rejects.toThrow();
    await expect(confirm(inactiveDoctor, doctorStage)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("confirms only the physician's stage, notifies the next station, leaves unrelated work alone", async () => {
    const before = await snapshot();
    await expect(confirm(doctor, doctorStage)).resolves.toEqual({ changed: true, status: "CONFIRMED" });
    const after = await snapshot();
    expect(after.stages[0]).toMatchObject({ id: doctorStage, status: "CONFIRMED", confirmedById: doctor.id });
    expect(after.stages[1]).toMatchObject({ id: pharmacyStage, status: "WAITING", confirmedById: null });
    expect(after.audits).toBe(before.audits + 1);
    expect(after.notes).toBe(before.notes + 1);
    expect(await prisma.notification.count({ where: { title: `${tag} unrelated`, read: false } })).toBe(1);
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: queueId } })).status).toBe("IN_SESSION");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: apptId } })).status).toBe("SCHEDULED");
  });

  it("a duplicate confirmation changes nothing and the stage is never reopened", async () => {
    const before = await snapshot();
    await expect(confirm(doctor, doctorStage)).resolves.toEqual({ changed: false, status: "CONFIRMED" });
    expect(await snapshot()).toEqual(before);
    await expect(prisma.$transaction((tx) => transitionCareStage(tx, asDoctor(doctor), { patientId, stageId: doctorStage, to: "WAITING" }))).rejects.toThrow();
  });
});

describe("queue guard (database)", () => {
  it("completes IN_SESSION -> DONE once, then rejects DONE -> CALLED with no audit", async () => {
    const actor = { userId: reception.id, role: "RECEPTION" as const, permissions: queuePerms };
    const run = (to: any) => prisma.$transaction((tx) => transitionQueueEntry(tx, actor, queueId, to));
    const audits = () => prisma.auditLog.count({ where: { tableName: "queue_entries", recordId: queueId } });
    await expect(run("DONE")).resolves.toEqual({ changed: true, status: "DONE" });
    const afterDone = await audits();
    await expect(run("CALLED")).rejects.toThrow();
    await expect(run("DONE")).resolves.toEqual({ changed: false, status: "DONE" });
    expect(await audits()).toBe(afterDone);
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: queueId } })).status).toBe("DONE");
  });

  it("rejects a user from another branch", async () => {
    const actor = { userId: otherBranchDoctor.id, role: "DOCTOR" as const, permissions: queuePerms };
    await expect(prisma.$transaction((tx) => transitionQueueEntry(tx, actor, queueId, "WAITING"))).rejects.toThrow();
  });
});

describe("center-scoped stage responsibility and notification resolution (database)", () => {
  const tag2 = `m083r2-${randomUUID().slice(0, 8)}`;
  let patient2 = "";
  let c1 = 0, c2 = 0;
  let active: { id: string }, inactiveMember: { id: string }, otherCenter: { id: string }, wrongRoleUser: { id: string };
  let stage = "", ambiguousStage = "", legacyStage = "", otherStage = "";
  let linkedNote = "", linkedReadNote = "", unrelatedNote = "", otherStageNote = "";

  const confirmAs = (u: { id: string }, role: any, stageId: string) =>
    prisma.$transaction((tx) => transitionCareStage(tx, { userId: u.id, role, name: "n" }, { patientId: patient2, stageId, to: "CONFIRMED" }), { isolationLevel: "Serializable" });
  const stageState = (id: string) => prisma.careStage.findUniqueOrThrow({ where: { id }, select: { status: true, confirmedById: true } });

  beforeAll(async () => {
    const branch = await prisma.branch.create({ data: { name: `${tag2} branch` } });
    c1 = (await prisma.center.create({ data: { name: `${tag2} c1` } })).id;
    c2 = (await prisma.center.create({ data: { name: `${tag2} c2` } })).id;
    const mk = (role: any, name: string) => prisma.user.create({ data: { username: `${tag2}-${name}`, fullName: `${tag2} ${name}`, role, branchId: branch.id, passwordHash: "!" } });
    active = await mk("HEAD_THERAPIST", "active");
    inactiveMember = await mk("HEAD_THERAPIST", "inactive-member");
    otherCenter = await mk("HEAD_THERAPIST", "other-center");
    wrongRoleUser = await mk("THERAPIST", "wrong-role");
    await prisma.centerMembership.createMany({ data: [
      { centerId: c1, userId: active.id, role: "HEAD_THERAPIST", status: "ACTIVE" },
      { centerId: c1, userId: inactiveMember.id, role: "HEAD_THERAPIST", status: "INACTIVE" },
      { centerId: c2, userId: otherCenter.id, role: "HEAD_THERAPIST", status: "ACTIVE" },
    ] });
    patient2 = (await prisma.patient.create({ data: { fullName: `${tag2} patient`, branchId: branch.id } })).id;
    const mkStage = (data: any) => prisma.careStage.create({ data: { patientId: patient2, station: "محطة", responsibleRole: "HEAD_THERAPIST", ...data } }).then((s) => s.id);
    stage = await mkStage({ sequence: 0, responsibilityScope: "CENTER", responsibleCenterId: c1 });
    ambiguousStage = await mkStage({ sequence: 1, responsibilityScope: "CENTER", responsibleCenterId: null });
    legacyStage = await mkStage({ sequence: 2 });
    otherStage = await mkStage({ sequence: 3, responsibilityScope: "CENTER", responsibleCenterId: c1 });
    const note = (data: any) => prisma.notification.create({ data: { targetRole: "HEAD_THERAPIST", title: `${tag2} n`, link: `/patients/${patient2}`, ...data } }).then((n) => n.id);
    linkedNote = await note({ careStageId: stage });
    linkedReadNote = await note({ careStageId: stage, read: true });
    unrelatedNote = await note({});
    otherStageNote = await note({ careStageId: otherStage });
  });

  afterAll(async () => {
    await prisma.user.updateMany({ where: { username: { startsWith: tag2 } }, data: { isActive: false } });
  });

  it("denies inactive membership, other center, wrong role and ambiguous scope without side effects", async () => {
    const audits = () => prisma.auditLog.count({ where: { recordId: { in: [stage, ambiguousStage] } } });
    const before = await audits();
    await expect(confirmAs(inactiveMember, "HEAD_THERAPIST", stage)).rejects.toThrow();
    await expect(confirmAs(otherCenter, "HEAD_THERAPIST", stage)).rejects.toThrow();
    await expect(confirmAs(wrongRoleUser, "THERAPIST", stage)).rejects.toThrow();
    await expect(confirmAs(active, "HEAD_THERAPIST", ambiguousStage)).rejects.toThrow();
    expect((await stageState(stage)).status).toBe("WAITING");
    expect((await stageState(ambiguousStage)).status).toBe("WAITING");
    expect(await audits()).toBe(before);
    expect(await prisma.notification.count({ where: { id: { in: [linkedNote, linkedReadNote, otherStageNote] }, resolvedAt: { not: null } } })).toBe(0);
  });

  it("confirms for the active center member and resolves only that stage's notices, keeping read state", async () => {
    await expect(confirmAs(active, "HEAD_THERAPIST", stage)).resolves.toEqual({ changed: true, status: "CONFIRMED" });
    const notes = await prisma.notification.findMany({ where: { id: { in: [linkedNote, linkedReadNote, unrelatedNote, otherStageNote] } }, select: { id: true, read: true, resolvedAt: true } });
    const by = Object.fromEntries(notes.map((n) => [n.id, n]));
    expect(by[linkedNote]).toMatchObject({ read: false }); expect(by[linkedNote].resolvedAt).not.toBeNull();
    expect(by[linkedReadNote]).toMatchObject({ read: true }); expect(by[linkedReadNote].resolvedAt).not.toBeNull();
    expect(by[unrelatedNote]).toMatchObject({ read: false, resolvedAt: null });
    expect(by[otherStageNote]).toMatchObject({ read: false, resolvedAt: null });
    expect((await stageState(otherStage)).status).toBe("WAITING");
  });

  it("a repeated confirmation is a no-op (no audit, resolvedAt unchanged)", async () => {
    const resolvedAt = (await prisma.notification.findUniqueOrThrow({ where: { id: linkedNote } })).resolvedAt;
    const audits = await prisma.auditLog.count({ where: { recordId: stage } });
    await expect(confirmAs(active, "HEAD_THERAPIST", stage)).resolves.toEqual({ changed: false, status: "CONFIRMED" });
    expect(await prisma.auditLog.count({ where: { recordId: stage } })).toBe(audits);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: linkedNote } })).resolvedAt).toEqual(resolvedAt);
  });

  it("an unclassified (NULL scope) stage fails closed for the matching role too, with no side effects", async () => {
    const audits = await prisma.auditLog.count({ where: { recordId: legacyStage } });
    await expect(confirmAs(wrongRoleUser, "THERAPIST", legacyStage)).rejects.toThrow();
    await expect(confirmAs(active, "HEAD_THERAPIST", legacyStage)).rejects.toThrow();
    expect((await stageState(legacyStage)).status).toBe("WAITING");
    expect(await prisma.auditLog.count({ where: { recordId: legacyStage } })).toBe(audits);
  });
});

describe("stage assignment contract (database)", () => {
  const tag3 = `m083r5-${randomUUID().slice(0, 8)}`;
  let branchId = 0, centerId = 0, otherCenterId = 0;
  let patient = "", otherPatient = "";
  let docA: { id: string }, docB: { id: string }, docOtherCenter: { id: string }, docInactiveMember: { id: string }, sender: { id: string };
  const perms = new Set(["handoff.send", "handoff.receive", "journey.confirm", "journey.manage"]);
  const act = (u: { id: string }, role: any = "DOCTOR") => ({ userId: u.id, role, permissions: perms });
  const confirmStage = (u: { id: string }, stageId: string, patientId = patient) =>
    prisma.$transaction((tx) => transitionCareStage(tx, { userId: u.id, role: "DOCTOR", name: "n" }, { patientId, stageId, to: "CONFIRMED" }), { isolationLevel: "Serializable" });
  const mkStage = (data: any, patientId = patient) =>
    prisma.careStage.create({ data: { patientId, station: "طبيب/تشخيص", responsibleRole: "DOCTOR", responsibilityScope: "CENTER", responsibleCenterId: centerId, sequence: 0, ...data } }).then((x) => x.id);
  const newPatient = async () => (await prisma.patient.create({ data: { fullName: `${tag3} p-${randomUUID().slice(0, 6)}`, branchId } })).id;
  const stage = (id: string) => prisma.careStage.findUniqueOrThrow({ where: { id } });
  const send = (from: { id: string }, role: any, toCenter: number, extra: any = {}, to: any = null) =>
    sendHandoff(act(from, role), { patientId: patient, toRole: "DOCTOR", toCenterId: toCenter, toUserId: to, ...extra });

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `${tag3} branch` } })).id;
    centerId = (await prisma.center.create({ data: { name: `${tag3} c` } })).id;
    otherCenterId = (await prisma.center.create({ data: { name: `${tag3} other` } })).id;
    const mk = (role: any, name: string) => prisma.user.create({ data: { username: `${tag3}-${name}`, fullName: `${tag3} ${name}`, role, branchId, passwordHash: "!" } });
    docA = await mk("DOCTOR", "a"); docB = await mk("DOCTOR", "b"); docOtherCenter = await mk("DOCTOR", "other");
    docInactiveMember = await mk("DOCTOR", "inactive"); sender = await mk("RESIDENT", "sender");
    await prisma.centerMembership.createMany({ data: [
      { centerId, userId: docA.id, role: "SPECIALIST", status: "ACTIVE" },
      { centerId, userId: docB.id, role: "SPECIALIST", status: "ACTIVE" },
      { centerId: otherCenterId, userId: docOtherCenter.id, role: "SPECIALIST", status: "ACTIVE" },
      { centerId, userId: docInactiveMember.id, role: "SPECIALIST", status: "INACTIVE" },
      { centerId, userId: sender.id, role: "RESIDENT", status: "ACTIVE" },
    ] });
    patient = (await prisma.patient.create({ data: { fullName: `${tag3} patient`, branchId } })).id;
    otherPatient = (await prisma.patient.create({ data: { fullName: `${tag3} other patient`, branchId } })).id;
  });
  afterAll(async () => { await prisma.user.updateMany({ where: { username: { startsWith: tag3 } }, data: { isActive: false } }); });

  it("same-role unassigned clinician is denied and a patient-level handoff grants no stage authority", async () => {
    patient = await newPatient();
    const st = await mkStage({ responsibilityScope: "SERVICE", responsibleCenterId: null });
    await expect(confirmStage(docA, st)).rejects.toThrow();
    const h = await send(sender, "RESIDENT", centerId);
    await acceptHandoff(act(docA), h.id);
    expect((await stage(st)).assignedUserId).toBeNull();
    await expect(confirmStage(docA, st)).rejects.toThrow();
    expect((await stage(st)).status).toBe("WAITING");
  });

  it("a stage-linked accepted handoff assigns exactly that stage; others and the pool stay denied", async () => {
    patient = await newPatient();
    const target = await mkStage({ sequence: 1 });
    const sibling = await mkStage({ sequence: 2, responsibilityScope: "SERVICE", responsibleCenterId: null });
    const h = await send(sender, "RESIDENT", centerId, { careStageId: target });
    await acceptHandoff(act(docA), h.id);
    expect((await stage(target)).assignedUserId).toBe(docA.id);
    expect((await stage(sibling)).assignedUserId).toBeNull();
    await expect(confirmStage(docB, target)).rejects.toThrow();
    await expect(confirmStage(docA, sibling)).rejects.toThrow();
    await expect(confirmStage(docA, target)).resolves.toMatchObject({ status: "CONFIRMED" });
    const audits = await prisma.auditLog.count({ where: { recordId: target } });
    await expect(confirmStage(docA, target)).resolves.toMatchObject({ changed: false });
    expect(await prisma.auditLog.count({ where: { recordId: target } })).toBe(audits);
  });

  it("SERVICE first assignment by a generic sender (view/send/manage perms) is denied: no authority relation exists", async () => {
    patient = await newPatient();
    const st = await mkStage({ responsibilityScope: "SERVICE", responsibleCenterId: null });
    await expect(send(sender, "RESIDENT", centerId, { careStageId: st })).rejects.toThrow();
    await expect(send(docA, "DOCTOR", centerId, { careStageId: st })).rejects.toThrow();
    expect((await stage(st)).assignedUserId).toBeNull();
    expect(await prisma.patientHandoff.count({ where: { careStageId: st } })).toBe(0);
    // A patient-level handoff is still possible and still assigns nothing.
    const h = await send(sender, "RESIDENT", centerId);
    await acceptHandoff(act(docA), h.id);
    expect((await stage(st)).assignedUserId).toBeNull();
    await expect(confirmStage(docA, st)).rejects.toThrow();
  });

  it("a CENTER stage cannot be assigned by a sender outside its center, even for the same patient", async () => {
    patient = await newPatient();
    const own = await mkStage({});
    const foreign = await mkStage({ sequence: 1, responsibleCenterId: otherCenterId });
    await expect(send(sender, "RESIDENT", otherCenterId, { careStageId: foreign })).rejects.toThrow();
    await expect(send(sender, "RESIDENT", centerId, { careStageId: foreign })).rejects.toThrow();
    expect(await prisma.patientHandoff.count({ where: { careStageId: foreign } })).toBe(0);
    await expect(send(sender, "RESIDENT", centerId, { careStageId: own })).resolves.toBeTruthy();
  });

  it("rejects a link to another patient's stage and a wrong-center or inactive acceptor", async () => {
    patient = await newPatient();
    const foreign = await mkStage({}, otherPatient);
    await expect(send(sender, "RESIDENT", centerId, { careStageId: foreign })).rejects.toThrow();
    const st = await mkStage({ sequence: 3 });
    const h = await send(sender, "RESIDENT", centerId, { careStageId: st });
    await expect(acceptHandoff(act(docOtherCenter), h.id)).rejects.toThrow();
    await expect(acceptHandoff(act(docInactiveMember), h.id)).rejects.toThrow();
    expect((await stage(st)).assignedUserId).toBeNull();
    expect((await prisma.patientHandoff.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("SENT");
  });

  it("reassignment needs the current assignee and a reason, is audited, and removes the former assignee", async () => {
    patient = await newPatient();
    const st = await mkStage({ sequence: 4 });
    const h1 = await send(sender, "RESIDENT", centerId, { careStageId: st });
    await acceptHandoff(act(docA), h1.id);
    await expect(send(docB, "DOCTOR", centerId, { careStageId: st, note: "x" })).rejects.toThrow();
    await expect(send(docA, "DOCTOR", centerId, { careStageId: st })).rejects.toThrow();
    const h2 = await send(docA, "DOCTOR", centerId, { careStageId: st, note: "تبديل المناوبة" }, docB.id);
    await acceptHandoff(act(docB), h2.id);
    expect((await stage(st)).assignedUserId).toBe(docB.id);
    const log = await prisma.auditLog.findFirst({ where: { recordId: st, tableName: "care_stages" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(log?.oldValue)).toContain(docA.id);
    expect(JSON.stringify(log?.newValue)).toContain(docB.id);
    expect(await prisma.notification.count({ where: { targetUserId: docA.id, careStageId: st } })).toBe(1);
    await expect(confirmStage(docA, st)).rejects.toThrow();
    await expect(confirmStage(docB, st)).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("a conflicting second acceptance cannot take an already assigned stage", async () => {
    patient = await newPatient();
    const st = await mkStage({ sequence: 5 });
    const h1 = await send(sender, "RESIDENT", centerId, { careStageId: st });
    // A concurrent assignment lands between send and acceptance.
    await prisma.careStage.update({ where: { id: st }, data: { assignedUserId: docB.id, assignedAt: new Date() } });
    await expect(acceptHandoff(act(docA), h1.id)).rejects.toThrow();
    expect((await stage(st)).assignedUserId).toBe(docB.id);
    expect((await prisma.patientHandoff.findUniqueOrThrow({ where: { id: h1.id } })).status).toBe("SENT");
  });

  it("INTERNAL_SPECIALIST stage binds to the assigned reviewer only", async () => {
    patient = await newPatient();
    const referral = await prisma.referralRequest.create({ data: {
      patientId: patient, createdById: sender.id, type: "SPECIALIST", destinationScope: "INTERNAL_SPECIALIST",
      assignedReviewerId: docA.id, requestedService: tag3, clinicalReason: tag3, status: "READY",
    } });
    const reviewerPerms = new Set(["referrals.view", "referrals.accept"]);
    await expect(transitionReferralRequest(referral.id, "ACCEPTED", { acceptedById: docB.id }, { userId: docB.id, role: "DOCTOR", permissions: reviewerPerms })).rejects.toThrow();
    await transitionReferralRequest(referral.id, "ACCEPTED", { acceptedById: docA.id }, { userId: docA.id, role: "DOCTOR", permissions: reviewerPerms });
    const created = await prisma.referralRequest.findUniqueOrThrow({ where: { id: referral.id } });
    const st = created.careStageId!;
    expect((await stage(st)).assignedUserId).toBe(docA.id);
    expect((await stage(st)).responsibilityScope).toBe("SPECIALIST_REVIEW");
    await expect(confirmStage(docB, st)).rejects.toThrow();
    await expect(confirmStage(docA, st)).resolves.toMatchObject({ status: "CONFIRMED" });
  });
});

describe("assignment closure: awaiting list, self-claim, specialist scope, manager reassignment (database)", () => {
  const tag4 = `m083r5c-${randomUUID().slice(0, 8)}`;
  let branchId = 0, otherBranchId = 0, centerId = 0, otherCenterId = 0;
  let docA: { id: string }, docB: { id: string }, docOutside: { id: string }, manager: { id: string }, otherManager: { id: string }, centralOnly: { id: string }, inactiveManager: { id: string }, noPermManager: { id: string }, resident: { id: string }, receptionist: { id: string }, otherBranchResident: { id: string };
  const handoffPerms = new Set(["handoff.send", "handoff.receive", "journey.confirm", "journey.manage"]);
  const act = (u: { id: string }, role: any = "DOCTOR") => ({ userId: u.id, role, permissions: handoffPerms });
  const newPatient = async () => (await prisma.patient.create({ data: { fullName: `${tag4} p-${randomUUID().slice(0, 6)}`, branchId } })).id;
  const mkStage = (patientId: string, data: any = {}) =>
    prisma.careStage.create({ data: { patientId, station: "طبيب/تشخيص", responsibleRole: "DOCTOR", sequence: 0, ...data } }).then((x) => x.id);
  const stage = (id: string) => prisma.careStage.findUniqueOrThrow({ where: { id } });
  const confirmAs = (u: { id: string }, patientId: string, stageId: string) =>
    prisma.$transaction((tx) => transitionCareStage(tx, { userId: u.id, role: "DOCTOR", name: "n" }, { patientId, stageId, to: "CONFIRMED" }), { isolationLevel: "Serializable" });
  const reassign = (m: { id: string }, patientId: string, stageId: string, to: string, expected: string | null, reason: string) =>
    prisma.$transaction((tx) => reassignCenterStage(tx, { userId: m.id, role: "MANAGER" }, { patientId, stageId, newAssigneeId: to, expectedAssigneeId: expected, reason }), { isolationLevel: "Serializable" });

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `${tag4} b1` } })).id;
    otherBranchId = (await prisma.branch.create({ data: { name: `${tag4} b2` } })).id;
    centerId = (await prisma.center.create({ data: { name: `${tag4} c1` } })).id;
    otherCenterId = (await prisma.center.create({ data: { name: `${tag4} c2` } })).id;
    const mk = (role: any, name: string, b = branchId) => prisma.user.create({ data: { username: `${tag4}-${name}`, fullName: `${tag4} ${name}`, role, branchId: b, passwordHash: "!" } });
    docA = await mk("DOCTOR", "a"); docB = await mk("DOCTOR", "b"); docOutside = await mk("DOCTOR", "outside");
    manager = await mk("MANAGER", "mgr"); otherManager = await mk("MANAGER", "mgr2"); centralOnly = await mk("MANAGER", "central");
    inactiveManager = await mk("MANAGER", "mgr-inactive"); noPermManager = await mk("MANAGER", "mgr-noperm");
    resident = await mk("RESIDENT", "res"); receptionist = await mk("RECEPTION", "rec"); otherBranchResident = await mk("RESIDENT", "res2", otherBranchId);
    await prisma.centerMembership.createMany({ data: [
      { centerId, userId: docA.id, role: "SPECIALIST", status: "ACTIVE" },
      { centerId, userId: docB.id, role: "SPECIALIST", status: "ACTIVE" },
      { centerId: otherCenterId, userId: docOutside.id, role: "SPECIALIST", status: "ACTIVE" },
      { centerId, userId: manager.id, role: "CENTER_MANAGEMENT", status: "ACTIVE" },
      { centerId: otherCenterId, userId: otherManager.id, role: "CENTER_MANAGEMENT", status: "ACTIVE" },
      { centerId, userId: inactiveManager.id, role: "CENTER_MANAGEMENT", status: "INACTIVE" },
      { centerId, userId: noPermManager.id, role: "CENTER_MANAGEMENT", status: "ACTIVE" },
      { centerId, userId: resident.id, role: "RESIDENT", status: "ACTIVE" },
    ] });
    // Only the fixture that tests a missing modification permission is customised; the others use DEFAULT MANAGER permissions.
    await prisma.userPermission.create({ data: { userId: noPermManager.id, permKey: "journey.manage", allowed: false } });
  });
  afterAll(async () => { await prisma.user.updateMany({ where: { username: { startsWith: tag4 } }, data: { isActive: false } }); });

  it("an unassigned stage is listed for scoped actors with existing permissions only", async () => {
    const p = await newPatient();
    const st = await mkStage(p, { responsibilityScope: "CENTER", responsibleCenterId: centerId });
    const svc = await mkStage(p, { responsibilityScope: "SERVICE", sequence: 1 });
    const ids = async (u: { id: string }, role: any, perms: string[]) =>
      (await listStagesAwaitingAssignment(prisma, { userId: u.id, role, permissions: new Set(perms) }, 200)).map((x) => x.id);
    const all = ["journey.view", "handoff.send", "journey.manage"];
    expect(await ids(resident, "RESIDENT", all)).toContain(st);
    expect(await ids(resident, "RESIDENT", all)).not.toContain(svc);
    expect(await ids(resident, "RESIDENT", ["journey.view", "handoff.send"])).not.toContain(st);
    expect(await ids(receptionist, "RECEPTION", ["handoff.send"])).not.toContain(st);
    expect(await ids(otherBranchResident, "RESIDENT", all)).not.toContain(st);
    await prisma.careStage.update({ where: { id: st }, data: { assignedUserId: docA.id } });
    expect(await ids(resident, "RESIDENT", all)).not.toContain(st);
  });

  it("a clinician cannot claim a stage by handing it to themselves", async () => {
    const p = await newPatient();
    const st = await mkStage(p, { responsibilityScope: "CENTER", responsibleCenterId: centerId });
    await expect(sendHandoff(act(docA), { patientId: p, toRole: "DOCTOR", toCenterId: centerId, toUserId: docA.id, careStageId: st })).rejects.toThrow();
    const h = await sendHandoff(act(docA), { patientId: p, toRole: "DOCTOR", toCenterId: centerId, careStageId: st });
    await expect(acceptHandoff(act(docA), h.id)).rejects.toThrow();
    expect((await stage(st)).assignedUserId).toBeNull();
  });

  it("specialist stage is classified SPECIALIST_REVIEW, not assignable by handoff, and legacy NULL stays closed", async () => {
    const p = await newPatient();
    const referral = await prisma.referralRequest.create({ data: {
      patientId: p, createdById: resident.id, type: "SPECIALIST", destinationScope: "INTERNAL_SPECIALIST",
      assignedReviewerId: docA.id, requestedService: tag4, clinicalReason: tag4, status: "READY",
    } });
    const rp = new Set(["referrals.view", "referrals.accept"]);
    await transitionReferralRequest(referral.id, "ACCEPTED", { acceptedById: docA.id }, { userId: docA.id, role: "DOCTOR", permissions: rp });
    const st = (await prisma.referralRequest.findUniqueOrThrow({ where: { id: referral.id } })).careStageId!;
    const row = await stage(st);
    expect(row).toMatchObject({ responsibilityScope: "SPECIALIST_REVIEW", assignedUserId: docA.id });
    await expect(sendHandoff(act(resident, "RESIDENT"), { patientId: p, toRole: "DOCTOR", toCenterId: centerId, careStageId: st })).rejects.toThrow();
    await expect(confirmAs(docB, p, st)).rejects.toThrow();
    await expect(confirmAs(docA, p, st)).resolves.toMatchObject({ status: "CONFIRMED" });
    // A NULL-scope stage that merely looks specialist (assignee set, referral linked) is still blocked.
    const p2 = await newPatient();
    const legacy = await mkStage(p2, { assignedUserId: docA.id });
    await prisma.referralRequest.create({ data: {
      patientId: p2, createdById: resident.id, type: "SPECIALIST", destinationScope: "INTERNAL_SPECIALIST", assignedReviewerId: docA.id,
      acceptedById: docA.id, requestedService: tag4, clinicalReason: tag4, status: "ACCEPTED", careStageId: legacy,
    } });
    await expect(confirmAs(docA, p2, legacy)).rejects.toThrow();
    expect((await stage(legacy)).status).toBe("WAITING");
  });

  it("manager reassignment of a CENTER stage: scoped, reasoned, audited, no confirmation privilege gained", async () => {
    const p = await newPatient();
    const st = await mkStage(p, { responsibilityScope: "CENTER", responsibleCenterId: centerId, assignedUserId: docA.id, assignedAt: new Date() });
    const audits = () => prisma.auditLog.count({ where: { recordId: st, tableName: "care_stages" } });
    const before = await audits();
    await expect(reassign(manager, p, st, docB.id, docA.id, "  ")).rejects.toThrow();
    await expect(reassign(otherManager, p, st, docB.id, docA.id, "نقل")).rejects.toThrow(); // managed center is another one
    await expect(reassign(centralOnly, p, st, docB.id, docA.id, "نقل")).rejects.toThrow(); // default MANAGER: central view only
    await expect(reassign(inactiveManager, p, st, docB.id, docA.id, "نقل")).rejects.toThrow();
    await expect(reassign(noPermManager, p, st, docB.id, docA.id, "نقل")).rejects.toThrow(); // lacks journey.manage
    await expect(reassign(manager, p, st, docOutside.id, docA.id, "نقل")).rejects.toThrow();
    await expect(reassign(manager, p, st, docB.id, null, "نقل")).rejects.toThrow();
    await expect(reassign({ id: resident.id }, p, st, docB.id, docA.id, "نقل")).rejects.toThrow();
    expect((await stage(st)).assignedUserId).toBe(docA.id);
    expect(await audits()).toBe(before);
    await expect(reassign(manager, p, st, docB.id, docA.id, "إجازة الطبيب")).resolves.toEqual({ former: docA.id });
    const after = await stage(st);
    expect(after.assignedUserId).toBe(docB.id);
    expect(await audits()).toBe(before + 1);
    const log = await prisma.auditLog.findFirst({ where: { recordId: st, tableName: "care_stages" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(log?.oldValue)).toContain(docA.id);
    expect(JSON.stringify(log?.newValue)).toContain("إجازة الطبيب");
    expect(await prisma.notification.count({ where: { careStageId: st, targetUserId: { in: [docA.id, docB.id] } } })).toBe(2);
    await expect(confirmAs(docA, p, st)).rejects.toThrow();
    await expect(confirmAs(docB, p, st)).resolves.toMatchObject({ status: "CONFIRMED" });
    // A stale second reassignment (expected assignee no longer current) is rejected without side effects.
    const st2 = await mkStage(p, { responsibilityScope: "CENTER", responsibleCenterId: centerId, assignedUserId: docB.id, sequence: 1 });
    await expect(reassign(manager, p, st2, docA.id, docA.id, "قديم")).rejects.toThrow();
    expect((await stage(st2)).assignedUserId).toBe(docB.id);
  });

  it("SERVICE stages cannot be reassigned by a manager (no scope relation exists)", async () => {
    const p = await newPatient();
    const st = await mkStage(p, { responsibilityScope: "SERVICE", assignedUserId: docA.id });
    await expect(reassign(manager, p, st, docB.id, docA.id, "نقل")).rejects.toThrow();
    expect((await stage(st)).assignedUserId).toBe(docA.id);
  });
});
