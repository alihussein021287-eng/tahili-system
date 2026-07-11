import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cache } from "react";
import { roleDefaultSet, ALL_PERMS } from "@/lib/perms";

// جلسة المستخدم الحالي — مكاشة لكل request (تمنع فك الجلسة أكثر من مرة بنفس الصفحة)
export const getSession = cache(async () => getServerSession(authOptions));

// يحسب الصلاحيات الفعلية: افتراضي الدور ← تعديل الدور (DB) ← استثناء المستخدم (DB)
export async function loadPerms(userId?: string, role?: UserRole): Promise<Set<string>> {
  if (!role) return new Set();
  if (role === "ADMIN") return new Set(ALL_PERMS);
  const set = roleDefaultSet(role);
  try {
    // الاستعلامان متوازيان بدل متسلسلين
    const [rp, up] = await Promise.all([
      prisma.rolePermission.findMany({ where: { role } }),
      userId ? prisma.userPermission.findMany({ where: { userId } }) : Promise.resolve([]),
    ]);
    for (const r of rp) { if (r.allowed) set.add(r.permKey); else set.delete(r.permKey); }
    for (const u of up) { if (u.allowed) set.add(u.permKey); else set.delete(u.permKey); }
  } catch {}
  return set;
}

// صلاحيات المستخدم الحالي — مكاشة لكل request (تمنع تكرار استعلامات الصلاحيات بنفس الصفحة)
export const currentPerms = cache(async (): Promise<Set<string>> => {
  const session = await getSession();
  return loadPerms((session?.user as any)?.id, (session?.user as any)?.role);
});

// حارس صفحة: يمنع ويحوّل للرئيسية إن لم تتوفّر الصلاحية
export async function requirePerm(key: string) {
  const perms = await currentPerms();
  if (!perms.has(key)) redirect("/");
  return perms;
}

// حارس على مستوى الإجراء (يرفض حتى لو تجاوز الواجهة)
export async function assertPerm(key: string) {
  const perms = await currentPerms();
  if (!perms.has(key)) throw new Error("غير مصرّح بهذا الإجراء");
}

// الحذف حصري للأدمن بكل النظام — يُستدعى بأول كل دالة حذف
export async function assertAdminDelete() {
  const s = await getSession();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("الحذف صلاحية حصرية لمدير النظام");
  return s;
}
