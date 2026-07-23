import type { UserRole } from "@prisma/client";

export type NavigationItem = {
  href: string;
  label: string;
  icon: string;
  navLabel?: string;
  perm?: string;
  perms?: string[];
};

export type NavigationGroup = {
  key: string;
  title: string;
  icon: string;
  href: string;
  hrefs: string[];
};

export type RegistrySurface = "sidebar" | "workspace" | "my-work";

export type WorkRegistryEntry = {
  key: string;
  route: string;
  hub: string | null;
  tab: string | null;
  label: string;
  requiredPermissions: string[];
  suggestedRoles: UserRole[];
  section: string;
  surfaces: RegistrySurface[];
  deepLink: string;
  sensitive: boolean;
};

export const ALL_ITEMS: NavigationItem[] = [
  { href: "/", label: "الرئيسية", icon: "▤", perm: "dashboard.view" },
  { href: "/workspaces", label: "مساحاتي", icon: "◇", perm: "dashboard.view" },
  { href: "/my-work", label: "قائمة عملي", icon: "☑", perm: "dashboard.view" },
  { href: "/notifications", label: "مركز التنبيهات", icon: "🔔", perm: "dashboard.view" },
  { href: "/collaboration", label: "مركز التعاون", icon: "💬", perm: "collaboration.view" },
  { href: "/patients-care?tab=overview", label: "المرضى والرعاية", navLabel: "نظرة عامة", icon: "🧑‍⚕️", perms: ["patients.view", "patients.create", "visits.view", "queue.view", "journey.view", "referrals.view", "appointments.view"] },
  { href: "/patients-care?tab=patients", label: "المراجعون", icon: "☺", perm: "patients.view" },
  { href: "/patients-care?tab=queue", label: "الطابور", icon: "⏳", perm: "queue.view" },
  { href: "/patients-care?tab=visits", label: "الزيارات", icon: "📋", perm: "visits.view" },
  { href: "/patients-care?tab=appointments", label: "المواعيد", icon: "▦", perm: "appointments.view" },
  { href: "/patients-care?tab=referrals", label: "الفحوص والإحالات", icon: "↗", perm: "referrals.view" },
  { href: "/patients-care?tab=journey", label: "مسار الرعاية", icon: "🗺", perm: "journey.view" },
  { href: "/therapy-centers?tab=overview", label: "المسار العلاجي والمراكز", navLabel: "نظرة عامة", icon: "🏥", perms: ["therapy.view", "therapy.session.record", "centers.view", "beds.view", "meds.view", "centers.sessions.record"] },
  { href: "/therapy-centers?tab=plans", label: "الخطط العلاجية", icon: "▤", perms: ["therapy.view", "clinical.plan", "therapy.plan.manage"] },
  { href: "/therapy-centers?tab=sessions", label: "الجلسات العلاجية", icon: "▦", perms: ["therapy.view", "clinical.session", "therapy.session.record"] },
  { href: "/therapy-centers?tab=today", label: "جلساتي اليوم", icon: "🗓", perm: "therapy.session.record" },
  { href: "/therapy-centers?tab=centers", label: "المراكز والبرامج", icon: "🏥", perm: "centers.view" },
  { href: "/therapy-centers?tab=beds", label: "الرقود والفندقة", icon: "🛏", perm: "beds.view" },
  { href: "/therapy-centers?tab=meds", label: "أدوية الراقدين", icon: "💊", perm: "meds.view" },
  { href: "/workload", label: "المعالجون", icon: "👷", perm: "workload.view" },
  { href: "/devices", label: "الأجهزة", icon: "🔧", perm: "devices.view" },
  { href: "/reports-finance?tab=overview", label: "التقارير والمالية", navLabel: "نظرة عامة", icon: "📊", perms: ["reports.view", "reports.official", "finance.view", "finance.report", "expenses.view", "expenses.reports", "approvals.view", "officialdocs.view", "analytics.view", "patients.export"] },
  { href: "/reports-finance?tab=official", label: "التقارير الرسمية", icon: "▤", perms: ["reports.view", "reports.official", "officialdocs.view"] },
  { href: "/reports-finance?tab=patients", label: "التقارير الطبية", icon: "📋", perms: ["reports.view", "patients.print", "clinical.report"] },
  { href: "/reports-finance?tab=finance", label: "المالية", icon: "₪", perms: ["finance.view", "finance.report"] },
  { href: "/reports-finance?tab=wounded", label: "صرفيات الجرحى", icon: "💳", perms: ["expenses.view", "expenses.reports", "expenses.approve", "expenses.pay"] },
  { href: "/reports-finance?tab=approvals", label: "الموافقات", icon: "✅", perms: ["approvals.view", "expenses.approve", "expenses.pay", "reports.approve"] },
  { href: "/reports-finance?tab=exports", label: "الصادرات", icon: "↧", perms: ["patients.export", "expenses.reports", "officialdocs.view", "audit.view"] },
  { href: "/analytics", label: "التحليلات", icon: "📈", perm: "analytics.view" },
  { href: "/pharmacy-inventory?tab=overview", label: "الصيدلية والمخزون", navLabel: "نظرة عامة", icon: "💊", perms: ["pharmacy.view", "pharmacy.dispense", "pharmacy.batch", "inventory.view", "inventory.manage", "pharmacy.purchase.view", "pharmacy.purchase.create", "pharmacy.purchase.receive"] },
  { href: "/pharmacy-inventory?tab=dispense", label: "صرف الوصفات", icon: "⚕️", perm: "pharmacy.view" },
  { href: "/pharmacy-inventory?tab=stock", label: "الأدوية والمخزون", icon: "▣", perm: "inventory.view" },
  { href: "/pharmacy-inventory?tab=batches", label: "الدفعات والصلاحية", icon: "📦", perms: ["pharmacy.view", "inventory.view"] },
  { href: "/pharmacy-inventory?tab=purchases", label: "أوامر الشراء", icon: "🧾", perm: "pharmacy.purchase.view" },
  { href: "/pharmacy-inventory?tab=receipts", label: "الاستلام", icon: "✓", perm: "pharmacy.purchase.view" },
  { href: "/pharmacy-inventory?tab=reports", label: "تقارير الصيدلية", icon: "📊", perms: ["pharmacy.view", "inventory.view", "pharmacy.purchase.view"] },
  { href: "/staff?tab=overview", label: "الموظفون والمهام", navLabel: "نظرة عامة", icon: "🗂", perms: ["users.view", "attendance.view", "shifts.view", "tasks.view"] },
  { href: "/staff?tab=employees", label: "الموظفون", icon: "⚙", perm: "users.view" },
  { href: "/staff?tab=tasks", label: "المهام", icon: "📌", perm: "tasks.view" },
  { href: "/staff?tab=attendance", label: "الحضور", icon: "🕒", perm: "attendance.view" },
  { href: "/staff?tab=shifts", label: "الدوام والشفتات", icon: "🗓", perm: "shifts.view" },
  { href: "/staff?tab=leaves", label: "الإجازات", icon: "☑", perm: "shifts.view" },
  { href: "/staff?tab=reports", label: "تقارير مختصرة", icon: "▦", perms: ["users.view", "attendance.view", "shifts.view", "tasks.view"] },
  { href: "/settings", label: "الإعدادات", icon: "▥", perm: "settings.view" },
  { href: "/users", label: "المستخدمون", icon: "⚙", perm: "users.view" },
  { href: "/permissions", label: "الصلاحيات", icon: "🔐", perm: "users.permissions" },
  { href: "/audit", label: "سجل التدقيق", icon: "▣", perm: "audit.view" },
  { href: "/login-log", label: "سجل الدخول", icon: "🔐", perm: "settings.view" },
  { href: "/backup", label: "النسخ الاحتياطي", icon: "💾", perm: "settings.backup" },
  { href: "/readiness", label: "جاهزية النظام", icon: "✅", perm: "settings.view" },
];

