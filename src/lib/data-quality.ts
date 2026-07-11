import { prisma } from "@/lib/db";

export type DataQualityKind =
  | "strong-duplicate"
  | "possible-duplicate"
  | "missing-phone"
  | "bad-phone"
  | "missing-governorate"
  | "missing-injury"
  | "missing-case-type"
  | "archived";

export const DATA_QUALITY_LABELS: Record<DataQualityKind, string> = {
  "strong-duplicate": "مكررات قوية",
  "possible-duplicate": "مكررات محتملة",
  "missing-phone": "بدون هاتف",
  "bad-phone": "هاتف غير طبيعي",
  "missing-governorate": "بدون محافظة",
  "missing-injury": "بدون نوع إصابة",
  "missing-case-type": "بدون نوع حالة",
  archived: "مؤرشفون",
};

export type DataQualityIssue = {
  kind: DataQualityKind;
  label: string;
  patientId: string;
  fileNumber: number;
  fullName: string;
  phone: string | null;
  birthYear: number | null;
  governorate: string | null;
  injuryType: string | null;
  caseType: string | null;
  archivedAt: Date | null;
  detail: string;
  groupKey?: string;
};

type PatientRow = {
  id: string;
  fileNumber: number;
  fullName: string;
  phone: string | null;
  birthYear: number | null;
  governorate: { name: string } | null;
  injuryType: { name: string } | null;
  caseType: string | null;
  archivedAt: Date | null;
};

const normalizeName = (v: string) => v.trim().replace(/\s+/g, " ");
const normalizePhone = (v?: string | null) => (v ?? "").replace(/[^\d]/g, "");

function issue(kind: DataQualityKind, p: PatientRow, detail: string, groupKey?: string): DataQualityIssue {
  return {
    kind,
    label: DATA_QUALITY_LABELS[kind],
    patientId: p.id,
    fileNumber: p.fileNumber,
    fullName: p.fullName,
    phone: p.phone,
    birthYear: p.birthYear,
    governorate: p.governorate?.name ?? null,
    injuryType: p.injuryType?.name ?? null,
    caseType: p.caseType,
    archivedAt: p.archivedAt,
    detail,
    groupKey,
  };
}

export async function getPatientDataQuality(kind?: string) {
  const rows = await prisma.patient.findMany({
    select: {
      id: true,
      fileNumber: true,
      fullName: true,
      phone: true,
      birthYear: true,
      caseType: true,
      archivedAt: true,
      governorate: { select: { name: true } },
      injuryType: { select: { name: true } },
    },
    orderBy: { fileNumber: "asc" },
    take: 10000,
  });

  const issues: DataQualityIssue[] = [];
  const strong = new Map<string, PatientRow[]>();
  const possible = new Map<string, PatientRow[]>();

  for (const p of rows) {
    const phone = normalizePhone(p.phone);
    const name = normalizeName(p.fullName);
    if (name && phone && p.birthYear) {
      const key = `${name}|${phone}|${p.birthYear}`;
      strong.set(key, [...(strong.get(key) ?? []), p]);
    }
    if (name && p.birthYear) {
      const key = `${name}|${p.birthYear}`;
      possible.set(key, [...(possible.get(key) ?? []), p]);
    }
    if (!p.phone?.trim()) issues.push(issue("missing-phone", p, "رقم الهاتف فارغ"));
    else if (!/^\d{10,11}$/.test(phone)) issues.push(issue("bad-phone", p, `الهاتف المسجل: ${p.phone}`));
    if (!p.governorate) issues.push(issue("missing-governorate", p, "المحافظة غير محددة"));
    if (!p.injuryType) issues.push(issue("missing-injury", p, "نوع الإصابة غير محدد"));
    if (!p.caseType) issues.push(issue("missing-case-type", p, "نوع الحالة غير محدد"));
    if (p.archivedAt) issues.push(issue("archived", p, "المراجع مؤرشف"));
  }

  for (const [key, group] of strong) {
    if (group.length < 2) continue;
    const files = group.map((p) => `#${p.fileNumber}`).join(", ");
    for (const p of group) issues.push(issue("strong-duplicate", p, `تطابق قوي مع ملفات: ${files}`, key));
  }
  for (const [key, group] of possible) {
    if (group.length < 2) continue;
    const strongKeys = new Set(group.map((p) => `${normalizeName(p.fullName)}|${normalizePhone(p.phone)}|${p.birthYear}`));
    if (strongKeys.size === 1) continue;
    const files = group.map((p) => `#${p.fileNumber}`).join(", ");
    for (const p of group) issues.push(issue("possible-duplicate", p, `نفس الاسم وسنة التولد مع ملفات: ${files}`, key));
  }

  const counts = (Object.keys(DATA_QUALITY_LABELS) as DataQualityKind[]).map((k) => ({
    kind: k,
    label: DATA_QUALITY_LABELS[k],
    count: issues.filter((i) => i.kind === k).length,
  }));
  const filtered = kind && kind in DATA_QUALITY_LABELS ? issues.filter((i) => i.kind === kind) : issues;
  return { counts, issues: filtered.slice(0, 500), totalIssues: issues.length, scanned: rows.length };
}

