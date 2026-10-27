import type { UserRole } from "@prisma/client";

export type CenterStation = {
  key: string;
  name: string;
  role: UserRole;
  description: string;
  href: string;
  aliases?: string[];
};

export const CENTER_STATIONS: CenterStation[] = [
  { key: "reception", name: "الاستقبال", role: "RECEPTION", description: "تسجيل الحضور والطابور", href: "/visits" },
  { key: "doctor", name: "طبيب/تشخيص", role: "DOCTOR", description: "الفحص والتشخيص والقرار الطبي", href: "/care-board", aliases: ["فحص الطبيب", "الطبيب", "التشخيص", "الطبيب/التشخيص"] },
  { key: "therapy", name: "علاج طبيعي", role: "THERAPIST", description: "الجلسات والخطط والتمارين", href: "/workload", aliases: ["العلاج الطبيعي", "العلاج الوظيفي"] },
  { key: "pharmacy", name: "صيدلية", role: "PHARMACIST", description: "الوصفات والصرف", href: "/pharmacy", aliases: ["الصيدلية"] },
  { key: "devices", name: "أجهزة/أطراف", role: "PROSTHETICS", description: "الأجهزة والأطراف والصيانة", href: "/devices", aliases: ["الأطراف الصناعية", "الأجهزة", "الأجهزة/الأطراف"] },
  { key: "dressing", name: "تضميد/جروح", role: "DRESSING", description: "الجروح والتضميد والرعاية", href: "/care-board", aliases: ["التضميد", "الجروح", "تقييم الجروح"] },
  { key: "finance", name: "مالية", role: "ACCOUNTANT", description: "الفواتير والمدفوعات", href: "/finance", aliases: ["المحاسبة", "المالية"] },
  { key: "laboratory", name: "المختبر", role: "LAB", description: "فحوصات مختبرية", href: "/referrals" },
  { key: "radiology", name: "الأشعة", role: "RADIOLOGY", description: "تصوير وأشعة", href: "/referrals" },
  { key: "followup", name: "المتابعة", role: "DOCTOR", description: "مراجعة وخطوة لاحقة", href: "/care-board" },
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