export const STANDALONE = ["/", "/workspaces", "/my-work", "/notifications", "/collaboration"];

export const NAV_GROUPS: NavigationGroup[] = [
  { key: "care", title: "المرضى والرعاية", icon: "🧑‍⚕️", href: "/patients-care?tab=overview", hrefs: ["/patients-care?tab=overview", "/patients-care?tab=patients", "/patients-care?tab=queue", "/patients-care?tab=visits", "/patients-care?tab=appointments", "/patients-care?tab=referrals", "/patients-care?tab=journey"] },
  { key: "therapy", title: "المسار العلاجي والمراكز", icon: "🏥", href: "/therapy-centers?tab=overview", hrefs: ["/therapy-centers?tab=overview", "/therapy-centers?tab=plans", "/therapy-centers?tab=sessions", "/therapy-centers?tab=today", "/therapy-centers?tab=centers", "/therapy-centers?tab=beds", "/therapy-centers?tab=meds"] },
  { key: "pharm", title: "الصيدلية والمخزون", icon: "💊", href: "/pharmacy-inventory?tab=overview", hrefs: ["/pharmacy-inventory?tab=overview", "/pharmacy-inventory?tab=dispense", "/pharmacy-inventory?tab=stock", "/pharmacy-inventory?tab=batches", "/pharmacy-inventory?tab=purchases", "/pharmacy-inventory?tab=receipts", "/pharmacy-inventory?tab=reports"] },
  { key: "reports", title: "التقارير والمالية", icon: "📊", href: "/reports-finance?tab=overview", hrefs: ["/reports-finance?tab=overview", "/reports-finance?tab=official", "/reports-finance?tab=patients", "/reports-finance?tab=finance", "/reports-finance?tab=wounded", "/reports-finance?tab=approvals", "/reports-finance?tab=exports"] },
  { key: "staff", title: "الموظفون والمهام", icon: "🗂", href: "/staff?tab=overview", hrefs: ["/staff?tab=overview", "/staff?tab=employees", "/staff?tab=tasks", "/staff?tab=attendance", "/staff?tab=shifts", "/staff?tab=leaves", "/staff?tab=reports"] },
  { key: "system", title: "النظام", icon: "⚙", href: "/settings", hrefs: ["/settings", "/users", "/permissions", "/audit", "/login-log", "/backup", "/readiness"] },
];

