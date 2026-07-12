export const CENTER_SPACES = {
  psychological: { title: "مركز التأهيل النفسي", patterns: ["النفسي", "نفسي"], services: ["PSYCHOLOGICAL"] },
  occupational: { title: "مركز العلاج الوظيفي", patterns: ["الوظيفي", "وظيفي"], services: ["OCCUPATIONAL_MEDICAL", "OCCUPATIONAL_ART"] },
  naqaa: { title: "مركز النقاء التخصصي", patterns: ["النقاء", "نقاء"], services: ["ULCER_CARE", "PAIN_MEDICINE", "HYPERBARIC", "OZONE"] },
} as const;

export const SERVICE_LABELS: Record<string, string> = {
  PSYCHOLOGICAL: "التأهيل النفسي",
  OCCUPATIONAL_MEDICAL: "التأهيل الطبي الوظيفي",
  OCCUPATIONAL_ART: "التأهيل بالفن",
  ULCER_CARE: "علاج التقرحات",
  PAIN_MEDICINE: "طب الألم",
  HYPERBARIC: "الهايبر أوكسجين",
  OZONE: "الأوزون",
};

export async function resolveCenter(prisma: any, slug: keyof typeof CENTER_SPACES) {
  const config = CENTER_SPACES[slug];
  const centers = await prisma.center.findMany({ orderBy: { id: "asc" } });
  const center = centers.find((item: any) => config.patterns.some((pattern) => item.name.includes(pattern)));
  return { config, center };
}

export function allowedServicesForCenterName(name: string) {
  const space = Object.values(CENTER_SPACES).find((item) => item.patterns.some((pattern) => name.includes(pattern)));
  return space ? [...space.services] : [];
}
