"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/permissions";
import { roleDefaultSet, ALL_PERMS } from "@/lib/perms";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { passwordError } from "@/lib/security";
import { userCreateSchema, userUpdateSchema, parseOrThrow } from "@/lib/validate";
import { assertCanApplyAdminChange } from "@/lib/admin-security";
import { incrementAuthVersion, incrementAuthVersionIf } from "@/lib/auth-version";

async function requireAdmin() {
  const s = await requireSession();
  if (!canManageUsers((s?.user as any)?.role)) throw new Error("غير مصرّح");
}

export async function createUser(fd: FormData) {
  await requireAdmin();
  const rawPw = fd.get("password")?.toString() || "";
  if (rawPw) { const e = passwordError(rawPw); if (e) throw new Error(e); }
  const v = parseOrThrow(userCreateSchema, {
    username: fd.get("username")?.toString() ?? "",
    fullName: fd.get("fullName")?.toString() ?? "",
    role: fd.get("role")?.toString() || undefined,
    email: fd.get("email")?.toString() || "",
  });
  const needsActivation = !rawPw;
  const passwordHash = await bcrypt.hash(rawPw || Math.random().toString(36).slice(2) + "Aa1", 10);
  const created = await prisma.user.create({
    data: {
      username: v.username,
      fullName: v.fullName,
      role: (v.role as any) || "VIEWER",
      branchId: fd.get("branchId")?.toString() ? Number(fd.get("branchId")) : null,
      email: v.email || null,
      phone: fd.get("phone")?.toString() || null,
      jobTitle: fd.get("jobTitle")?.toString() || null,
      department: fd.get("department")?.toString() || null,
      passwordHash,
      needsActivation,
    },
  });
  await logAudit({ action: "CREATE", tableName: "users", recordId: created.id });
  revalidatePath("/users");
}

export async function toggleUser(id: string, isActive: boolean) {
  await requireAdmin();
  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUniqueOrThrow({ where: { id }, select: { role: true, isActive: true } });
    const activeAdminCount = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
    assertCanApplyAdminChange(activeAdminCount, target, { ...target, isActive });
    await tx.user.update({
      where: { id },
      data: {
        isActive,
        ...incrementAuthVersionIf(target.isActive !== isActive),
      },
    });
  }, { isolationLevel: "Serializable" });
  await logAudit({ action: "UPDATE", tableName: "users", recordId: id, newValue: { isActive } });
  revalidatePath("/users");
  revalidatePath(`/users/${id}`);
}

export async function resetPassword(id: string, fd: FormData) {
  await requireAdmin();
  const pw = fd.get("password")?.toString() || "";
  const pwErr = passwordError(pw);
  if (pwErr) throw new Error(pwErr);
  const passwordHash = await bcrypt.hash(pw, 10);
  await prisma.user.update({
    where: { id },
    data: { passwordHash, ...incrementAuthVersion() },
  });
  await logAudit({ action: "UPDATE", tableName: "users", recordId: id, newValue: { passwordReset: true } });
  revalidatePath(`/users/${id}`);
}

// تعديل بيانات الحساب (الاسم/الدور/التواصل/الملاحظات)
export async function updateUser(id: string, fd: FormData) {
  await requireAdmin();
  const g = (k: string) => (fd.get(k)?.toString() ?? "").trim();
  const v = parseOrThrow(userUpdateSchema, {
    fullName: g("fullName"),
    role: g("role") || undefined,
    email: g("email") || "",
  });
  const data = {
      ...(fd.has("branchId") ? { branchId: fd.get("branchId")?.toString() ? Number(fd.get("branchId")) : null } : {}),
      fullName: v.fullName,
      role: (v.role as any) || undefined,
      email: v.email || null,
      phone: g("phone") || null,
      jobTitle: g("jobTitle") || null,
      department: g("department") || null,
      note: g("note") || null,
  };
  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUniqueOrThrow({ where: { id }, select: { role: true, isActive: true } });
    const activeAdminCount = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
    assertCanApplyAdminChange(activeAdminCount, target, { ...target, role: data.role ?? target.role });
    const nextRole = data.role ?? target.role;
    await tx.user.update({
      where: { id },
      data: {
        ...data,
        ...incrementAuthVersionIf(nextRole !== target.role),
      },
    });
  }, { isolationLevel: "Serializable" });
  await logAudit({ action: "UPDATE", tableName: "users", recordId: id, newValue: { role: data.role } });
  revalidatePath(`/users/${id}`);
  revalidatePath("/users");
}

// صلاحية مفردة لمستخدم — قرار صريح allow/deny
export async function setUserPerm(userId: string, key: string, allowed: boolean) {
  await requireAdmin();
  await prisma.userPermission.upsert({
    where: { userId_permKey: { userId, permKey: key } },
    update: { allowed },
    create: { userId, permKey: key, allowed },
  });
  await logAudit({ action: "UPDATE", tableName: "user_permissions", recordId: userId, newValue: { [key]: allowed } });
  revalidatePath(`/users/${userId}`);
}

// تحديد/إلغاء مجموعة مفاتيح دفعة واحدة (لزر "تحديد الكل" لكل قسم)
export async function setUserPermsBulk(userId: string, keys: string[], allowed: boolean) {
  await requireAdmin();
  await prisma.$transaction(
    keys.map((key) =>
      prisma.userPermission.upsert({
        where: { userId_permKey: { userId, permKey: key } },
        update: { allowed },
        create: { userId, permKey: key, allowed },
      })
    )
  );
  await logAudit({ action: "UPDATE", tableName: "user_permissions", recordId: userId, newValue: { keys, allowed } });
  revalidatePath(`/users/${userId}`);
}

// تصفير: حذف كل الاستثناءات → يرجع لافتراضي الدور الحيّ
export async function clearUserPerms(userId: string) {
  await requireAdmin();
  await prisma.userPermission.deleteMany({ where: { userId } });
  await logAudit({ action: "DELETE", tableName: "user_permissions", recordId: userId });
  revalidatePath(`/users/${userId}`);
}

// تعبئة سريعة من قالب دور — يكتب قراراً صريحاً لكل مفتاح (يجعل صلاحيات المستخدم مستقلة)
export async function applyRoleTemplate(userId: string, role: string, alsoSetRole = false) {
  await requireAdmin();
  const tmpl = roleDefaultSet(role as any);
  await prisma.$transaction(async (tx) => {
    if (alsoSetRole) {
      const target = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, isActive: true } });
      const activeAdminCount = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
      assertCanApplyAdminChange(activeAdminCount, target, { ...target, role });
      await tx.user.update({
        where: { id: userId },
        data: {
          role: role as any,
          ...incrementAuthVersionIf(target.role !== role),
        },
      });
    }
    for (const key of ALL_PERMS) {
      await tx.userPermission.upsert({
        where: { userId_permKey: { userId, permKey: key } },
        update: { allowed: tmpl.has(key) },
        create: { userId, permKey: key, allowed: tmpl.has(key) },
      });
    }
  }, { isolationLevel: "Serializable" });
  await logAudit({ action: "UPDATE", tableName: "user_permissions", recordId: userId, newValue: { template: role, roleChanged: alsoSetRole } });
  revalidatePath(`/users/${userId}`);
  revalidatePath("/users");
}

// نشاط المستخدم (آخر العمليات من سجل التدقيق)
export async function getUserActivity(userId: string) {
  await requireAdmin();
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, action: true, tableName: true, recordId: true, createdAt: true, ipAddress: true },
  });
}
