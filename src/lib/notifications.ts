export type NotificationKind = "tasks" | "appointments" | "inventory" | "devices" | "referrals" | "system";

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
  system: { kind: "system", label: "نظام", icon: "⚙", className: "border-slate-200 bg-slate-50 text-slate-700" },
};

export function notificationKind(input: { title?: string | null; link?: string | null }): NotificationKind {
  const title = input.title ?? "";
  const link = input.link ?? "";
  if (link.startsWith("/tasks") || title.includes("مهمة")) return "tasks";
  if (link.startsWith("/appointments") || title.includes("موعد")) return "appointments";
  if (link.startsWith("/pharmacy") || link.startsWith("/inventory") || title.includes("وصفة") || title.includes("مخزون")) return "inventory";
  if (link.startsWith("/devices") || title.includes("جهاز") || title.includes("صيانة")) return "devices";
  if (link.startsWith("/referrals") || title.includes("إحالة") || title.includes("فحص خارجي")) return "referrals";
  return "system";
}

export function notificationTone(input: { title?: string | null; link?: string | null }) {
  return TONES[notificationKind(input)];
}

export function permissionForLink(link?: string | null) {
  if (!link) return null;
  if (link.startsWith("/tasks")) return "tasks.view";
  if (link.startsWith("/appointments")) return "appointments.view";
  if (link.startsWith("/pharmacy")) return "pharmacy.view";
  if (link.startsWith("/inventory")) return "inventory.view";
  if (link.startsWith("/devices")) return "devices.view";
  if (link.startsWith("/referrals")) return "referrals.view";
  if (link.startsWith("/backup")) return "settings.backup";
  if (link.startsWith("/readiness")) return "settings.view";
  if (link.startsWith("/patients")) return "patients.view";
  if (link.startsWith("/queue")) return "queue.view";
  if (link.startsWith("/care-board") || link.startsWith("/station-kpis")) return "journey.view";
  return null;
}

export function canOpenNotification(link: string | null | undefined, perms: Set<string>) {
  const required = permissionForLink(link);
  return !required || perms.has(required);
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
  { value: "system", label: "نظام" },
];
