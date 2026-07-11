import type { UserRole } from "@prisma/client";
import { loadPerms, PermissionStoreUnavailableError } from "@/lib/access";

type PermissionLoader = (userId?: string, role?: UserRole) => Promise<Set<string>>;

export type ApiPermissionDecision =
  | { allowed: true; permissions: Set<string> }
  | { allowed: false; status: 403 | 503; message: string };

export async function checkApiPermission(
  userId: string | undefined,
  role: UserRole | undefined,
  required: string | readonly string[],
  loader: PermissionLoader = loadPerms,
): Promise<ApiPermissionDecision> {
  try {
    const permissions = await loader(userId, role);
    const keys = typeof required === "string" ? [required] : required;
    return keys.some((key) => permissions.has(key))
      ? { allowed: true, permissions }
      : { allowed: false, status: 403, message: "لا تملك الصلاحية المطلوبة" };
  } catch (error) {
    if (error instanceof PermissionStoreUnavailableError) {
      return { allowed: false, status: 503, message: "خدمة التحقق من الصلاحيات غير متاحة مؤقتاً" };
    }
    throw error;
  }
}

export function apiPermissionResponse(decision: Extract<ApiPermissionDecision, { allowed: false }>) {
  return new Response(decision.message, {
    status: decision.status,
    headers: { "Cache-Control": "no-store" },
  });
}