export const MOBILE_QUICK_HREFS = ["/patients-care?tab=overview", "/therapy-centers?tab=overview", "/pharmacy-inventory?tab=overview", "/staff?tab=overview"];

export type SidebarRule = { standalone: string[]; groups: string[]; hrefs?: string[] };

export const ROLE_SIDEBAR_RULES: Partial<Record<UserRole, SidebarRule>> = {
  RECEPTION: { standalone: STANDALONE, groups: ["care"], hrefs: ["/patients-care?tab=overview", "/patients-care?tab=patients", "/patients-care?tab=queue", "/patients-care?tab=visits", "/patients-care?tab=appointments"] },
  HEAD_THERAPIST: { standalone: STANDALONE, groups: ["care", "therapy"], hrefs: ["/patients-care?tab=overview", "/patients-care?tab=patients", "/patients-care?tab=queue", "/patients-care?tab=visits", "/patients-care?tab=appointments", "/patients-care?tab=referrals", "/patients-care?tab=journey", "/therapy-centers?tab=overview", "/therapy-centers?tab=plans", "/therapy-centers?tab=sessions", "/therapy-centers?tab=today", "/therapy-centers?tab=centers", "/therapy-centers?tab=meds"] },
  THERAPIST: { standalone: STANDALONE, groups: ["therapy", "staff"], hrefs: ["/therapy-centers?tab=overview", "/therapy-centers?tab=plans", "/therapy-centers?tab=sessions", "/therapy-centers?tab=today", "/therapy-centers?tab=centers", "/therapy-centers?tab=meds", "/staff?tab=overview", "/staff?tab=tasks"] },
  PHARMACIST: { standalone: STANDALONE, groups: ["pharm"] },
  ACCOUNTANT: { standalone: STANDALONE, groups: ["reports"], hrefs: ["/reports-finance?tab=overview", "/reports-finance?tab=official", "/reports-finance?tab=patients", "/reports-finance?tab=finance", "/reports-finance?tab=wounded", "/reports-finance?tab=approvals"] },
  DOCTOR: { standalone: STANDALONE, groups: ["care", "therapy", "reports"] },
  RESIDENT: { standalone: STANDALONE, groups: ["care", "therapy", "reports"] },
  DATA_ENTRY: { standalone: STANDALONE, groups: ["care"] },
  LAB: { standalone: STANDALONE, groups: ["care"] },
  RADIOLOGY: { standalone: STANDALONE, groups: ["care"] },
  DRESSING: { standalone: STANDALONE, groups: ["care"], hrefs: ["/patients-care?tab=overview", "/patients-care?tab=patients", "/patients-care?tab=queue", "/patients-care?tab=visits", "/patients-care?tab=appointments"] },
  PROSTHETICS: { standalone: STANDALONE, groups: ["care", "staff"], hrefs: ["/patients-care?tab=overview", "/patients-care?tab=patients", "/patients-care?tab=queue", "/patients-care?tab=visits", "/patients-care?tab=appointments", "/staff?tab=overview", "/staff?tab=tasks"] },
  MANAGER: { standalone: STANDALONE, groups: ["care", "therapy", "reports", "pharm", "staff"] },
  VIEWER: { standalone: STANDALONE, groups: ["care", "reports"] },
};

