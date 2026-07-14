export const DEFAULT_QUEUE_HALLS = [
  "قاعة التمارين الميكانيكية",
  "قاعة الأجهزة الفيزياوية",
  "قاعة العلاج المائي",
] as const;

export function queueHallNames(names: string[]) {
  return Array.from(new Set([...DEFAULT_QUEUE_HALLS, ...names])).sort((a, b) => a.localeCompare(b, "ar"));
}
