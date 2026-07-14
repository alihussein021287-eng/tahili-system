"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { ALL_PERMS, roleDefaultSet } from "@/lib/perms";
function assertKey(key: string) { if (!ALL_PERMS.includes(key)) throw new Error("مفتاح صلاحية غير معروف"); }

async function reqAdmin() {
  const s = await requireSession();
  if (!canManageUsers((s?.user as any)?.role)) throw new Error("غير مصرّح");
}
export async function setRolePerm(role: any, key: string, allowed: boolean) {
  await reqAdmin();
  assertKey(key);
  await prisma.rolePermission.upsert({
    where: { role_permKey: { role, permKey: key } },
    update: { allowed }, create: { role, permKey: key, allowed },
  });
  await logAudit({ action: "UPDATE", tableName: "role_permissions", recordId: String(role), newValue: { [key]: allowed } });
  revalidatePath("/permissions");
}
export async function setUserPerm(userId: string, key: string, allowed: boolean) {
  await reqAdmin();
  assertKey(key);
  await prisma.userPermission.upsert({
    where: { userId_permKey: { userId, permKey: key } },
    update: { allowed }, create: { userId, permKey: key, allowed },
  });
  await logAudit({ action: "UPDATE", tableName: "user_permissions", recordId: userId, newValue: { [key]: allowed } });
  revalidatePath("/permissions");
}
export async function copyUserPerms(targetUserId: string, fd: FormData) {
  await reqAdmin();
  if (fd.get("confirm")?.toString() !== "نسخ الصلاحيات") throw new Error("يتطلب النسخ تأكيداً صريحاً");
  const sourceUserId = fd.get("sourceUserId")?.toString();
  if (!sourceUserId || sourceUserId === targetUserId) throw new Error("اختر مستخدماً آخر للمصدر");
  const source = await prisma.user.findUniqueOrThrow({ where: { id: sourceUserId }, select: { role: true } });
  const sourceOverrides = await prisma.userPermission.findMany({ where: { userId: sourceUserId } });
  const base = roleDefaultSet(source.role); const ov = new Map(sourceOverrides.map((x) => [x.permKey, x.allowed]));
  const decisions = ALL_PERMS.map((permKey) => ({ userId: targetUserId, permKey, allowed: ov.has(permKey) ? Boolean(ov.get(permKey)) : base.has(permKey) }));
  await prisma.$transaction(async (tx) => { await tx.userPermission.deleteMany({ where: { userId: targetUserId } }); await tx.userPermission.createMany({ data: decisions }); });
  await logAudit({ action: "UPDATE", tableName: "user_permissions", recordId: targetUserId, newValue: { copiedFromUserId: sourceUserId } });
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
