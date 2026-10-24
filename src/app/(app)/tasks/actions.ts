"use server";
import { requireSession } from "@/lib/access";
import { assertOptionalPatientScope } from "@/lib/patient-guard";
import { prisma } from "@/lib/db";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseOrThrow, taskCreateSchema } from "@/lib/validate";
import { notifyRole, notifyUser } from "@/lib/notify";
import { loadPermissionsFromStore } from "@/lib/permission-store";
import { patientScopeWhere } from "@/lib/patient-access";
import type { TaskStatus } from "@prisma/client";

function withSaved(message: string, returnTo?: string) {
  if (returnTo === "staff") return "/staff?tab=tasks&saved=" + encodeURIComponent(message);
  return "/tasks?saved=" + encodeURIComponent(message);
}

export async function createTask(fd: FormData) {
  const s = await requireSession();
  await assertPerm("tasks.create");
  const returnTo = fd.get("returnTo")?.toString();
  const title = fd.get("title")?.toString().trim();
  if (!title) redirect(withSaved("عنوان المهمة مطلوب", returnTo));
  const v = parseOrThrow(taskCreateSchema, {
    title,
    description: fd.get("description")?.toString() || null,
    priority: fd.get("priority")?.toString() || "",
    dueDate: fd.get("dueDate")?.toString() || "",
  });
  const assignedToId = fd.get("assignedToId")?.toString() || null;
  const assignedRole = fd.get("assignedRole")?.toString() || null;
  const patientId = fd.get("patientId")?.toString() || null;
  await assertOptionalPatientScope(patientId);
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
  revalidatePath("/tasks"); revalidatePath("/staff"); revalidatePath("/");
  redirect(withSaved("تمت إضافة المهمة", returnTo));
}

async function transitionTask(id: string, status: TaskStatus, from: TaskStatus[]) {
  const s = await requireSession();
  await assertPerm("tasks.complete");
  const actor = s.user as { id: string; role: string; authVersion: number };
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR SHARE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!user.isActive || user.needsActivation || user.role !== actor.role || user.authVersion !== actor.authVersion) throw new Error("غير مصرح");
    const permissions = await loadPermissionsFromStore(user.id, user.role, {
      findRolePermissions: (role) => tx.rolePermission.findMany({ where: { role } }),
      findUserPermissions: (userId) => tx.userPermission.findMany({ where: { userId } }),
    });
    if (!permissions.has("tasks.complete")) throw new Error("غير مصرح");
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`;
    const task = await tx.task.findUniqueOrThrow({ where: { id } });
    // Task's stored user and/or role recipients match the existing My Work filters.
    if (task.assignedToId !== user.id && task.assignedRole !== user.role) throw new Error("المهمة غير مسندة إليك");
    const scope = task.patientId ? await patientScopeWhere(tx, { userId: user.id, role: user.role, permissions }) : null;
    const changed = await tx.task.updateMany({ where: {
      id, status: { in: from },
      ...(scope ? { patient: { is: scope } } : {}),
    }, data: { status, completedAt: status === "DONE" ? new Date() : null, completedById: status === "DONE" ? user.id : null } });
    if (changed.count !== 1) throw new Error("المهمة خارج نطاقك أو تغيرت حالتها");
    await tx.auditLog.create({ data: { userId: user.id, actorUsername: user.username, actorName: user.fullName,
      action: "UPDATE", tableName: "tasks", recordId: id, oldValue: { status: task.status }, newValue: { status } } });
  }, { isolationLevel: "Serializable" });
  revalidatePath("/tasks"); revalidatePath("/staff"); revalidatePath("/");
}

export async function startTask(id: string) {
  await transitionTask(id, "IN_PROGRESS", ["OPEN"]);
}

export async function completeTask(id: string) {
  await transitionTask(id, "DONE", ["OPEN", "IN_PROGRESS"]);
}

export async function reopenTask(id: string) {
  await transitionTask(id, "OPEN", ["DONE"]);
}

export async function deleteTask(id: string) {
  await assertAdminDelete();
  await assertPerm("tasks.delete");
  await prisma.task.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "tasks", recordId: id });
  revalidatePath("/tasks"); revalidatePath("/staff"); revalidatePath("/");
}
