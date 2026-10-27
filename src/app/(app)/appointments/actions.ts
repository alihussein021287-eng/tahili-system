"use server";
import { prisma } from "@/lib/db";
import { withLockedAppointment } from "@/lib/appointment-lifecycle";
import { logAudit } from "@/lib/audit";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { assertPatientActionScope } from "@/lib/patient-guard";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseOrThrow, appointmentCreateSchema, appointmentStatusSchema } from "@/lib/validate";
import { getAdminConfig } from "@/lib/admin-config";
import { assertCenterHallById } from "@/lib/center-halls";

async function assertAppointmentPatientScope(id: string) {
  const row = await prisma.appointment.findUnique({ where: { id }, select: { patientId: true } });
  if (!row) throw new Error("الموعد غير موجود");
  await assertPatientActionScope(row.patientId, "record");
}

function normalizeDateTime(value: Date) {
  const d = new Date(value);
  d.setSeconds(0, 0);
  return d;
}

function withSaved(path: string, message: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}saved=${encodeURIComponent(message)}`;
}

function optionalPositiveInt(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function appointmentConflict(params: { patientId: string; assignedTo?: string | null; scheduledAt: Date; excludeId?: string; hallId?: number | null }, db = prisma as import("@prisma/client").Prisma.TransactionClient) {
  const when = normalizeDateTime(params.scheduledAt);
  const nextMinute = new Date(when.getTime() + 60000);
  const or: any[] = [
    { patientId: params.patientId },
    ...(params.assignedTo ? [{ assignedTo: params.assignedTo }] : []),
  ];
  if (params.hallId) or.push({ hallId: params.hallId }, { session: { is: { hallId: params.hallId } } });
  const conflicts = await db.appointment.findMany({
    where: {
      id: params.excludeId ? { not: params.excludeId } : undefined,
      status: "SCHEDULED",
      scheduledAt: { gte: when, lt: nextMinute },
      OR: or,
    },
    select: { patientId: true, assignedTo: true, hallId: true, session: { select: { hallId: true } } },
    take: 2,
  });
  if (conflicts.some((c) => c.patientId === params.patientId)) return "يوجد موعد آخر لنفس المراجع في نفس الوقت";
  if (params.assignedTo && conflicts.some((c) => c.assignedTo === params.assignedTo)) return "يوجد موعد آخر لنفس المسؤول في نفس الوقت";
  if (params.hallId && conflicts.some((c) => c.hallId === params.hallId || c.session?.hallId === params.hallId)) return "يوجد موعد آخر لنفس الفرع/القاعة في نفس الوقت";
  return null;
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function appointmentPolicyError(when: Date) {
  const config = await getAdminConfig();
  const day = String(when.getDay());
  if (!config.workDays.map(String).includes(day)) return "الموعد خارج أيام الدوام المحددة في الإعدادات";
  const holidaySet = new Set((config.holidays || "").split(/[,\n]+/).map((item) => item.trim()).filter(Boolean));
  if (holidaySet.has(dateKey(when))) return "التاريخ المحدد عطلة رسمية حسب الإعدادات";
  const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  if (time < config.workStart || time >= config.workEnd) return "وقت الموعد خارج ساعات الدوام المحددة في الإعدادات";
  return null;
}

export async function createAppointment(fd: FormData) {
  await assertPerm("appointments.create");
  await assertPatientActionScope(fd.get("patientId")?.toString() || "", "record");
  const v = parseOrThrow(appointmentCreateSchema, {
    patientId: fd.get("patientId")?.toString() || "",
    scheduledAt: fd.get("scheduledAt")?.toString() || "",
    type: fd.get("type")?.toString() || null,
    therapyType: fd.get("therapyType")?.toString() || "",
    assignedTo: fd.get("assignedTo")?.toString() || null,
    notes: fd.get("notes")?.toString() || null,
  });
  const patientId = v.patientId;
  const assignedTo = v.assignedTo || null;
  const when = normalizeDateTime(new Date(v.scheduledAt));
  const centerId = optionalPositiveInt(fd.get("centerId"));
  const hallId = optionalPositiveInt(fd.get("hallId"));
  if (hallId && !centerId) redirect(withSaved("/appointments", "اختر المركز قبل القاعة"));
  if (centerId) {
    if (!(await prisma.center.count({ where: { id: centerId, active: true } }))) redirect(withSaved("/appointments", "المركز غير صالح"));
    if (hallId) await assertCenterHallById(prisma, centerId, hallId).catch((error) => redirect(withSaved("/appointments", error instanceof Error ? error.message : "الفرع/القاعة لا يتبع المركز المختار")));
  }
  const policyError = await appointmentPolicyError(when);
  if (policyError) redirect(withSaved("/appointments", policyError));
  const conflict = await appointmentConflict({ patientId, assignedTo, scheduledAt: when, hallId });
  if (conflict) redirect(withSaved("/appointments", conflict));
  const created = await prisma.appointment.create({ data: {
    patientId, scheduledAt: when,
    type: v.type || null,
    therapyType: (v.therapyType || null) as any,
    assignedTo,
    centerId,
    hallId,
    notes: v.notes || null,
  }});
  await logAudit({ action: "CREATE", tableName: "appointments", recordId: created.id });
  revalidatePath("/appointments"); revalidatePath("/appointments/calendar"); revalidatePath("/");
  redirect(withSaved("/appointments", "تمت إضافة الموعد"));
}

export async function updateAppointmentCenterHall(id: string, fd: FormData) {
  await assertPerm("appointments.edit");
  await assertAppointmentPatientScope(id);
  await withLockedAppointment(id, "appointments.edit", async (tx, current, user) => {
    if (current.sessionId) redirect(withSaved("/appointments", "موعد الجلسة مرتبط بالخطة العلاجية"));
    const centerId = optionalPositiveInt(fd.get("centerId"));
    const hallId = optionalPositiveInt(fd.get("hallId"));
    if (hallId && !centerId) redirect(withSaved("/appointments", "اختر المركز قبل القاعة"));
    if (centerId) {
      if (!(await tx.center.count({ where: { id: centerId, active: true } }))) redirect(withSaved("/appointments", "المركز غير صالح"));
      if (hallId) await assertCenterHallById(tx, centerId, hallId).catch((error) => redirect(withSaved("/appointments", error instanceof Error ? error.message : "الفرع/القاعة لا يتبع المركز المختار")));
    }
    if (hallId) {
      const conflict = await appointmentConflict({ patientId: current.patientId, assignedTo: current.assignedTo, scheduledAt: current.scheduledAt, excludeId: id, hallId }, tx);
      if (conflict) redirect(withSaved("/appointments", conflict));
    }
    await tx.appointment.update({ where: { id }, data: { centerId, hallId } });
    await tx.auditLog.create({ data: { userId: user.id, actorUsername: user.username, actorName: user.fullName, action: "UPDATE", tableName: "appointments", recordId: id, newValue: { centerId, hallId } } });
  });
  revalidatePath("/appointments"); revalidatePath("/appointments/calendar"); revalidatePath("/");
  redirect(withSaved("/appointments", "تم تعديل مركز/قاعة الموعد"));
}

export async function setAppointmentStatus(id: string, status: string) {
  await assertPerm("appointments.edit");
  await assertAppointmentPatientScope(id);
  const validStatus = parseOrThrow(appointmentStatusSchema, status);
  await withLockedAppointment(id, "appointments.edit", async (tx, current, user) => {
    if (current.session?.treatmentPlanId && validStatus === "COMPLETED" && !user.permissions.has("therapy.admin.override")) throw new Error("غير مصرح");
    if (current.session?.plan?.status === "COMPLETED" && !user.permissions.has("therapy.admin.override")) throw new Error("غير مصرح");
    // A repeated status is a no-op, including its audit.
    const changed = await tx.appointment.updateMany({ where: { id, status: { not: validStatus as any } }, data: { status: validStatus as any } });
    if (changed.count === 1) await tx.auditLog.create({ data: { userId: user.id, actorUsername: user.username, actorName: user.fullName,
      action: "UPDATE", tableName: "appointments", recordId: id, newValue: { status: validStatus } } });
  });
  revalidatePath("/appointments"); revalidatePath("/appointments/calendar"); revalidatePath("/");
}

export async function deleteAppointment(id: string) {
  await assertAdminDelete();
  await assertPerm("appointments.delete");
  await assertAppointmentPatientScope(id);
  await withLockedAppointment(id, "appointments.delete", async (tx, _current, user) => {
    if (user.role !== "ADMIN") throw new Error("غير مصرح");
    await tx.appointment.delete({ where: { id } });
    await tx.auditLog.create({ data: { userId: user.id, actorUsername: user.username, actorName: user.fullName,
      action: "DELETE", tableName: "appointments", recordId: id } });
  });
  revalidatePath("/appointments"); revalidatePath("/appointments/calendar"); revalidatePath("/");
}

export async function rescheduleAppointment(id: string, fd: FormData) {
  await assertPerm("appointments.edit");
  await assertAppointmentPatientScope(id);
  const t = fd.get("scheduledAt")?.toString();
  if (!t) return;
  if (Number.isNaN(Date.parse(t))) throw new Error("تاريخ/وقت غير صحيح");
  await withLockedAppointment(id, "appointments.edit", async (tx, current, user) => {
    if (current.session?.plan?.status === "COMPLETED" && !user.permissions.has("therapy.admin.override")) throw new Error("غير مصرح");
    const when = normalizeDateTime(new Date(t));
    const policyError = await appointmentPolicyError(when);
    if (policyError) redirect(withSaved("/appointments", policyError));
    const conflict = await appointmentConflict({ patientId: current.patientId, assignedTo: current.assignedTo, scheduledAt: when, excludeId: id, hallId: current.hallId || current.session?.hallId }, tx);
    if (conflict) redirect(withSaved("/appointments", conflict));
    await tx.appointment.update({ where: { id }, data: { scheduledAt: when } });
    await tx.auditLog.create({ data: { userId: user.id, actorUsername: user.username, actorName: user.fullName,
      action: "UPDATE", tableName: "appointments", recordId: id, newValue: { rescheduled: true } } });
  });
  revalidatePath("/appointments"); revalidatePath("/appointments/calendar"); revalidatePath("/");
  redirect(withSaved("/appointments", "تم نقل الموعد"));
}
