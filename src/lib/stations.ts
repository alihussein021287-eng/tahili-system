import type { UserRole } from "@prisma/client";

export type CenterStation = {
  name: string;
  role: UserRole;
  description: string;
  href: string;
  aliases?: string[];
};

export const CENTER_STATIONS: CenterStation[] = [
  { name: "الاستقبال", role: "RECEPTION", description: "تسجيل الحضور والطابور", href: "/patients-care?tab=visits" },
  { name: "طبيب/تشخيص", role: "DOCTOR", description: "الفحص والتشخيص والقرار الطبي", href: "/patients-care?tab=journey", aliases: ["فحص الطبيب", "الطبيب", "التشخيص", "الطبيب/التشخيص"] },
  { name: "علاج طبيعي", role: "THERAPIST", description: "الجلسات والخطط والتمارين", href: "/workload", aliases: ["العلاج الطبيعي", "العلاج الوظيفي"] },
  { name: "صيدلية", role: "PHARMACIST", description: "الوصفات والصرف", href: "/pharmacy-inventory?tab=dispense", aliases: ["الصيدلية"] },
  { name: "أجهزة/أطراف", role: "PROSTHETICS", description: "الأجهزة والأطراف والصيانة", href: "/devices", aliases: ["الأطراف الصناعية", "الأجهزة", "الأجهزة/الأطراف"] },
  { name: "تضميد/جروح", role: "DRESSING", description: "الجروح والتضميد والرعاية", href: "/patients-care?tab=journey", aliases: ["التضميد", "الجروح", "تقييم الجروح"] },
  { name: "مالية", role: "ACCOUNTANT", description: "الفواتير والمدفوعات", href: "/reports-finance?tab=finance", aliases: ["المحاسبة", "المالية"] },
  { name: "المختبر", role: "LAB", description: "فحوصات مختبرية", href: "/patients-care?tab=referrals" },
  { name: "الأشعة", role: "RADIOLOGY", description: "تصوير وأشعة", href: "/patients-care?tab=referrals" },
  { name: "المتابعة", role: "DOCTOR", description: "مراجعة وخطوة لاحقة", href: "/patients-care?tab=journey" },
];

export const CENTER_STATION_NAMES = CENTER_STATIONS.map((station) => station.name);

export function centerStationByName(name: string | null | undefined) {
  const value = (name ?? "").trim();
  if (!value) return null;
  return CENTER_STATIONS.find(
    (station) => station.name === value || station.aliases?.includes(value),
  ) ?? null;
}

export function normalizeStationName(name: string | null | undefined) {
  const value = (name ?? "").trim();
  if (!value) return "محطات أخرى";
  const found = centerStationByName(value);
  return found?.name ?? value;
}

export function stationForRole(role: string | null | undefined) {
  if (!role) return null;
  return CENTER_STATIONS.find((station) => station.role === role) ?? null;
}
