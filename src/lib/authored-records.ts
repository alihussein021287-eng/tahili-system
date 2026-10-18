import { prisma } from "@/lib/db";

/**
 * Historical authored-record READ exception (owner decision, Mission 08.8-D).
 * After a PatientHandoff in which the clinician took part is DONE, the clinician may READ ONLY records whose authorship is
 * proven by a stored author identifier equal to their user id. Families with a trustworthy author column:
 *   MedicalReport.doctorId, Prescription.createdById, SickLeave.createdById.
 * Families WITHOUT one (Diagnosis, ResidentReview/vitals/wounds, DressingRecord, Admission, ...) stay fail-closed. Authorship is
 * never inferred from the free-text doctor name, role, branch, time or prior contact. The exception opens no patient file, edits
 * nothing and does not outlive a new normal assignment (normal rules apply separately).
 */
export const AUTHORED_FAMILIES = ["MedicalReport", "Prescription", "SickLeave"] as const;

export async function authoredPatientIds(userId: string) {
  const handoffs = await prisma.patientHandoff.findMany({
    where: { status: "DONE", OR: [{ fromUserId: userId }, { toUserId: userId }, { acceptedById: userId }] },
    select: { patientId: true }, distinct: ["patientId"], take: 2000,
  });
  return handoffs.map((h) => h.patientId);
}

export async function listAuthoredRecords(userId: string) {
  const patientIds = await authoredPatientIds(userId);
  if (!patientIds.length) return { reports: [], prescriptions: [], sickLeaves: [] };
  const patient = { select: { id: true, fullName: true, fileNumber: true } };
  const [reports, prescriptions, sickLeaves] = await Promise.all([
    prisma.medicalReport.findMany({ where: { doctorId: userId, patientId: { in: patientIds } }, include: { patient }, orderBy: { date: "desc" }, take: 200 }),
    prisma.prescription.findMany({ where: { createdById: userId, patientId: { in: patientIds } }, include: { patient, medication: { select: { name: true } } }, orderBy: { prescribedAt: "desc" }, take: 200 }),
    prisma.sickLeave.findMany({ where: { createdById: userId, patientId: { in: patientIds } }, include: { patient }, orderBy: { startDate: "desc" }, take: 200 }),
  ]);
  return { reports, prescriptions, sickLeaves };
}
