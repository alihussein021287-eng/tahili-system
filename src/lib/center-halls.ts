export type CenterHallOption = {
  centerId: number;
  centerName: string;
  hallId: number;
  hallName: string;
  resourceId: string;
  resourceName: string;
  active: boolean;
  status: string;
};

export const DEFAULT_CENTER_HALLS = [
  { center: "مركز العلاج الطبيعي", halls: ["قاعة العلاج الميكانيكي", "قاعة العلاج الفيزيائي", "قاعة العلاج المائي"] },
  { center: "مركز التأهيل النفسي", halls: ["استشارية", "أجهزة", "تأهيل كبار", "تأهيل أطفال"] },
  { center: "مركز النقاء التخصصي", halls: ["القروح", "الألم", "الهايبر أوكسجين"] },
  { center: "مركز العلاج الوظيفي", halls: ["التأهيل", "الفنون"] },
] as const;

export function mapCenterHallResources(resources: any[]): CenterHallOption[] {
  return resources
    .filter((resource) => resource.center && resource.therapyHall)
    .map((resource) => ({
      centerId: resource.centerId,
      centerName: resource.center.name,
      hallId: resource.therapyHallId,
      hallName: resource.therapyHall.name,
      resourceId: resource.id,
      resourceName: resource.name,
      active: Boolean(resource.therapyHall.active),
      status: resource.status,
    }));
}

export function activeCenterHallNames(options: CenterHallOption[]) {
  return Array.from(
    new Set(
      options
        .filter((option) => option.active && option.status === "AVAILABLE")
        .map((option) => option.hallName),
    ),
  ).sort((a, b) => a.localeCompare(b, "ar"));
}

export async function activeCenterHallOptions(db: any): Promise<CenterHallOption[]> {
  const resources = await db.centerResource.findMany({
    where: { type: "HALL", status: "AVAILABLE", therapyHallId: { not: null }, therapyHall: { is: { active: true } } },
    include: { center: { select: { id: true, name: true } }, therapyHall: { select: { id: true, name: true, active: true } } },
    orderBy: [{ centerId: "asc" }, { name: "asc" }],
  });
  return mapCenterHallResources(resources);
}

export async function assertCenterHallByName(db: any, centerId: number, hallName: string | null | undefined) {
  const value = hallName?.trim();
  if (!Number.isInteger(centerId) || centerId <= 0) throw new Error("اختر المركز أولاً");
  if (!value) throw new Error("اختر الفرع/القاعة");
  const resource = await db.centerResource.findFirst({
    where: {
      centerId,
      type: "HALL",
      status: "AVAILABLE",
      therapyHallId: { not: null },
      therapyHall: { is: { active: true } },
      OR: [{ name: value }, { therapyHall: { is: { name: value } } }],
    },
    include: { therapyHall: true },
  });
  if (!resource?.therapyHall) throw new Error("الفرع/القاعة لا يتبع المركز المختار");
  return resource;
}

export async function assertCenterHallById(db: any, centerId: number, hallId: number | null | undefined) {
  if (!Number.isInteger(centerId) || centerId <= 0) throw new Error("اختر المركز أولاً");
  if (!Number.isInteger(hallId) || !hallId || hallId <= 0) return null;
  const resource = await db.centerResource.findFirst({
    where: {
      centerId,
      type: "HALL",
      status: "AVAILABLE",
      therapyHallId: hallId,
      therapyHall: { is: { active: true } },
    },
    include: { therapyHall: true },
  });
  if (!resource?.therapyHall) throw new Error("الفرع/القاعة لا يتبع المركز المختار");
  return resource;
}
