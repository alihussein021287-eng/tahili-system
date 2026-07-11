import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  loadPermissionsFromStore,
  assertPermissionLoaded,
  PermissionStoreUnavailableError,
} from "@/lib/permission-store";
import { SessionStoreUnavailableError, validateCurrentSession } from "@/lib/session-validation";

export { PermissionStoreUnavailableError } from "@/lib/permission-store";
export { SessionStoreUnavailableError } from "@/lib/session-validation";

// جلسة موثقة من DB ومكاشة داخل الطلب الواحد فقط.
// لا نثق بدور JWT، ونرفض التوكنات القديمة التي لا تحتوي authVersion.
export const getSession = cache(async () => {
  const session = await getServerSession(authOptions);
  return validateCurrentSession(session, (id) => prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      role: true,
      isActive: true,
      needsActivation: true,
      authVersion: true,
    },
  }));
});

export async function getApiSession(loadSession: typeof getSession = getSession) {
  try {
    const session = await loadSession();
    return session
      ? { session, response: null }
      : { session: null, response: new Response("غير مصرح", { status: 401, headers: { "Cache-Control": "no-store" } }) };
  } catch (error) {
    if (error instanceof SessionStoreUnavailableError) {
      return {
        session: null,
        response: new Response("خدمة التحقق من الجلسة غير متاحة مؤقتاً", {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        }),
      };
    }
    throw error;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

const loggedPermissionErrors = new WeakSet<PermissionStoreUnavailableError>();
const PERMISSION_ERROR_LOG_THROTTLE_MS = 5_000;
let lastPermissionErrorLoggedAt = 0;

function logPermissionStoreFailure(error: PermissionStoreUnavailableError) {
  if (loggedPermissionErrors.has(error)) return;
  loggedPermissionErrors.add(error);
  const now = Date.now();
  if (now - lastPermissionErrorLoggedAt < PERMISSION_ERROR_LOG_THROTTLE_MS) return;
  lastPermissionErrorLoggedAt = now;
  console.error("[permissions] permission store unavailable", { code: error.code });
}

// يحسب الصلاحيات الفعلية: افتراضي الدور ← تعديل الدور (DB) ← استثناء المستخدم (DB)
export async function loadPerms(userId?: string, role?: UserRole): Promise<Set<string>> {
  try {
    return await loadPermissionsFromStore(userId, role, {
      findRolePermissions: (currentRole) => prisma.rolePermission.findMany({ where: { role: currentRole } }),
      findUserPermissions: (currentUserId) => prisma.userPermission.findMany({ where: { userId: currentUserId } }),
    });
  } catch (error) {
    if (error instanceof PermissionStoreUnavailableError) logPermissionStoreFailure(error);
    throw error;
  }
}

// صلاحيات المستخدم الحالي — مكاشة لكل request (تمنع تكرار استعلامات الصلاحيات بنفس الصفحة)
export const currentPerms = cache(async (): Promise<Set<string>> => {
  const session = await getSession();
  return loadPerms((session?.user as any)?.id, (session?.user as any)?.role);
});

// حارس صفحة: يمنع ويحوّل للرئيسية إن لم تتوفّر الصلاحية
export async function requirePerm(key: string) {
  const session = await getSession();
  if (!session) redirect("/login");
  const perms = await currentPerms();
  if (!perms.has(key)) redirect("/");
  return perms;
}

// حارس على مستوى الإجراء (يرفض حتى لو تجاوز الواجهة)
export async function assertPerm(key: string) {
  await requireSession();
  await assertPermissionLoaded(key, currentPerms);
}

// الحذف حصري للأدمن بكل النظام — يُستدعى بأول كل دالة حذف
export async function assertAdminDelete() {
  const s = await requireSession();
  const userId = (s?.user as any)?.id as string | undefined;
  if (!userId) throw new Error("الحذف صلاحية حصرية لمدير النظام");

  // Do not trust the role embedded in the JWT for destructive operations.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });
  if (!user?.isActive || user.role !== "ADMIN") {
    throw new Error("الحذف صلاحية حصرية لمدير النظام");
  }

  // ADMIN-only mutations still require a successful permission-store read.
  await loadPerms(userId, user.role);
  return s;
}
