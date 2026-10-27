"use server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { CenterAppointmentLockedError, lockGeneralAppointment } from "@/lib/appointment-lifecycle";
import { withSerializableRetry } from "@/lib/serializable-retry";

export async function respondAppointment(token: string, appointmentId: string, response: "CONFIRMED" | "CANCELLED") {
  if (response !== "CONFIRMED" && response !== "CANCELLED") return;
  try {
    await withSerializableRetry(() => prisma.$transaction(async tx => {
      const patient = await tx.patient.findUnique({ where: { accessToken: token }, select: { id: true } });
      if (!patient) return;
      const pointer = await tx.appointment.findUnique({ where: { id: appointmentId }, select: { patientId: true } });
      if (!pointer || pointer.patientId !== patient.id) return;
      const appt = await lockGeneralAppointment(tx, appointmentId);
      // Keep the existing token, patient, future-date and scheduled-status contract.
      if (appt.patientId !== patient.id || appt.status !== "SCHEDULED" || appt.scheduledAt.getTime() < Date.now()) return;
      await tx.appointment.update({ where: { id: appointmentId }, data: {
        patientResponse: response, ...(response === "CANCELLED" ? { status: "CANCELLED" as const } : {}),
      } });
      await tx.auditLog.create({ data: { action: "UPDATE", tableName: "appointments", recordId: appointmentId,
        actorName: "بوابة المراجع", newValue: { patientResponse: response, ...(response === "CANCELLED" ? { status: "CANCELLED" } : {}) } } });
    }, { isolationLevel: "Serializable" }));
  } catch (error) {
    if (error instanceof CenterAppointmentLockedError) return;
    throw error;
  }
  revalidatePath(`/portal/${token}`);
}
