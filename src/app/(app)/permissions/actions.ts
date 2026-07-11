"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

async function reqAdmin() {
  const s = await getServerSession(authOptions);
  if (!canManageUsers((s?.user as any)?.role)) throw new Error("غير مصرّح");
}
export async function setRolePerm(role: any, key: string, allowed: boolean) {
  await reqAdmin();
  await prisma.rolePermission.upsert({
    where: { role_permKey: { role, permKey: key } },
    update: { allowed }, create: { role, permKey: key, allowed },
  });
  await logAudit({ action: "UPDATE", tableName: "role_permissions", recordId: String(role), newValue: { [key]: allowed } });
  revalidatePath("/permissions");
}
export async function setUserPerm(userId: string, key: string, allowed: boolean) {
  await reqAdmin();
  await prisma.userPermission.upsert({
    where: { userId_permKey: { userId, permKey: key } },
    update: { allowed }, create: { userId, permKey: key, allowed },
  });
  await logAudit({ action: "UPDATE", tableName: "user_permissions", recordId: userId, newValue: { [key]: allowed } });
  revalidatePath("/permissions");
}
export async function clearUserPerms(userId: string) {
  await reqAdmin();
  await prisma.userPermission.deleteMany({ where: { userId } });
  await logAudit({ action: "DELETE", tableName: "user_permissions", recordId: userId });
  revalidatePath("/permissions");
}

// إرجاع الدور لقالبه الافتراضي: حذف كل تجاوزات الدور المخزّنة
export async function resetRolePerms(role: any) {
  await reqAdmin();
  await prisma.rolePermission.deleteMany({ where: { role } });
  await logAudit({ action: "UPDATE", tableName: "role_permissions", recordId: `reset:${role}`, newValue: { reset: true } });
  revalidatePath("/permissions");
}
