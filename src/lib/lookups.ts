import { prisma } from "./db";
import { unstable_cache } from "next/cache";

// مدة الكاش (ثوانٍ) — القوائم تتغيّر نادراً. التحديث الفوري يجي عبر revalidateTag("lookups", { expire: 0 }).
const TTL = 300;
const TAG = ["lookups"];

// ===== القوائم مجمّعة (لنماذج إضافة/تعديل المريض) =====
export const getLookups = unstable_cache(
  async () => {
    const [governorates, injuryTypes, centers, medications, formations, ranks, employees, rooms, branches, mobilityAids, prostheticTypes] = await Promise.all([
      prisma.governorate.findMany({ include: { districts: { orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
      prisma.injuryType.findMany({ orderBy: { name: "asc" } }),
      prisma.center.findMany({ orderBy: { name: "asc" } }),
      prisma.medication.findMany({ orderBy: { name: "asc" } }),
      prisma.formation.findMany({ orderBy: { name: "asc" } }),
      prisma.rank.findMany({ orderBy: { name: "asc" } }),
      prisma.employee.findMany({ orderBy: { name: "asc" } }),
      prisma.room.findMany({ orderBy: { name: "asc" } }),
      prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.mobilityAid.findMany({ orderBy: { name: "asc" } }),
      prisma.prostheticType.findMany({ orderBy: { name: "asc" } }),
    ]);
    return { governorates, injuryTypes, centers, medications, formations, ranks, employees, rooms, branches, mobilityAids, prostheticTypes };
  },
  ["lookups-all"],
  { revalidate: TTL, tags: TAG }
);

// ===== قوائم مفردة مكاشة (تُستخدم بصفحات كثيرة) =====
export const getGovernorates = unstable_cache(
  async () => prisma.governorate.findMany({ orderBy: { name: "asc" } }),
  ["lookups-governorates"], { revalidate: TTL, tags: TAG }
);
export const getInjuryTypes = unstable_cache(
  async () => prisma.injuryType.findMany({ orderBy: { name: "asc" } }),
  ["lookups-injuryTypes"], { revalidate: TTL, tags: TAG }
);
export const getCenters = unstable_cache(
  async () => prisma.center.findMany({ orderBy: { name: "asc" } }),
  ["lookups-centers"], { revalidate: TTL, tags: TAG }
);
export const getMedicationsList = unstable_cache(
  async () => prisma.medication.findMany({ orderBy: { name: "asc" } }),
  ["lookups-medications"], { revalidate: TTL, tags: TAG }
);
export const getRooms = unstable_cache(
  async () => prisma.room.findMany({ orderBy: { name: "asc" } }),
  ["lookups-rooms"], { revalidate: TTL, tags: TAG }
);
export const getEmployees = unstable_cache(
  async () => prisma.employee.findMany({ orderBy: { name: "asc" } }),
  ["lookups-employees"], { revalidate: TTL, tags: TAG }
);
