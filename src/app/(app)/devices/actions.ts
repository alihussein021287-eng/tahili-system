"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";
import { notifyRole } from "@/lib/notify";

function withSaved(path: string, message: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}saved=${encodeURIComponent(message)}`;
}

async function guard(key: string) {
  const s = await requireSession();
  await assertPerm(key);
  return s;
}

export async function createDevice(fd: FormData) {
  const s = await guard("devices.create");
  const patientId = fd.get("patientId")?.toString();
  const type = fd.get("type")?.toString().trim();
  if (!patientId || !type) redirect(withSaved("/devices", "اختر المريض وأدخل نوع الجهاز"));
  const deliveredAt = fd.get("deliveredAt")?.toString();
  const nextM = fd.get("nextMaintenanceAt")?.toString();
  const dev = await prisma.device.create({ data: {
    patientId: patientId!, type: type!,
    serialNo: fd.get("serialNo")?.toString() || null,
    deliveredAt: deliveredAt ? new Date(deliveredAt) : undefined,
    nextMaintenanceAt: nextM ? new Date(nextM) : null,
    notes: fd.get("notes")?.toString() || null,
    createdById: (s?.user as any)?.id,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "devices", recordId: dev.id });
  revalidatePath("/devices"); revalidatePath("/");
  redirect(withSaved(`/devices?patientId=${patientId}`, "تم تسجيل تسليم الجهاز"));
}

export async function recordMaintenance(id: string, fd: FormData) {
  const s = await guard("devices.maintain");
  const nextM = fd.get("nextMaintenanceAt")?.toString();
  await prisma.device.update({ where: { id }, data: { status: "MAINTAINED", nextMaintenanceAt: nextM ? new Date(nextM) : null } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "devices", recordId: id });
  revalidatePath("/devices"); revalidatePath("/");
}

export async function markReplaced(id: string) {
  const s = await guard("devices.maintain");
  await prisma.device.update({ where: { id }, data: { status: "REPLACED", nextMaintenanceAt: null } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "devices", recordId: id });
  revalidatePath("/devices"); revalidatePath("/");
}

export async function deleteDevice(id: string) {
  await assertAdminDelete();
  const s = await guard("devices.delete");
  await prisma.device.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "devices", recordId: id });
  revalidatePath("/devices"); revalidatePath("/");
}

export async function createMaintenanceTask(id: string) {
  const s = await guard("tasks.create");
  const device = await prisma.device.findUnique({
    where: { id },
    include: { patient: { select: { id: true, fullName: true, fileNumber: true } } },
  });
  if (!device) redirect(withSaved("/devices", "الجهاز غير موجود"));
  const dueText = device.nextMaintenanceAt ? `موعد الصيانة: ${device.nextMaintenanceAt.toLocaleDateString("ar-IQ", { timeZone: "Asia/Baghdad" })}` : "بدون موعد محدد";
  const task = await prisma.task.create({
    data: {
      title: `صيانة جهاز: ${device.type}`,
      description: [
        `المراجع: ${device.patient.fullName} #${device.patient.fileNumber}`,
        device.serialNo ? `الرقم التسلسلي: ${device.serialNo}` : "",
        dueText,
        device.notes ? `ملاحظات الجهاز: ${device.notes}` : "",
      ].filter(Boolean).join("\n"),
      priority: device.nextMaintenanceAt && device.nextMaintenanceAt <= new Date() ? "HIGH" : "NORMAL",
      assignedRole: "PROSTHETICS",
      patientId: device.patientId,
      dueDate: device.nextMaintenanceAt,
      createdById: (s?.user as any)?.id,
    },
  });
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "tasks", recordId: task.id });
  await notifyRole("PROSTHETICS", "مهمة صيانة جهاز", { body: `${device.type} - ${device.patient.fullName}`, link: "/tasks?scope=role&role=PROSTHETICS" });
  revalidatePath("/devices"); revalidatePath("/tasks"); revalidatePath("/");
  redirect(withSaved(`/devices?patientId=${device.patientId}`, "تم إنشاء مهمة صيانة لفريق الأطراف"));
}
