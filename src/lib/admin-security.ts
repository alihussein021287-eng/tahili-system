type AdminState = {
  role: string;
  isActive: boolean;
};

export function removesActiveAdmin(current: AdminState, next: AdminState) {
  return current.role === "ADMIN" && current.isActive && (next.role !== "ADMIN" || !next.isActive);
}

export function canApplyAdminChange(activeAdminCount: number, current: AdminState, next: AdminState) {
  return !removesActiveAdmin(current, next) || activeAdminCount >= 2;
}

export function assertCanApplyAdminChange(activeAdminCount: number, current: AdminState, next: AdminState) {
  if (!canApplyAdminChange(activeAdminCount, current, next)) {
    throw new Error("لا يمكن تعطيل أو خفض رتبة آخر مدير فعّال");
  }
}

