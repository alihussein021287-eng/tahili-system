import type { Prisma } from "@prisma/client";
import { loadPermissionsFromStore } from "@/lib/permission-store";
import { canAccessPatientRecord } from "@/lib/patient-access";

type Actor = { id: string; role: string; authVersion?: number };

/** Raw row-lock conflicts are P2010/40001, unlike Prisma model-operation P2034.
 * Retry only the entire aborted transaction, so identity, permissions and plan state are read again.
 */
export async function withTherapySerializableRetry<T>(run: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const meta = error && typeof error === "object" && "meta" in error ? error.meta : undefined;
      const sqlState = meta && typeof meta === "object" && "code" in meta ? meta.code : undefined;
      if (attempt >= maxRetries || !(code === "P2034" || (code === "P2010" && sqlState === "40001"))) throw error;
    }
  }
}

/** Read authoritative identity and effective permissions after acquiring the clinical locks. */
export async function currentTherapyActor(tx: Prisma.TransactionClient, actor: Actor, permission: string, patientId?: string) {
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: {
    id: true, role: true, authVersion: true, isActive: true, needsActivation: true, username: true, fullName: true,
  } });
  if (!user?.isActive || user.needsActivation || user.role !== actor.role || user.authVersion !== actor.authVersion) throw new Error("غير مصرح");
  const permissions = await loadPermissionsFromStore(user.id, user.role, {
    findRolePermissions: (role) => tx.rolePermission.findMany({ where: { role } }),
    findUserPermissions: (userId) => tx.userPermission.findMany({ where: { userId } }),
  });
  if (!permissions.has(permission)) throw new Error("غير مصرح");
  if (patientId && !(await canAccessPatientRecord(tx, { userId: user.id, role: user.role, permissions }, patientId))) throw new Error("غير مصرح");
  return { ...user, permissions };
}

/** Every linked-session writer uses plan -> session -> appointment/log, matching finalization. */
export async function lockTherapySession(tx: Prisma.TransactionClient, id: string, patientId?: string) {
  const pointer = await tx.therapySession.findUniqueOrThrow({ where: { id }, select: { patientId: true, treatmentPlanId: true, updatedAt: true } });
  if (patientId && pointer.patientId !== patientId) throw new Error("الجلسة لا تتبع المراجع");
  if (pointer.treatmentPlanId) await tx.$queryRaw`SELECT id FROM "TreatmentPlan" WHERE id = ${pointer.treatmentPlanId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM therapy_sessions WHERE id = ${id} FOR UPDATE`;
  const session = await tx.therapySession.findUniqueOrThrow({ where: { id }, include: { plan: true } });
  if (session.patientId !== pointer.patientId || session.treatmentPlanId !== pointer.treatmentPlanId) throw new Error("تغير ارتباط الجلسة؛ حدّث الصفحة");
  return { session, readVersion: pointer.updatedAt };
}

export async function lockTherapyAppointment(tx: Prisma.TransactionClient, id: string) {
  const pointer = await tx.appointment.findUniqueOrThrow({ where: { id }, select: { patientId: true, sessionId: true } });
  if (!pointer.sessionId) throw new Error("الموعد غير مرتبط ببرنامج علاج");
  await lockTherapySession(tx, pointer.sessionId, pointer.patientId);
  await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${id} FOR UPDATE`;
  const appointment = await tx.appointment.findUniqueOrThrow({ where: { id }, include: { session: { include: { plan: true } } } });
  if (appointment.patientId !== pointer.patientId || appointment.sessionId !== pointer.sessionId) throw new Error("تغير ارتباط الموعد؛ حدّث الصفحة");
  return appointment;
}

export function assertSessionPlanEditable(plan: { status: string; finalDecision: string | null; evaluatedAt: Date | null } | null, permissions: ReadonlySet<string>) {
  if ((plan?.status === "COMPLETED" || (plan?.evaluatedAt && plan.finalDecision === "END")) && !permissions.has("therapy.admin.override")) {
    throw new Error("غير مصرح: الخطة مغلقة وتتطلب صلاحية التجاوز");
  }
}
