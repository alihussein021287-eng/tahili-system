// One tab list for "الموظفون والمهام": the main entry point for personnel management. Each entry reuses an existing route and its own server permission,
// so seeing a tab never grants anything beyond what that page already enforces.
export type StaffNavKey = "overview" | "records" | "accounts" | "attendance" | "shifts" | "leaves" | "tasks" | "reports";
export type StaffNavTab = { key: StaffNavKey; label: string; href: string };

const has = (perms: ReadonlySet<string>, keys: string[]) => keys.some((k) => perms.has(k));

export function staffNavTabs(perms: ReadonlySet<string>, role: string | undefined): StaffNavTab[] {
  const tabs: (StaffNavTab & { show: boolean })[] = [
    { key: "overview", label: "نظرة عامة", href: "/staff?tab=overview", show: has(perms, ["users.view", "attendance.view", "shifts.view", "tasks.view", "employees.view"]) },
    { key: "records", label: "سجلات الموظفين", href: "/staff/employees", show: perms.has("employees.view") },
    // Account administration lives on /users (ADMIN only); other holders of users.view keep the read-only list inside Staff.
    { key: "accounts", label: "الحسابات والأدوار", href: role === "ADMIN" ? "/users" : "/staff?tab=employees", show: perms.has("users.view") },
    { key: "attendance", label: "الحضور", href: "/staff?tab=attendance", show: perms.has("attendance.view") },
    { key: "shifts", label: "الدوام والشفتات", href: "/staff?tab=shifts", show: perms.has("shifts.view") },
    { key: "leaves", label: "الإجازات", href: "/staff?tab=leaves", show: perms.has("shifts.view") },
    { key: "tasks", label: "المهام", href: "/staff?tab=tasks", show: perms.has("tasks.view") },
    { key: "reports", label: "تقارير مختصرة", href: "/staff?tab=reports", show: has(perms, ["users.view", "attendance.view", "shifts.view", "tasks.view"]) },
  ];
  return tabs.filter((t) => t.show).map(({ show: _show, ...t }) => t);
}

/** Maps the legacy `/staff?tab=` key to the unified tab key. */
export function staffNavActive(legacyTab: string): StaffNavKey {
  return legacyTab === "employees" ? "accounts" : (legacyTab as StaffNavKey);
}
