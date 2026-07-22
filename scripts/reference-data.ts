import { COMMON_LOOKUPS } from "./seed-common-lookups";
import { COMMON_MEDICATIONS } from "./seed-common-medications";
import { IRAQ_LOCATIONS } from "./seed-iraq-locations";

export const APPROVED_REFERENCE_DATA = {
  locations: IRAQ_LOCATIONS,
  branches: [] as readonly string[],
  centers: COMMON_LOOKUPS.center,
  centerHalls: [
    { center: "مركز العلاج الطبيعي", halls: ["قاعة العلاج الميكانيكي", "قاعة العلاج الفيزيائي", "قاعة العلاج المائي"] },
    { center: "مركز التأهيل النفسي", halls: ["استشارية", "أجهزة", "تأهيل كبار", "تأهيل أطفال"] },
    { center: "مركز النقاء التخصصي", halls: ["القروح", "الألم", "الهايبر أوكسجين"] },
    { center: "مركز العلاج الوظيفي", halls: ["التأهيل", "الفنون"] },
  ] as const,
  formations: COMMON_LOOKUPS.formation,
  ranks: COMMON_LOOKUPS.rank,
  injuryTypes: COMMON_LOOKUPS.injuryType,
  mobilityAids: COMMON_LOOKUPS.mobilityAid,
  prostheticTypes: COMMON_LOOKUPS.prostheticType,
  medications: COMMON_MEDICATIONS.map(([name, unit, minQuantity]) => ({ name, unit, minQuantity })),
} as const;

export function normalizeReferenceName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function isQaReferenceName(value: string) {
  return /(^|[\s_-])(qa|test|e2e|acceptance)([\s_-]|$)|اختبار/i.test(normalizeReferenceName(value));
}

export function approvedReferenceCounts() {
  return {
    governorates: Object.keys(APPROVED_REFERENCE_DATA.locations).length,
    districts: Object.values(APPROVED_REFERENCE_DATA.locations).reduce((sum, rows) => sum + rows.length, 0),
    branches: APPROVED_REFERENCE_DATA.branches.length,
    centers: APPROVED_REFERENCE_DATA.centers.length,
    centerHalls: APPROVED_REFERENCE_DATA.centerHalls.reduce((sum, row) => sum + row.halls.length, 0),
    formations: APPROVED_REFERENCE_DATA.formations.length,
    ranks: APPROVED_REFERENCE_DATA.ranks.length,
    injuryTypes: APPROVED_REFERENCE_DATA.injuryTypes.length,
    mobilityAids: APPROVED_REFERENCE_DATA.mobilityAids.length,
    prostheticTypes: APPROVED_REFERENCE_DATA.prostheticTypes.length,
    medications: APPROVED_REFERENCE_DATA.medications.length,
    batches: 0,
    stockQuantity: 0,
  };
}

export function assertApprovedReferenceData() {
  const names = [
    ...Object.keys(APPROVED_REFERENCE_DATA.locations),
    ...Object.values(APPROVED_REFERENCE_DATA.locations).flat(),
    ...APPROVED_REFERENCE_DATA.branches,
    ...APPROVED_REFERENCE_DATA.centers,
    ...APPROVED_REFERENCE_DATA.centerHalls.flatMap((row) => [row.center, ...row.halls]),
    ...APPROVED_REFERENCE_DATA.formations,
    ...APPROVED_REFERENCE_DATA.ranks,
    ...APPROVED_REFERENCE_DATA.injuryTypes,
    ...APPROVED_REFERENCE_DATA.mobilityAids,
    ...APPROVED_REFERENCE_DATA.prostheticTypes,
    ...APPROVED_REFERENCE_DATA.medications.map((item) => item.name),
  ];
  const qa = names.filter(isQaReferenceName);
  if (qa.length) throw new Error(`Approved reference source contains QA names (${qa.length}).`);
}
