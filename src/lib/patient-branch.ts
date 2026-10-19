/**
 * Registration branch invariant for patients (server-side, pure so it can be unit tested).
 * - A new patient always gets a valid ACTIVE branch; NULL is never created by normal registration.
 * - A branch-bound staff member registers only into their own active branch (a different explicit value is rejected).
 * - Central actors (ADMIN, or MANAGER holding the existing central view permission) may choose any active branch;
 *   with no explicit choice the branch is used only when it is unambiguous (their own active branch).
 * - The branch is never inferred from a queue, hall or visit.
 * Existing patients are never re-assigned silently: an update keeps the stored branch unless a central actor changes it.
 */
export type BranchActor = { canViewAllBranches: boolean; userBranchId: number | null; userBranchActive: boolean };
export type BranchRef = { id: number; isActive: boolean } | null;
export type BranchResult = { ok: boolean; branchId?: number | null; error?: string };

const fail = (error: string): BranchResult => ({ ok: false, error });

export function resolveRegistrationBranch(actor: BranchActor, requestedBranchId: number | null, requested: BranchRef): BranchResult {
  const own = actor.userBranchId != null && actor.userBranchActive ? actor.userBranchId : null;
  if (!actor.canViewAllBranches) {
    if (own == null) return fail("حسابك غير مرتبط بفرع فعّال؛ اطلب من المدير ربط حسابك بفرع قبل تسجيل المراجعين");
    if (requestedBranchId != null && requestedBranchId !== own) return fail("لا يمكنك تسجيل مراجع في فرع غير فرعك");
    return { ok: true, branchId: own };
  }
  const id = requestedBranchId ?? own;
  if (id == null) return fail("اختر الفرع: لا يمكن حفظ مراجع جديد بلا فرع");
  if (id === own && requestedBranchId == null) return { ok: true, branchId: id };
  if (!requested || requested.id !== id || !requested.isActive) return fail("الفرع غير موجود أو غير فعّال");
  return { ok: true, branchId: id };
}

export function resolveUpdateBranch(actor: BranchActor, stored: number | null, requestedBranchId: number | null, requested: BranchRef): BranchResult {
  if (requestedBranchId == null || requestedBranchId === stored) return { ok: true, branchId: stored };
  if (!actor.canViewAllBranches) return fail("لا يمكنك تغيير فرع المراجع");
  if (!requested || requested.id !== requestedBranchId || !requested.isActive) return fail("الفرع غير موجود أو غير فعّال");
  return { ok: true, branchId: requestedBranchId };
}