const SECTION_BY_PREFIX: [string, string][] = [
  ["/patients-care", "care"],
  ["/therapy-centers", "therapy"],
  ["/pharmacy-inventory", "pharmacy"],
  ["/reports-finance", "reports"],
  ["/staff", "staff"],
  ["/settings", "system"],
  ["/users", "system"],
  ["/permissions", "system"],
  ["/audit", "system"],
  ["/login-log", "system"],
  ["/backup", "system"],
  ["/readiness", "system"],
];

const SENSITIVE_PERMISSIONS = new Set([
  "audit.view", "settings.backup", "users.manage", "users.permissions",
  "expenses.amounts", "expenses.approve", "expenses.pay", "finance.view",
  "pharmacy.purchase.prices", "files.admin",
]);

function required(item: Pick<NavigationItem, "perm" | "perms">) {
  return item.perm ? [item.perm] : item.perms ?? [];
}

export function canOpenRegistryItem(item: Pick<NavigationItem, "perm" | "perms">, permissions: Set<string>) {
  return required(item).some((permission) => permissions.has(permission));
}

export function registryEntryForHref(href: string) {
  return WORK_REGISTRY.find((entry) => entry.deepLink === href)
    ?? WORK_REGISTRY.find((entry) => entry.route !== "/" && href.startsWith(entry.route));
}

export function requiredPermissionsForHref(href: string) {
  return registryEntryForHref(href)?.requiredPermissions ?? null;
}

export const WORK_REGISTRY: WorkRegistryEntry[] = ALL_ITEMS.map((item, index) => {
  const [route, query = ""] = item.href.split("?");
  const tab = new URLSearchParams(query).get("tab");
  const section = SECTION_BY_PREFIX.find(([prefix]) => route.startsWith(prefix))?.[1] ?? "general";
  const permissions = required(item);
  const suggestedRoles = (Object.entries(ROLE_SIDEBAR_RULES) as [UserRole, SidebarRule][])
    .filter(([, rule]) => rule.standalone.includes(item.href) || rule.hrefs?.includes(item.href) || NAV_GROUPS.some((group) => rule.groups.includes(group.key) && group.hrefs.includes(item.href)))
    .map(([role]) => role);
  return {
    key: `${section}-${(tab ?? route.replace(/\W+/g, "-")) || "home"}-${index}`,
    route,
    hub: tab ? route : null,
    tab,
    label: item.label,
    requiredPermissions: permissions,
    suggestedRoles,
    section,
    surfaces: ["sidebar", ...(STANDALONE.includes(item.href) ? ["workspace" as const] : []), ...(item.href === "/my-work" ? ["my-work" as const] : [])],
    deepLink: item.href,
    sensitive: permissions.some((permission) => SENSITIVE_PERMISSIONS.has(permission)),
  };
});
