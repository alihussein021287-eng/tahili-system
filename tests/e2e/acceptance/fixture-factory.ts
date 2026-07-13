import { prisma } from "@/lib/db";
import { RUN_ID } from "./helpers";

let sequence = 0;

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
    },
  });
}

export async function acceptanceDoctor() {
  return prisma.user.findUniqueOrThrow({ where: { username: "acceptance-20260713-doctor" } });
}

export async function clinicalPatient(label: string, eligible: boolean) {
  sequence += 1;
  const creator = await prisma.user.findUniqueOrThrow({ where: { username: "acceptance-20260713-data-entry" } });
  return prisma.patient.create({
    data: {
      fullName: `ACCEPTANCE-20260713 ${RUN_ID} ${label}`,
      phone: `0778${Date.now().toString().slice(-6)}${sequence}`.slice(0, 11),
      caseType: eligible ? "WOUNDED" : "SICK",
      inMobilization: eligible,
      notes: `ACCEPTANCE-20260713 ${RUN_ID} بيانات سريرية تجريبية`,
      dataEntryBy: creator.fullName,
      createdById: creator.id,
    },
  });
}

export async function stockedMedication(label: string) {
  const medication = await prisma.medication.create({ data: { name: `ACCEPTANCE-20260713 ${RUN_ID} ${label}`, quantity: 20, minQuantity: 2, unit: "حبة" } });
  const batch = await prisma.medicationBatch.create({ data: { medicationId: medication.id, batchNo: `${RUN_ID}-${label}`, quantity: 20, expiryDate: new Date("2027-12-31") } });
  return { medication, batch };
}

export async function admissionResource(label: string) {
  const center = await prisma.center.create({ data: { name: `ACCEPTANCE-20260713 ${RUN_ID} مركز ${label}`, type: "ADMISSION" } });
  const room = await prisma.room.create({ data: { name: `ACCEPTANCE-20260713 ${RUN_ID} غرفة ${label}`, capacity: 1 } });
  const bed = await prisma.bed.create({ data: { roomId: room.id, label: `سرير ${RUN_ID} ${label}` } });
  return { center, room, bed };
}
