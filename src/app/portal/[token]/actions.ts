"use server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function respondAppointment(token: string, appointmentId: string, response: "CONFIRMED" | "CANCELLED") {
  const patient = await prisma.patient.findUnique({ where: { accessToken: token }, select: { id: true } });
  if (!patient) return;
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { patientId: true, status: true, scheduledAt: true } });
  if (!appt || appt.patientId !== patient.id) return;
  // The portal only lists future scheduled appointments; a token must not alter completed, cancelled or past ones.
  if (appt.status !== "SCHEDULED" || appt.scheduledAt.getTime() < Date.now()) return;
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { patientResponse: response, ...(response === "CANCELLED" ? { status: "CANCELLED" as any } : {}) },
  });
  revalidatePath(`/portal/${token}`);
}
