import { requiredPermissionsForHref } from "@/lib/work-registry";

export type NotificationKind = "tasks" | "appointments" | "inventory" | "devices" | "referrals" | "collaboration" | "system";
export type NotificationBucket = "urgent" | "action" | "info";

export type NotificationTone = {
  kind: NotificationKind;
  label: string;
  icon: string;
  className: string;
};

const TONES: Record<NotificationKind, NotificationTone> = {
  tasks: { kind: "tasks", label: "مهام", icon: "📌", className: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  appointments: { kind: "appointments", label: "مواعيد", icon: "📅", className: "border-sky-200 bg-sky-50 text-sky-700" },
  inventory: { kind: "inventory", label: "مخزون", icon: "📦", className: "border-orange-200 bg-orange-50 text-orange-700" },
  devices: { kind: "devices", label: "أجهزة", icon: "🔧", className: "border-amber-200 bg-amber-50 text-amber-700" },
  referrals: { kind: "referrals", label: "إحالات", icon: "↗", className: "border-teal-200 bg-teal-50 text-teal-700" },
  collaboration: { kind: "collaboration", label: "تعاون", icon: "💬", className: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  system: { kind: "system", label: "نظام", icon: "⚙", className: "border-slate-200 bg-slate-50 text-slate-700" },
};

export function notificationKind(input: { title?: string | null; link?: string | null }): NotificationKind {
  const title = input.title ?? "";
  const link = input.link ?? "";
  const tab = tabOf(link);
  if ((link.startsWith("/staff") && tab === "tasks") || link.startsWith("/tasks") || title.includes("مهمة")) return "tasks";
  if ((link.startsWith("/patients-care") && tab === "appointments") || link.startsWith("/appointments") || title.includes("موعد")) return "appointments";
  if (link.startsWith("/devices") || title.includes("جهاز") || title.includes("صيانة")) return "devices";
  if ((link.startsWith("/patients-care") && tab === "referrals") || link.startsWith("/referrals") || title.includes("إحالة") || title.includes("فحص خارجي")) return "referrals";
  if (link.startsWith("/collaboration") || title.includes("تعاون") || title.includes("ملف تعاون") || title.includes("الإشارة إليك")) return "collaboration";
  if (link.startsWith("/pharmacy-inventory") || link.startsWith("/pharmacy") || link.startsWith("/inventory") || title.includes("وصفة") || title.includes("مخزون")) return "inventory";
  return "system";
}

export function notificationTone(input: { title?: string | null; link?: string | null }) {
  return TONES[notificationKind(input)];
}

export function notificationBucket(input: { title?: string | null; body?: string | null; link?: string | null; read?: boolean }) {
  const text = `${input.title ?? ""} ${input.body ?? ""}`;
  if (/عاجل|متأخر|فشل|مرفوض|مقفل|منتهي|نفاد|خطر/.test(text)) return "urgent" as const;
  if (!input.read || input.link || /ينتظر|مطلوب|اعتماد|مراجعة|تنفيذ|استلام|تجهيز/.test(text)) return "action" as const;
  return "info" as const;
}

export function canonicalNotificationLink(link?: string | null) {
  if (!link) return null;
  const replacements: Record<string, string> = {
    "/tasks": "/staff?tab=tasks",
    "/appointments": "/patients-care?tab=appointments",
    "/queue": "/patients-care?tab=queue",
    "/visits": "/patients-care?tab=visits",
    "/referrals": "/patients-care?tab=referrals",
    "/pharmacy": "/pharmacy-inventory?tab=dispense",
    "/inventory": "/pharmacy-inventory?tab=stock",
    "/finance": "/reports-finance?tab=finance",
    "/approvals": "/reports-finance?tab=approvals",
  };
  return replacements[link] ?? link;
}

export function groupNotifications<T extends { id: string; title: string; body?: string | null; link?: string | null; read: boolean; createdAt: Date }>(rows: T[]) {
  const groups = new Map<string, T & { groupedCount: number; groupedIds: string[]; bucket: NotificationBucket; canonicalLink: string | null }>();
  for (const row of rows) {
    const canonicalLink = canonicalNotificationLink(row.link);
    const bucket = notificationBucket({ ...row, link: canonicalLink });
    const key = `${row.read ? "read" : "unread"}|${row.title}|${canonicalLink ?? ""}|${bucket}`;
    const current = groups.get(key);
    if (current) {
      current.groupedCount += 1;
      current.groupedIds.push(row.id);
      if (row.createdAt > current.createdAt) Object.assign(current, row, { canonicalLink, bucket });
    } else {
      groups.set(key, { ...row, groupedCount: 1, groupedIds: [row.id], canonicalLink, bucket });
    }
  }
  const rank: Record<NotificationBucket, number> = { urgent: 0, action: 1, info: 2 };
  return [...groups.values()].sort((a, b) => rank[a.bucket] - rank[b.bucket] || b.createdAt.getTime() - a.createdAt.getTime());
}

function tabOf(link: string) {
  const query = link.split("?")[1] ?? "";
  if (!query) return "";
  try {
    return new URLSearchParams(query).get("tab") ?? "";
  } catch {
    return "";
  }
}

export function permissionsForLink(link?: string | null) {
  if (!link) return null;
  const registered = requiredPermissionsForHref(link);
  if (registered) return registered;
  const tab = tabOf(link);
  if (link.startsWith("/staff")) {
    if (tab === "tasks") return ["tasks.view"];
    if (tab === "attendance") return ["attendance.view"];
    if (tab === "shifts" || tab === "leaves") return ["shifts.view"];
    if (tab === "employees") return ["users.view"];
    return ["users.view", "attendance.view", "shifts.view", "tasks.view"];
  }
  if (link.startsWith("/tasks")) return ["tasks.view"];
  if (link.startsWith("/patients-care")) {
    if (tab === "visits") return ["visits.view"];
    if (tab === "queue") return ["queue.view"];
    if (tab === "journey") return ["journey.view"];
    if (tab === "referrals") return ["referrals.view"];
    if (tab === "appointments") return ["appointments.view"];
    if (tab === "new") return ["patients.create"];
    if (tab === "patients" || tab === "relatives" || tab === "alerts") return ["patients.view"];
    return ["patients.view", "patients.create", "visits.view", "queue.view", "journey.view", "referrals.view", "appointments.view"];
  }
  if (link.startsWith("/appointments")) return ["appointments.view"];
  if (link.startsWith("/therapy-centers")) {
    if (tab === "today") return ["therapy.session.record"];
    if (tab === "centers") return ["centers.view"];
    if (tab === "beds") return ["beds.view"];
    if (tab === "meds") return ["meds.view"];
    if (tab === "plans" || tab === "sessions" || tab === "program" || tab === "followup") return ["therapy.view", "therapy.session.record", "centers.view", "centers.sessions.record"];
    return ["therapy.view", "therapy.session.record", "centers.view", "beds.view", "meds.view", "centers.sessions.record"];
  }
  if (link.startsWith("/pharmacy-inventory")) {
    if (tab === "dispense") return ["pharmacy.view"];
    if (tab === "purchases" || tab === "receipts") return ["pharmacy.purchase.view"];
    if (tab === "stock" || tab === "batches") return ["pharmacy.view", "inventory.view"];
    if (tab === "reports" || tab === "alerts") return ["pharmacy.view", "inventory.view", "pharmacy.purchase.view"];
    return ["pharmacy.view", "inventory.view", "pharmacy.purchase.view"];
  }
  if (link.startsWith("/pharmacy")) return ["pharmacy.view"];
  if (link.startsWith("/inventory")) return ["inventory.view"];
  if (link.startsWith("/devices")) return ["devices.view"];
  if (link.startsWith("/reports-finance")) {
    if (tab === "finance") return ["finance.view", "finance.report"];
    if (tab === "wounded") return ["expenses.view", "expenses.reports", "expenses.approve", "expenses.pay"];
    if (tab === "approvals") return ["approvals.view", "expenses.approve", "expenses.pay", "reports.approve"];
    if (tab === "official") return ["reports.view", "reports.official", "officialdocs.view"];
    if (tab === "patients") return ["reports.view", "patients.print", "clinical.report"];
    if (tab === "exports") return ["patients.export", "patients.view", "expenses.reports", "officialdocs.view", "audit.view"];
    return ["reports.view", "reports.official", "finance.view", "finance.report", "expenses.view", "expenses.reports", "approvals.view", "officialdocs.view", "analytics.view", "patients.export"];
  }
  if (link.startsWith("/reports")) return ["reports.view"];
  if (link.startsWith("/finance")) return ["finance.view"];
  if (link.startsWith("/approvals")) return ["approvals.view"];
  if (link.startsWith("/referrals")) return ["referrals.view"];
  if (link.startsWith("/collaboration")) return ["collaboration.view"];
  if (link.startsWith("/backup")) return ["settings.backup"];
  if (link.startsWith("/readiness")) return ["settings.view"];
  if (link.startsWith("/patients")) return ["patients.view"];
  if (link.startsWith("/queue")) return ["queue.view"];
  if (link.startsWith("/care-board") || link.startsWith("/station-kpis")) return ["journey.view"];
  if (link.startsWith("/workspaces")) return ["dashboard.view"];
  return null;
}

export function permissionForLink(link?: string | null) {
  const permissions = permissionsForLink(link);
  return Array.isArray(permissions) ? permissions[0] ?? null : permissions;
}

export function canOpenNotification(link: string | null | undefined, perms: Set<string>) {
  const required = permissionsForLink(link);
  if (!required) return true;
  return required.some((permission) => perms.has(permission));
}

export function kindLabel(kind: string) {
  return (TONES as Record<string, NotificationTone>)[kind]?.label ?? "الكل";
}

export const NOTIFICATION_KINDS = [
  { value: "all", label: "الكل" },
  { value: "unread", label: "غير المقروء" },
  { value: "read", label: "المقروء" },
  { value: "tasks", label: "مهام" },
  { value: "appointments", label: "مواعيد" },
  { value: "inventory", label: "مخزون" },
  { value: "devices", label: "أجهزة" },
  { value: "referrals", label: "إحالات" },
  { value: "collaboration", label: "تعاون" },
  { value: "system", label: "نظام" },
];
