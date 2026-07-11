import type { UserRole } from "@prisma/client";

// من يقدر يعدّل البيانات (إضافة/تعديل/حذف)
export const canEdit = (role?: UserRole) =>
  role === "ADMIN" || role === "MANAGER" || role === "DOCTOR" || role === "THERAPIST";
export const canManageUsers = (role?: UserRole) => role === "ADMIN";
export const canManageFinance = (role?: UserRole) => role === "ADMIN" || role === "ACCOUNTANT";
export const canDelete = (role?: UserRole) => role === "ADMIN"; // الحذف حصري للأدمن

// وصول كل دور إلى الأقسام — كل دور يرى ويفتح صفحاته فقط
export type Section =
  | "dashboard" | "patients" | "appointments" | "queue" | "reports"
  | "inventory" | "beds" | "meds" | "devices" | "workload" | "attendance"
  | "analytics" | "official" | "finance" | "settings" | "users";

const ACCESS: Record<Section, UserRole[]> = {
  dashboard:    ["ADMIN", "MANAGER", "DOCTOR", "THERAPIST", "ACCOUNTANT", "VIEWER"],
  patients:     ["ADMIN", "MANAGER", "DOCTOR", "THERAPIST", "ACCOUNTANT", "VIEWER"],
  appointments: ["ADMIN", "MANAGER", "DOCTOR", "THERAPIST", "VIEWER"],
  queue:        ["ADMIN", "MANAGER", "DOCTOR", "THERAPIST", "VIEWER"],
  reports:      ["ADMIN", "MANAGER", "DOCTOR", "THERAPIST"],
  inventory:    ["ADMIN", "MANAGER", "DOCTOR"],
  beds:         ["ADMIN", "MANAGER", "DOCTOR"],
  meds:         ["ADMIN", "MANAGER", "DOCTOR", "THERAPIST"],
  devices:      ["ADMIN", "MANAGER"],
  workload:     ["ADMIN", "MANAGER", "DOCTOR"],
  attendance:   ["ADMIN", "MANAGER"],
  analytics:    ["ADMIN", "MANAGER"],
  official:     ["ADMIN", "MANAGER", "ACCOUNTANT"],
  finance:      ["ADMIN", "ACCOUNTANT"],
  settings:     ["ADMIN"],
  users:        ["ADMIN"],
};

export const canAccess = (role: UserRole | undefined, section: Section) =>
  !!role && ACCESS[section].includes(role);

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "مدير النظام",
  MANAGER: "مدير إداري",
  DOCTOR: "طبيب",
  THERAPIST: "معالج",
  VIEWER: "مشاهدة فقط",
  ACCOUNTANT: "شعبة مالية",
  PHARMACIST: "صيدلي",
  RECEPTION: "استقبال",
  LAB: "مختبر",
  RADIOLOGY: "أشعة",
  DRESSING: "تضميد",
  PROSTHETICS: "أطراف صناعية",
  HEAD_THERAPIST: "رئيس المعالجين",
  DATA_ENTRY: "مدخل بيانات",
  RESIDENT: "طبيب مقيم",
};
