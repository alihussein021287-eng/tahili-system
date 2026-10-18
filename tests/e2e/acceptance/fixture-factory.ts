import { prisma } from "@/lib/db";
import { RUN_ID } from "./helpers";

let sequence = 0;
// Rehearsal fixtures belong to one branch so branch-scoped roles keep working on them (set by the fixture seed).
const ACCEPTANCE_BRANCH_ID = process.env.ACCEPTANCE_BRANCH_ID ? Number(process.env.ACCEPTANCE_BRANCH_ID) : undefined;

export async function referralPatient(label: string) {
  sequence += 1;
  const creator = await prisma.user.findUniqueOrThrow({ where: { username: "acceptance-20260713-data-entry" } });
  return prisma.patient.create({
    data: {
      fullName: `ACCEPTANCE-20260713 ${RUN_ID} ${label}`,
      phone: `0789${Date.now().toString().slice(-6)}${sequence}`.slice(0, 11),
      caseType: "WOUNDED",
      inMobilization: true,
      notes: `ACCEPTANCE-20260713 ${RUN_ID} بيانات إحالة تجريبية`,
      dataEntryBy: creator.fullName,
      createdById: creator.id,
      branchId: ACCEPTANCE_BRANCH_ID,
    },
  });
}

export async function acceptanceDoctor() {
  return prisma.user.findUniqueOrThrow({ where: { username: "acceptance-20260713-doctor" } });
}

export async function clinicalPatient(label: string, eligible: boolean) {
  sequence += 1;
  const creator = await prisma.user.findUniqueOrThrow({ where: { username: "acceptance-20260713-data-entry" } });
  // A prescription needs an explicit Visit: every clinical fixture patient has a visit today in the acceptance branch.
  const patient = await prisma.patient.create({
    data: {
      fullName: `ACCEPTANCE-20260713 ${RUN_ID} ${label}`,
      phone: `0778${Date.now().toString().slice(-6)}${sequence}`.slice(0, 11),
      caseType: eligible ? "WOUNDED" : "SICK",
      inMobilization: eligible,
      notes: `ACCEPTANCE-20260713 ${RUN_ID} بيانات سريرية تجريبية`,
      dataEntryBy: creator.fullName,
      createdById: creator.id,
      branchId: ACCEPTANCE_BRANCH_ID,
    },
  });
  await prisma.visit.create({ data: { patientId: patient.id, visitDate: new Date(), branchId: ACCEPTANCE_BRANCH_ID, notes: "ACCEPTANCE-20260713 fixture visit" } });
  return patient;
}

export async function ensureAcceptancePatientFixture(id: string, fullName: string, fileNumber?: number) {
  const creator = await prisma.user.findUniqueOrThrow({ where: { username: "acceptance-20260713-data-entry" } });
  const base = {
    fullName,
    phone: `0777${Date.now().toString().slice(-6)}${sequence++}`.slice(0, 11),
    caseType: "WOUNDED" as const,
    inMobilization: true,
    status: "ACTIVE" as const,
    archivedAt: null,
    notes: `ACCEPTANCE-20260713 ${RUN_ID} fixture`,
    dataEntryBy: creator.fullName,
    createdById: creator.id,
    branchId: ACCEPTANCE_BRANCH_ID,
  };
  // The file number is cosmetic for the fixture; skip it when another patient already owns it (rehearsal data is shared).
  if (fileNumber) {
    const owner = await prisma.patient.findUnique({ where: { fileNumber }, select: { id: true } });
    if (owner && owner.id !== id) fileNumber = undefined;
  }
  return prisma.patient.upsert({
    where: { id },
    update: { ...base, ...(fileNumber ? { fileNumber } : {}) },
    create: { id, ...base, ...(fileNumber ? { fileNumber } : {}) },
  });
}

export async function ensureLegacyAcceptancePatients() {
  await ensureAcceptancePatientFixture("cmridqumv0019rr01watzuwzr", "ACCEPTANCE-20260713 مراجع 01 الاستقبال والطبيب والاختصاص");
  await ensureAcceptancePatientFixture("cmridquqw0029rr01epzlh9yc", "ACCEPTANCE-20260713 مراجع 19 رفض وإلغاء");
  await ensureAcceptancePatientFixture("cmridqunt001brr01xx57t1xa", "ACCEPTANCE-20260713 مراجع 20 مختبر");
  await ensureAcceptancePatientFixture("cmridqufinance0018rr01", "ACCEPTANCE-20260713 مراجع 18 صرفية جريح", 30);
}

export async function stockedMedication(label: string) {
  const medication = await prisma.medication.create({ data: { name: `ACCEPTANCE-20260713 ${RUN_ID} ${label}`, quantity: 20, minQuantity: 2, unit: "حبة" } });
  const batch = await prisma.medicationBatch.create({ data: { medicationId: medication.id, branchId: ACCEPTANCE_BRANCH_ID, batchNo: `${RUN_ID}-${label}`, quantity: 20, expiryDate: new Date("2027-12-31") } });
  return { medication, batch };
}

export async function admissionResource(label: string) {
  const center = await prisma.center.create({ data: { name: `ACCEPTANCE-20260713 ${RUN_ID} مركز ${label}`, type: "ADMISSION" } });
  const room = await prisma.room.create({ data: { name: `ACCEPTANCE-20260713 ${RUN_ID} غرفة ${label}`, capacity: 1 } });
  const bed = await prisma.bed.create({ data: { roomId: room.id, label: `سرير ${RUN_ID} ${label}` } });
  return { center, room, bed };
}

export async function acceptanceUser(username: string) {
  return prisma.user.findUniqueOrThrow({ where: { username } });
}

export async function centerByNamePart(part: string) {
  return prisma.center.findFirstOrThrow({ where: { name: { contains: part } } });
}

export async function ensureCenterMembership(centerId: number, userId: string, role: "CENTER_MANAGEMENT" | "HEAD_THERAPIST" | "THERAPIST" | "DEVICE_OPERATOR", specialty: string) {
  return prisma.centerMembership.upsert({
    where: { centerId_userId_role: { centerId, userId, role } },
    update: { status: "ACTIVE", specialty, endDate: null },
    create: { centerId, userId, role, specialty, status: "ACTIVE" },
  });
}

export async function acceptedCenterReferral(patientId: string, centerId: number, service: string) {
  const creator = await acceptanceDoctor();
  return prisma.referralRequest.create({
    data: {
      patientId,
      createdById: creator.id,
      assignedReviewerId: creator.id,
      destinationCenterId: centerId,
      type: "TREATMENT_CENTER",
      destinationScope: "INTERNAL_CENTER",
      requestedService: `ACCEPTANCE-20260713 ${RUN_ID} ${service}`,
      clinicalReason: `ACCEPTANCE-20260713 ${RUN_ID} سبب إحالة مركزية`,
      status: "READY",
    },
  });
}

export async function activeTherapyHall(label: string) {
  return prisma.therapyHall.upsert({
    where: { name: `ACCEPTANCE-20260713 ${RUN_ID} ${label}` },
    update: { active: true },
    create: { name: `ACCEPTANCE-20260713 ${RUN_ID} ${label}`, active: true },
  });
}
