export const DEFAULT_QUEUE_HALLS = [
  "قاعة العلاج الميكانيكي",
  "قاعة العلاج الفيزيائي",
  "قاعة العلاج المائي",
] as const;

export function queueHallNames(names: string[]) {
  const visibleNames = names.filter((name) => !/^ACCEPTANCE-\d{8}(?:\s|$)/i.test(name.trim()));
  const source = visibleNames.length ? visibleNames : [...DEFAULT_QUEUE_HALLS];
  return Array.from(new Set(source)).sort((a, b) => a.localeCompare(b, "ar"));
}
