import type { CenterMembershipRole, HandoffStatus, UserRole } from "@prisma/client";

export const HANDOFF_LIMIT_MINUTES = {
  RESIDENT: 30,
  DOCTOR: 45,
  HEAD_THERAPIST: 240,
  THERAPIST: 3 * 24 * 60,
  SECRETARY: 20,
  RECEPTION: 20,
  DATA_ENTRY: 20,
} as const satisfies Partial<Record<UserRole, number>>;

export type HandoffTargetRole = keyof typeof HANDOFF_LIMIT_MINUTES;

export const CROSS_CENTER_LIMIT_MINUTES = 24 * 60;

export const CENTER_ROLE_FOR_TARGET = {
  SECRETARY: "SECRETARY",
  RESIDENT: "RESIDENT",
  DOCTOR: "SPECIALIST",
  HEAD_THERAPIST: "HEAD_THERAPIST",
  THERAPIST: "THERAPIST",
} as const satisfies Partial<Record<HandoffTargetRole, CenterMembershipRole>>;

export const BRANCH_LEVEL_ROLES = ["RECEPTION", "DATA_ENTRY"] as const;

export const HANDOFF_TARGET_LABELS = {
  SECRETARY: "سكرتارية المركز",
  RESIDENT: "طبيب مقيم",
  DOCTOR: "طبيب اختصاص",
  HEAD_THERAPIST: "رئيس المعالجين",
  THERAPIST: "معالج",
  RECEPTION: "الاستقبال",
  DATA_ENTRY: "إدخال البيانات",
} as const satisfies Record<HandoffTargetRole, string>;

export const HANDOFF_STATUS_LABELS = {
  SENT: "مرسل",
  ACCEPTED: "مستلم",
  DONE: "مكتمل",
  RETURNED: "معاد",
  CANCELLED: "ملغى",
} as const satisfies Record<HandoffStatus, string>;

export const HANDOFF_LOAD_LABELS = {
  light: "خفيف",
  medium: "متوسط",
  busy: "مزدحم",
} as const;

export type HandoffLoad = keyof typeof HANDOFF_LOAD_LABELS;

export function handoffLoad(count: number): HandoffLoad {
  return count >= 6 ? "busy" : count >= 3 ? "medium" : "light";
}

export function handoffLimitMinutes(handoff: {
  toRole: UserRole;
  fromCenterId?: number | null;
  toCenterId?: number | null;
}): number {
  if (
    handoff.fromCenterId != null &&
    handoff.toCenterId != null &&
    handoff.fromCenterId !== handoff.toCenterId
  ) {
    return CROSS_CENTER_LIMIT_MINUTES;
  }

  // A return can target its original sender in a non-target role (e.g. ADMIN).
  return (HANDOFF_LIMIT_MINUTES as Partial<Record<UserRole, number>>)[handoff.toRole] ?? 20;
}

export function handoffDelayColor(
  sentAt: Date | string,
  now: Date | string,
  limit: number,
): "green" | "yellow" | "red" {
  const elapsedMinutes = (new Date(now).getTime() - new Date(sentAt).getTime()) / 60_000;
  if (elapsedMinutes < (2 / 3) * limit) return "green";
  return elapsedMinutes <= limit ? "yellow" : "red";
}
