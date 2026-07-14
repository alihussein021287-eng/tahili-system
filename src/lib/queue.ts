export const DEFAULT_QUEUE_HALLS = [
  "قاعة التمارين الميكانيكية",
  "قاعة الأجهزة الفيزياوية",
  "قاعة العلاج المائي",
] as const;

export function queueHallNames(names: string[]) {
  const visibleNames = names.filter((name) => !/^ACCEPTANCE-\d{8}(?:\s|$)/i.test(name.trim()));
  return Array.from(new Set([...DEFAULT_QUEUE_HALLS, ...visibleNames])).sort((a, b) => a.localeCompare(b, "ar"));
}
