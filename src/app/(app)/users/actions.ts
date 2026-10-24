"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/permissions";
import { roleDefaultSet, ALL_PERMS } from "@/lib/perms";
import { templateGrants } from "@/lib/role-templates";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { passwordError } from "@/lib/security";
import { getAdminConfig } from "@/lib/admin-config";
import { userCreateSchema, userUpdateSchema, parseOrThrow } from "@/lib/validate";
import { assertCanApplyAdminChange } from "@/lib/admin-security";
import { incrementAuthVersion, incrementAuthVersionIf } from "@/lib/auth-version";
import { initialCredentialError } from "@/lib/account-activation";
import { userDeletionBlockers } from "@/lib/user-deletion";
import { CenterMembershipRole, CenterMembershipStatus } from "@prisma/client";
import { allowsMultipleActiveCenters, centerRoleForUserRole } from "@/lib/center-membership";
import { redirect } from "next/navigation";

async function requireAdmin() {
  const s = await requireSession();
  if (!canManageUsers((s?.user as any)?.role)) throw new Error("غير مصرّح");
}

export async function deleteUnusedUser(id: string, fd: FormData) {
  const session = await requireSession();
  if (!canManageUsers((session?.user as any)?.role)) throw new Error("غير مصرّح");
  if ((session?.user as any)?.id === id) throw new Error("لا يمكن حذف حسابك الحالي");
  if (fd.get("confirm")?.toString().trim() !== "حذف الحساب") throw new Error("اكتب «حذف الحساب» للتأكيد");
  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUniqueOrThrow({ where: { id }, select: { role: true, isActive: true } });
    const activeAdminCount = await tx.user.count({ where: { role: "ADMIN", isActive: true } });
    assertCanApplyAdminChange(activeAdminCount, target, { ...target, isActive: false });
    const blockers = await userDeletionBlockers(tx as any, id);
    if (blockers.length) {
      const total = blockers.reduce((sum, item) => sum + item.count, 0);
      throw new Error(`لا يمكن حذف الحساب لارتباطه بـ ${total} سجل. عطّل الحساب للحفاظ على تاريخ الأعمال.`);
    }
    await tx.user.delete({ where: { id } });
  }, { isolationLevel: "Serializable" });
  await logAudit({ action: "DELETE", tableName: "users", recordId: id, newValue: { safelyDeleted: true } });
  revalidatePath("/users");
}

export async function createUser(fd: FormData) {
  await requireAdmin();
  const rawPw = fd.get("password")?.toString() || "";
  const policy = await getAdminConfig();
  const pwError = initialCredentialError(rawPw, policy);
  if (pwError) throw new Error(pwError);
  const v = parseOrThrow(userCreateSchema, {
    username: fd.get("username")?.toString() ?? "",
    fullName: fd.get("fullName")?.toString() ?? "",
    role: fd.get("role")?.toString() || undefined,
    email: fd.get("email")?.toString() || "",
  });
  const activateImmediately = fd.get("activateImmediately")?.toString() === "1";
  if (v.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount > 0 && fd.get("confirmAdditionalAdmin")?.toString().trim() !== "إنشاء مدير إضافي") {
      throw new Error("يوجد مدير نظام بالفعل. اكتب «إنشاء مدير إضافي» كقرار صريح من المدير الحالي.");
    }
  }
  const passwordHash = await bcrypt.hash(rawPw, 10);
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
      needsActivation: !activateImmediately,
    },
  });
  await logAudit({ action: "CREATE", tableName: "users", recordId: created.id });
  revalidatePath("/users");
  redirect(`/users/${created.id}?tab=membership&new=1`);
}

function membershipFields(fd: FormData, expectedRole: CenterMembershipRole | null) {
  const centerId = Number(fd.get("centerId"));
  const role = fd.get("role")?.toString() as CenterMembershipRole;
  const specialty = fd.get("specialty")?.toString().trim() || null;
  if (!Number.isInteger(centerId) || centerId < 1 || !expectedRole || role !== expectedRole) {
    throw new Error("اختر مركزاً وصفة صحيحتين");
  }
  return { centerId, role, specialty };
}

function effectiveMembershipWhere(now: Date) {
  return {
    status: CenterMembershipStatus.ACTIVE,
    startDate: { lte: now },
    OR: [{ endDate: null }, { endDate: { gte: now } }],
  };
}

