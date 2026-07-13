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
