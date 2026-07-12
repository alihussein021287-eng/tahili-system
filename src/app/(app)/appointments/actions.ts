"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseOrThrow, appointmentCreateSchema, appointmentStatusSchema } from "@/lib/validate";

function normalizeDateTime(value: Date) {
  const d = new Date(value);
  d.setSeconds(0, 0);
  return d;
}

function withSaved(path: string, message: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}saved=${encodeURIComponent(message)}`;
}

async function appointmentConflict(params: { patientId: string; assignedTo?: string | null; scheduledAt: Date; excludeId?: string }) {
  const when = normalizeDateTime(params.scheduledAt);
  const nextMinute = new Date(when.getTime() + 60000);
  const conflicts = await prisma.appointment.findMany({
    where: {
      id: params.excludeId ? { not: params.excludeId } : undefined,
      status: "SCHEDULED",
      scheduledAt: { gte: when, lt: nextMinute },
      OR: [
        { patientId: params.patientId },
        ...(params.assignedTo ? [{ assignedTo: params.assignedTo }] : []),
      ],
    },
    select: { patientId: true, assignedTo: true },
    take: 2,
  });
  if (conflicts.some((c) => c.patientId === params.patientId)) return "يوجد موعد آخر لنفس المراجع في نفس الوقت";
  if (params.assignedTo && conflicts.some((c) => c.assignedTo === params.assignedTo)) return "يوجد موعد آخر لنفس المسؤول في نفس الوقت";
  return null;
}

async function linkedPlan(id: string) {
  return prisma.appointment.findUnique({ where: { id }, select: { session: { select: { treatmentPlanId: true, plan: { select: { status: true } } } } } });
}

export async function createAppointment(fd: FormData) {
  await assertPerm("appointments.create");
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
  const conflict = await appointmentConflict({ patientId, assignedTo, scheduledAt: when });
  if (conflict) redirect(withSaved("/appointments", conflict));
  const created = await prisma.appointment.create({ data: {
    patientId, scheduledAt: when,
    type: v.type || null,
    therapyType: (v.therapyType || null) as any,
    assignedTo,
    notes: v.notes || null,
  }});
  await logAudit({ action: "CREATE", tableName: "appointments", recordId: created.id });
  revalidatePath("/appointments"); revalidatePath("/appointments/calendar"); revalidatePath("/");
  redirect(withSaved("/appointments", "تمت إضافة الموعد"));
}

export async function setAppointmentStatus(id: string, status: string) {
  await assertPerm("appointments.edit");
  const validStatus = parseOrThrow(appointmentStatusSchema, status);
  const linked = await linkedPlan(id);
  if (linked?.session?.treatmentPlanId && validStatus === "COMPLETED") await assertPerm("therapy.admin.override");
  if (linked?.session?.plan?.status === "COMPLETED") await assertPerm("therapy.admin.override");
  await prisma.appointment.update({ where: { id }, data: { status: validStatus as any } });
  await logAudit({ action: "UPDATE", tableName: "appointments", recordId: id, newValue: { status } });
  revalidatePath("/appointments"); revalidatePath("/appointments/calendar"); revalidatePath("/");
}

export async function deleteAppointment(id: string) {
  await assertAdminDelete();
  await assertPerm("appointments.delete");
  await prisma.appointment.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "appointments", recordId: id });
  revalidatePath("/appointments"); revalidatePath("/appointments/calendar"); revalidatePath("/");
}

export async function rescheduleAppointment(id: string, fd: FormData) {
  await assertPerm("appointments.edit");
  const t = fd.get("scheduledAt")?.toString();
  if (!t) return;
  if (Number.isNaN(Date.parse(t))) throw new Error("تاريخ/وقت غير صحيح");
  const current = await prisma.appointment.findUnique({ where: { id }, select: { patientId: true, assignedTo: true, session: { select: { plan: { select: { status: true } } } } } });
  if (!current) redirect(withSaved("/appointments", "الموعد غير موجود"));
  if (current.session?.plan?.status === "COMPLETED") await assertPerm("therapy.admin.override");
  const when = normalizeDateTime(new Date(t));
  const conflict = await appointmentConflict({ patientId: current.patientId, assignedTo: current.assignedTo, scheduledAt: when, excludeId: id });
  if (conflict) redirect(withSaved("/appointments", conflict));
  await prisma.appointment.update({ where: { id }, data: { scheduledAt: when } });
  await logAudit({ action: "UPDATE", tableName: "appointments", recordId: id, newValue: { rescheduled: true } });
  revalidatePath("/appointments"); revalidatePath("/appointments/calendar"); revalidatePath("/");
  redirect(withSaved("/appointments", "تم نقل الموعد"));
}