function refreshMembershipViews(userId: string) {
  revalidatePath(`/users/${userId}`);
  revalidatePath("/users");
  revalidatePath("/staff");
  revalidatePath("/settings");
  revalidatePath("/centers");
  revalidatePath("/therapy-centers");
}

// This is the only write path for staff centre placement. For one-centre roles,
// a placement in a new centre closes the prior effective placement first.
export async function placeUserInCenter(userId: string, fd: FormData) {
  await requireAdmin();
  const account = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { role: true } });
  const { centerId, role, specialty } = membershipFields(fd, account ? centerRoleForUserRole(account.role) : null);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Match device replacement: account before membership rows (including implicit FK locks on inserts).
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const [user, center] = await Promise.all([
      tx.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } }),
      tx.center.findFirst({ where: { id: centerId, active: true }, select: { id: true, name: true } }),
    ]);
    if (!user) throw new Error("المستخدم غير متاح");
    if (!center) throw new Error("المركز غير متاح");
    if (!allowsMultipleActiveCenters(role)) {
      await tx.centerMembership.updateMany({
        where: { userId, role, centerId: { not: centerId }, ...effectiveMembershipWhere(now) },
        data: { status: CenterMembershipStatus.INACTIVE, endDate: now },
      });
    }
    const row = await tx.centerMembership.upsert({
      where: { centerId_userId_role: { centerId, userId, role } },
      update: { specialty, status: CenterMembershipStatus.ACTIVE, startDate: now, endDate: null },
      create: { centerId, userId, role, specialty, status: CenterMembershipStatus.ACTIVE, startDate: now },
    });
    await tx.auditLog.create({ data: { action: "UPDATE", tableName: "center_memberships", recordId: row.id, newValue: { userId, centerId, role, placement: "active" } } });
  }, { isolationLevel: "Serializable" });
  refreshMembershipViews(userId);
}

export async function updateUserCenterMembership(userId: string, membershipId: string, fd: FormData) {
  await requireAdmin();
  const account = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { role: true } });
  const { centerId, role, specialty } = membershipFields(fd, account ? centerRoleForUserRole(account.role) : null);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Never hold the old membership while waiting for its account during the new membership insert.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const membership = await tx.centerMembership.findFirst({ where: { id: membershipId, userId } });
    if (!membership) throw new Error("عضوية المركز غير موجودة");
    if (membership.centerId === centerId && membership.role === role) {
      await tx.centerMembership.update({ where: { id: membershipId }, data: { specialty } });
      return;
    }
    if (!allowsMultipleActiveCenters(role)) {
      await tx.centerMembership.updateMany({
        where: { userId, role, centerId: { not: centerId }, ...effectiveMembershipWhere(now) },
        data: { status: CenterMembershipStatus.INACTIVE, endDate: now },
      });
    }
    await tx.centerMembership.update({ where: { id: membershipId }, data: { status: CenterMembershipStatus.INACTIVE, endDate: now } });
    const row = await tx.centerMembership.upsert({
      where: { centerId_userId_role: { centerId, userId, role } },
      update: { specialty, status: CenterMembershipStatus.ACTIVE, startDate: now, endDate: null },
      create: { centerId, userId, role, specialty, status: CenterMembershipStatus.ACTIVE, startDate: now },
    });
    await tx.auditLog.create({ data: { action: "UPDATE", tableName: "center_memberships", recordId: row.id, newValue: { userId, centerId, role, placement: "updated" } } });
  }, { isolationLevel: "Serializable" });
  refreshMembershipViews(userId);
}

export async function endUserCenterMembership(userId: string, membershipId: string) {
  await requireAdmin();
  const now = new Date();
  const membership = await prisma.centerMembership.findFirst({ where: { id: membershipId, userId } });
  if (!membership) throw new Error("عضوية المركز غير موجودة");
  await prisma.centerMembership.update({ where: { id: membershipId }, data: { status: CenterMembershipStatus.INACTIVE, endDate: now } });
  await logAudit({ action: "UPDATE", tableName: "center_memberships", recordId: membershipId, newValue: { userId, centerId: membership.centerId, placement: "ended" } });
  refreshMembershipViews(userId);
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
  const policy = await getAdminConfig();
  const pwErr = passwordError(pw, policy);
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
  const existing = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
  const tmpl = templateGrants(existing.role, role, alsoSetRole); // throws for privileged templates on other roles
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
