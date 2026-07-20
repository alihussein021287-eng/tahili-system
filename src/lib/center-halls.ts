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

export const DELETE_BLOCKED_MESSAGE = "لا يمكن حذف هذا العنصر لأنه مستخدم، يمكنك تعطيله بدلاً من الحذف";
export const DUPLICATE_CENTER_MESSAGE = "لا يمكن إضافة مركز بنفس الاسم";
export const DUPLICATE_CENTER_HALL_MESSAGE = "لا يمكن إضافة فرع بنفس الاسم داخل نفس المركز";

export const DEFAULT_CENTER_HALLS = [
  { center: "مركز العلاج الطبيعي", halls: ["قاعة العلاج الميكانيكي", "قاعة العلاج الفيزيائي", "قاعة العلاج المائي"] },
  { center: "مركز التأهيل النفسي", halls: ["استشارية", "أجهزة", "تأهيل كبار", "تأهيل أطفال"] },
  { center: "مركز النقاء التخصصي", halls: ["القروح", "الألم", "الهايبر أوكسجين"] },
  { center: "مركز العلاج الوظيفي", halls: ["التأهيل", "الفنون"] },
] as const;

export function normalizeLookupName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

async function countWhere(db: any, delegate: string, where: any) {
  const model = db[delegate];
  if (!model?.count) return 0;
  return model.count({ where });
}

function nonZeroCounts(entries: [string, number][]) {
  return Object.fromEntries(entries.filter(([, count]) => count > 0));
}

function usageEntry(label: string) {
  return (count: number): [string, number] => [label, count];
}

export function usageTotal(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export async function assertNoDuplicateCenterName(db: any, name: string, excludeCenterId?: number) {
  const value = normalizeLookupName(name);
  if (!value) throw new Error("اسم المركز مطلوب");
  const existing = await db.center.findFirst({
    where: { name: value, ...(excludeCenterId ? { id: { not: excludeCenterId } } : {}) },
    select: { id: true },
  });
  if (existing) throw new Error(DUPLICATE_CENTER_MESSAGE);
  return value;
}

export async function assertNoDuplicateCenterHallName(db: any, centerId: number, name: string, excludeResourceId?: string) {
  const value = normalizeLookupName(name);
  if (!Number.isInteger(centerId) || centerId <= 0) throw new Error("اختر المركز أولاً");
  if (!value) throw new Error("اسم الفرع/القاعة مطلوب");
  const existing = await db.centerResource.findFirst({
    where: {
      centerId,
      type: "HALL",
      ...(excludeResourceId ? { id: { not: excludeResourceId } } : {}),
      OR: [{ name: value }, { therapyHall: { is: { name: value } } }],
    },
    select: { id: true },
  });
  if (existing) throw new Error(DUPLICATE_CENTER_HALL_MESSAGE);
  return value;
}

export async function centerDeleteUsageCounts(db: any, centerId: number) {
  const entries = await Promise.all([
    countWhere(db, "centerMembership", { centerId }).then(usageEntry("عضويات")),
    countWhere(db, "admission", { centerId }).then(usageEntry("رقود")),
    countWhere(db, "referralRequest", { destinationCenterId: centerId }).then(usageEntry("إحالات")),
    countWhere(db, "centerProgram", { centerId }).then(usageEntry("برامج مراكز")),
    countWhere(db, "centerSession", { centerId }).then(usageEntry("جلسات مراكز")),
    countWhere(db, "treatmentPlan", { centerId }).then(usageEntry("خطط علاجية")),
    countWhere(db, "therapySession", { centerId }).then(usageEntry("جلسات علاج")),
    countWhere(db, "appointment", { centerId }).then(usageEntry("مواعيد")),
    countWhere(db, "queueEntry", { centerId }).then(usageEntry("طابور")),
    countWhere(db, "displayDevice", { centerId }).then(usageEntry("شاشات انتظار")),
    countWhere(db, "conversation", { centerId }).then(usageEntry("محادثات تعاون")),
    countWhere(db, "folder", { centerId }).then(usageEntry("مجلدات تعاون")),
    countWhere(db, "collaborationFile", { centerId }).then(usageEntry("ملفات تعاون")),
    countWhere(db, "fileShare", { targetCenterId: centerId }).then(usageEntry("مشاركات ملفات")),
    countWhere(db, "collaborationQuota", { targetCenterId: centerId }).then(usageEntry("حصص تعاون")),
  ]);
  return nonZeroCounts(entries);
}

export async function centerHallDeleteUsageCounts(db: any, resource: { id: string; centerId: number; therapyHallId: number | null; name: string; therapyHall?: { name?: string | null } | null }) {
  const hallId = resource.therapyHallId;
  const hallName = normalizeLookupName(resource.therapyHall?.name || resource.name);
  const entries = await Promise.all([
    countWhere(db, "centerSession", { resourceId: resource.id }).then(usageEntry("جلسات مراكز")),
    hallId ? countWhere(db, "treatmentPlan", { centerId: resource.centerId, hallId }).then(usageEntry("خطط علاجية")) : Promise.resolve(["خطط علاجية", 0] as [string, number]),
    hallId ? countWhere(db, "therapySession", { centerId: resource.centerId, hallId }).then(usageEntry("جلسات علاج")) : Promise.resolve(["جلسات علاج", 0] as [string, number]),
    hallId ? countWhere(db, "appointment", { centerId: resource.centerId, hallId }).then(usageEntry("مواعيد")) : Promise.resolve(["مواعيد", 0] as [string, number]),
    hallName ? countWhere(db, "therapySession", { centerId: resource.centerId, hall: hallName }).then(usageEntry("جلسات علاج نصية")) : Promise.resolve(["جلسات علاج نصية", 0] as [string, number]),
    hallName ? countWhere(db, "appointment", { centerId: resource.centerId, notes: { contains: hallName } }).then(usageEntry("مواعيد نصية")) : Promise.resolve(["مواعيد نصية", 0] as [string, number]),
    hallName ? countWhere(db, "queueEntry", { centerId: resource.centerId, hall: hallName }).then(usageEntry("طابور")) : Promise.resolve(["طابور", 0] as [string, number]),
    hallName ? countWhere(db, "queueEntry", { centerId: null, hall: hallName }).then(usageEntry("طابور قديم")) : Promise.resolve(["طابور قديم", 0] as [string, number]),
    hallName ? countWhere(db, "displayDevice", { centerId: resource.centerId, halls: { has: hallName } }).then(usageEntry("شاشات انتظار")) : Promise.resolve(["شاشات انتظار", 0] as [string, number]),
  ]);
  return nonZeroCounts(entries);
}

export async function therapyHallGlobalUsageCounts(db: any, hallId: number, hallName?: string | null) {
  const name = normalizeLookupName(hallName);
  const entries = await Promise.all([
    countWhere(db, "centerResource", { therapyHallId: hallId }).then(usageEntry("ربط مراكز")),
    countWhere(db, "treatmentPlan", { hallId }).then(usageEntry("خطط علاجية")),
    countWhere(db, "therapySession", { hallId }).then(usageEntry("جلسات علاج")),
    countWhere(db, "appointment", { hallId }).then(usageEntry("مواعيد")),
    name ? countWhere(db, "queueEntry", { hall: name }).then(usageEntry("طابور")) : Promise.resolve(["طابور", 0] as [string, number]),
    name ? countWhere(db, "displayDevice", { halls: { has: name } }).then(usageEntry("شاشات انتظار")) : Promise.resolve(["شاشات انتظار", 0] as [string, number]),
  ]);
  return nonZeroCounts(entries);
}

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
