"use server";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseOrThrow, taskCreateSchema } from "@/lib/validate";
import { notifyRole, notifyUser } from "@/lib/notify";

function withSaved(message: string) {
  return "/tasks?saved=" + encodeURIComponent(message);
}

export async function createTask(fd: FormData) {
  const s = await getServerSession(authOptions);
  await assertPerm("tasks.create");
  const title = fd.get("title")?.toString().trim();
  if (!title) redirect(withSaved("عنوان المهمة مطلوب"));
  const v = parseOrThrow(taskCreateSchema, {
    title,
    description: fd.get("description")?.toString() || null,
    priority: fd.get("priority")?.toString() || "",
    dueDate: fd.get("dueDate")?.toString() || "",
  });
  const assignedToId = fd.get("assignedToId")?.toString() || null;
  const assignedRole = fd.get("assignedRole")?.toString() || null;
  const patientId = fd.get("patientId")?.toString() || null;
  const t = await prisma.task.create({
    data: {
      title: v.title,
      description: v.description || null,
      priority: (v.priority || "NORMAL") as any,
      assignedToId: assignedToId || null,
      assignedRole: (assignedRole as any) || null,
      patientId: patientId || null,
      dueDate: v.dueDate ? new Date(v.dueDate) : null,
      createdById: (s?.user as any)?.id,
    },
  });
  await logAudit({ action: "CREATE", tableName: "tasks", recordId: t.id });
  const body = v.dueDate ? `تاريخ الاستحقاق: ${v.dueDate}` : undefined;
  if (assignedToId) await notifyUser(assignedToId, "مهمة جديدة", { body: `${v.title}${body ? ` — ${body}` : ""}`, link: "/tasks" });
  if (assignedRole) await notifyRole(assignedRole, "مهمة جديدة للدور", { body: `${v.title}${body ? ` — ${body}` : ""}`, link: "/tasks" });
  revalidatePath("/tasks"); revalidatePath("/");
  redirect(withSaved("تمت إضافة المهمة"));
}

export async function startTask(id: string) {
  await assertPerm("tasks.complete");
  await prisma.task.update({ where: { id }, data: { status: "IN_PROGRESS" } });
  await logAudit({ action: "UPDATE", tableName: "tasks", recordId: id, newValue: { status: "IN_PROGRESS" } });
  revalidatePath("/tasks"); revalidatePath("/");
}

export async function completeTask(id: string) {
  const s = await getServerSession(authOptions);
  await assertPerm("tasks.complete");
  await prisma.task.update({ where: { id }, data: { status: "DONE", completedAt: new Date(), completedById: (s?.user as any)?.id } });
  await logAudit({ action: "UPDATE", tableName: "tasks", recordId: id, newValue: { status: "DONE" } });
  revalidatePath("/tasks"); revalidatePath("/");
}

export async function reopenTask(id: string) {
  await assertPerm("tasks.complete");
  await prisma.task.update({ where: { id }, data: { status: "OPEN", completedAt: null, completedById: null } });
  await logAudit({ action: "UPDATE", tableName: "tasks", recordId: id, newValue: { status: "OPEN" } });
  revalidatePath("/tasks"); revalidatePath("/");
}

export async function deleteTask(id: string) {
  await assertAdminDelete();
  await assertPerm("tasks.delete");
  await prisma.task.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "tasks", recordId: id });
  revalidatePath("/tasks"); revalidatePath("/");
}
