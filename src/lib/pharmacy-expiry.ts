// One expiry rule for the whole pharmacy: a batch that ends within 30 days is urgent (red),
// within 90 days is near (yellow). Every page, badge and count uses these two numbers.
export const EXPIRY_URGENT_DAYS = 30;
export const EXPIRY_SOON_DAYS = 90;
const DAY_MS = 86_400_000;

export type ExpiryLevel = "expired" | "urgent" | "soon" | "ok" | "none";

export function expiryCutoffs(now: Date = new Date()) {
  return {
    urgent: new Date(now.getTime() + EXPIRY_URGENT_DAYS * DAY_MS),
    soon: new Date(now.getTime() + EXPIRY_SOON_DAYS * DAY_MS),
  };
}

export function expiryLevel(date: Date | string | null | undefined, now: Date = new Date()): ExpiryLevel {
  if (!date) return "none";
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return "none";
  if (time < now.getTime()) return "expired";
  if (time <= now.getTime() + EXPIRY_URGENT_DAYS * DAY_MS) return "urgent";
  if (time <= now.getTime() + EXPIRY_SOON_DAYS * DAY_MS) return "soon";
  return "ok";
}

export const EXPIRY_LABEL: Record<ExpiryLevel, string> = {
  expired: "منتهية",
  urgent: "عاجل",
  soon: "قريب",
  ok: "جيدة",
  none: "بدون تاريخ",
};

export const EXPIRY_BADGE: Record<ExpiryLevel, string> = {
  expired: "bg-red-100 text-red-800",
  urgent: "bg-red-50 text-red-700",
  soon: "bg-amber-50 text-amber-800",
  ok: "bg-emerald-50 text-emerald-700",
  none: "bg-gray-100 text-gray-600",
};

export const EXPIRY_ROW: Record<ExpiryLevel, string> = {
  expired: "bg-red-50/50",
  urgent: "bg-red-50/30",
  soon: "bg-amber-50/30",
  ok: "",
  none: "",
};
