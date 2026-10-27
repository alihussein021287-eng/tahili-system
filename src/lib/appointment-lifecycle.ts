import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";
import { currentTherapyActor, lockTherapyAppointment } from "@/lib/therapy-session-lock";
import { withSerializableRetry } from "@/lib/serializable-retry";

export class CenterAppointmentLockedError extends Error {
  constructor() { super("البرنامج مقفل بعد إكمال العمل؛ لا تعديل موعد الجلسة"); }
}

/** Match the clinical writers' program -> session -> appointment lock order. */
export async function lockGeneralAppointment(tx: Prisma.TransactionClient, id: string) {
  const pointer = await tx.appointment.findUniqueOrThrow({ where: { id }, select: {
    patientId: true, sessionId: true, centerSession: { select: { id: true, programId: true } },
  } });
  if (pointer.centerSession) {
    const { programId, id: sessionId } = pointer.centerSession;
    await tx.$queryRaw`SELECT id FROM center_programs WHERE id=${programId} FOR UPDATE`;
    const program = await tx.centerProgram.findUniqueOrThrow({ where: { id: programId } });
    if (program.status !== "ACTIVE" || program.operationalCompletedAt || program.medicalClosedAt) {
      throw new CenterAppointmentLockedError();
    }
    await tx.$queryRaw`SELECT id FROM center_sessions WHERE id=${sessionId} FOR UPDATE`;
  }
  if (pointer.sessionId) await lockTherapyAppointment(tx, id);
  await tx.$queryRaw`SELECT id FROM appointments WHERE id=${id} FOR UPDATE`;
  const row = await tx.appointment.findUniqueOrThrow({ where: { id }, include: {
    session: { include: { plan: true } }, centerSession: true,
  } });
  if (row.patientId !== pointer.patientId || row.sessionId !== pointer.sessionId
    || row.centerSession?.id !== pointer.centerSession?.id
    || row.centerSession?.programId !== pointer.centerSession?.programId) {
    throw new Error("تغير ارتباط الموعد؛ حدّث الصفحة");
  }
  return row;
}

export async function withLockedAppointment<T>(id: string, permission: string, mutation: (
  tx: Prisma.TransactionClient,
  row: Awaited<ReturnType<typeof lockGeneralAppointment>>,
  user: Awaited<ReturnType<typeof currentTherapyActor>>,
) => Promise<T>) {
  const identity = (await requireSession()).user as { id: string; role: string; authVersion: number };
  return withSerializableRetry(() => prisma.$transaction(async tx => {
    const row = await lockGeneralAppointment(tx, id);
    const user = await currentTherapyActor(tx, identity, permission, row.patientId);
    return mutation(tx, row, user);
  }, { isolationLevel: "Serializable" }));
}
