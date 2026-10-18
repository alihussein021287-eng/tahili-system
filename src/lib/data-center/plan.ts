import crypto from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { centerRoleForUserRole } from "@/lib/center-membership";
import { ROLE_LABELS } from "@/lib/permissions";
import { IMPORT_DOMAIN_BY_ID, PRIVILEGED_ROLES, type FieldDef, type ImportDomain } from "./registry";
import { loadReferences, type References } from "./reference";
import { FILE_LIMITS, UploadRejected, sheetLib, type Workbook } from "./spreadsheet";

type Db = PrismaClient | Prisma.TransactionClient;

export type Disposition = "READY" | "MATCHED" | "DUPLICATE" | "HELD" | "INVALID" | "EXCLUDED" | "UPDATE_CANDIDATE";
export type FieldError = { field: string; code: string; message: string };
export type RowResult = {
  rowNumber: number; sourceKey: string; disposition: Disposition; reasons: string[]; fieldErrors: FieldError[];
  data?: Record<string, string>; matchId?: string; ref?: number;
};
export type Plan = {
  domain: string; branchId: number | null; fileSha256: string; sheet: string; rows: RowResult[];
  unmappedHeaders: string[]; counts: Record<string, number>; planSha256: string;
};

const YESNO_ALIASES: Record<string, string> = { yes: "1", true: "1", "1": "1", no: "0", false: "0", "0": "0" };
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export const nrm = (s: unknown) => sheetLib().normName(s);
export const clean = (s: unknown) => sheetLib().cleanName(s);
// Privileged roles are recognised (by key or system label) so the account planner can HOLD them; they are never valid import values.
const PRIVILEGED = new Map<string, string>(PRIVILEGED_ROLES.flatMap((r) => [[r.toLowerCase(), r], [nrm(ROLE_LABELS[r]), r]] as [string, string][]));
export const privilegedRole = (v: string) => PRIVILEGED.get(clean(v).toLowerCase()) ?? PRIVILEGED.get(nrm(v));

function pickSheet(wb: Workbook, domain: ImportDomain) {
  const byName = wb.sheets.find((s) => domain.sheetNames.some((n) => nrm(n) === nrm(s.name)));
  const sheet = byName ?? wb.sheets.find((s) => s.rows.some((r) => r.some((c) => clean(c)))) ?? wb.sheets[0];
  if (!sheet) throw new UploadRejected("NO_SHEET", "لا توجد ورقة بيانات في الملف");
  return sheet;
}

function mapColumns(domain: ImportDomain, header: string[]) {
  const index: Record<string, number> = {};
  const unmapped: string[] = [];
  header.forEach((h, i) => {
    const n = nrm(h);
    if (!n) return;
    const field = domain.fields.find((f) => [f.id, f.label, ...(f.aliases ?? [])].some((a) => nrm(a) === n));
    if (field && index[field.id] === undefined) index[field.id] = i; else unmapped.push(clean(h).slice(0, 40));
  });
  return { index, unmapped };
}

export function validateField(f: FieldDef, raw: string, refs: References): { value: string; error?: FieldError } {
  const lib = sheetLib();
  const v = clean(raw);
  if (v.length > FILE_LIMITS.maxCellChars) return { value: "", error: { field: f.id, code: "TOO_LONG", message: `القيمة أطول من ${FILE_LIMITS.maxCellChars} حرفاً` } };
  if (!v) return { value: "", error: f.required ? { field: f.id, code: "REQUIRED", message: `الحقل «${f.label}» مطلوب` } : undefined };
  const bad = (code: string, message: string) => ({ value: "", error: { field: f.id, code, message } as FieldError });
  switch (f.type) {
    case "phone": { const d = lib.latinDigits(v).replace(/[\s-]/g, ""); return /^\d{10,11}$/.test(d) ? { value: d } : bad("INVALID_PHONE", "رقم الهاتف يجب أن يكون 10 أو 11 رقماً (أرقام فقط)"); }
    case "year": { const y = lib.normYear(v); return y.valid && y.value ? { value: String(y.value) } : bad("INVALID_YEAR", "سنة التولد يجب أن تكون سنة صحيحة (1900 حتى السنة الحالية)"); }
    case "int": { const d = lib.latinDigits(v); return /^\d{1,3}(\.0+)?$/.test(d) ? { value: String(Number(d)) } : bad("INVALID_NUMBER", "رقم صحيح من 0 إلى 999"); }
    case "percent": { const n = Number(lib.latinDigits(v)); return Number.isFinite(n) && n >= 0 && n <= 100 ? { value: String(n) } : bad("INVALID_PERCENT", "نسبة العجز يجب أن تكون بين 0 و100"); }
    case "enum": {
      const k = Object.keys(f.enumMap ?? {}).find((a) => nrm(a) === nrm(v));
      if (k) return { value: f.enumMap![k] };
      const allowed = [...new Set(Object.keys(f.enumMap ?? {}).filter((x) => /[\u0600-\u06FF]/.test(x)))].join(" / ");
      return bad("INVALID_VALUE", `القيمة غير مسموحة؛ اختر من القائمة: ${allowed}`);
    }
    case "yesno": { const hit = f.enumMap?.[v] ?? YESNO_ALIASES[v.toLowerCase()]; return hit ? { value: hit } : bad("INVALID_VALUE", "القيمة: نعم أو لا"); }
    case "ref": { const list = (f.ref ? refs[f.ref] : []) ?? []; const hit = list.find((a) => nrm(a) === nrm(v)); return hit ? { value: hit } : bad("NOT_IN_REFERENCE_LIST", `«${f.label}» غير موجود في قائمة النظام؛ اختر من القائمة المنسدلة في القالب`); }
    case "username": return /^[A-Za-z0-9._-]{3,}$/.test(v) ? { value: v } : bad("INVALID_USERNAME", "اسم المستخدم: حروف وأرقام إنجليزية فقط بدون فراغات (. _ - مسموحة)، 3 أحرف على الأقل");
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { value: v.toLowerCase() } : bad("INVALID_EMAIL", "بريد إلكتروني غير صالح");
    case "date": {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) return { value: v };
      const n = Number(v); // Excel stores typed dates as serial numbers
      if (Number.isFinite(n) && n > 20000 && n < 80000) return { value: new Date(EXCEL_EPOCH + Math.floor(n) * 86400000).toISOString().slice(0, 10) };
      return bad("INVALID_DATE", "التاريخ بصيغة YYYY-MM-DD");
    }
    default: return { value: v };
  }
}

export type PlanContext = { branchId: number | null; fileSha256: string };

/** Builds the deterministic operation plan: every data row gets exactly one disposition. Reads the database, writes nothing. */
export async function buildPlan(db: Db, domainId: string, wb: Workbook, ctx: PlanContext): Promise<Plan> {
  const domain = IMPORT_DOMAIN_BY_ID[domainId];
  if (!domain) throw new UploadRejected("UNKNOWN_DOMAIN", "نوع البيانات غير مدعوم");
  const refs = await loadReferences(db);
  const sheet = pickSheet(wb, domain);
  const headerIdx = sheet.rows.findIndex((r) => r.some((c) => clean(c)));
  if (headerIdx < 0) throw new UploadRejected("EMPTY_SHEET", "الورقة فارغة");
  const { index, unmapped } = mapColumns(domain, sheet.rows[headerIdx].map(String));
  const missing = domain.fields.filter((f) => f.required && index[f.id] === undefined);
  if (missing.length) throw new UploadRejected("MISSING_COLUMNS", `أعمدة مطلوبة غير موجودة في الملف: ${missing.map((m) => `${m.label} (${m.id})`).join("، ")}. نزّل القالب الرسمي.`);

  // data rows (skip the Arabic label row of the official template; never skip silently otherwise)
  const labelSet = new Set(domain.fields.map((f) => nrm(f.label)));
  const formula = new Set((sheet.formulaCells ?? []).map(([r, c]) => `${r}:${c}`));
  const rows: RowResult[] = [];
  const parsed: { rowNumber: number; values: Record<string, string>; formulaCol: string | null }[] = [];
  for (let i = headerIdx + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i] ?? [];
    const rowNumber = i + 1;
    const nonEmpty = cells.filter((c) => clean(c));
    if (nonEmpty.length && nonEmpty.every((c) => labelSet.has(nrm(c)))) continue; // template label row
    const values: Record<string, string> = {};
    let formulaCol: string | null = null;
    for (const f of domain.fields) {
      const col = index[f.id];
      values[f.id] = col === undefined ? "" : String(cells[col] ?? "");
      if (col !== undefined && formula.has(`${i}:${col}`)) formulaCol = f.id;
    }
    parsed.push({ rowNumber, values, formulaCol: formulaCol ?? (nonEmpty.length ? null : "__blank") });
  }
  if (parsed.length > FILE_LIMITS.maxRows) throw new UploadRejected("TOO_MANY_ROWS", `عدد الصفوف يتجاوز الحد المسموح (${FILE_LIMITS.maxRows})`);

  const fileKey = ctx.fileSha256.slice(0, 12);
  const norm: { rowNumber: number; data: Record<string, string>; errors: FieldError[] }[] = [];
  for (const p of parsed) {
    const base = { rowNumber: p.rowNumber, sourceKey: `${fileKey}:${p.rowNumber}` };
    if (p.formulaCol === "__blank") { rows.push({ ...base, disposition: "EXCLUDED", reasons: ["BLANK_ROW"], fieldErrors: [] }); continue; }
    if (p.formulaCol) { rows.push({ ...base, disposition: "INVALID", reasons: ["FORMULA_NOT_ALLOWED"], fieldErrors: [{ field: p.formulaCol, code: "FORMULA_NOT_ALLOWED", message: "الصيغ (formulas) غير مسموحة؛ أدخل القيمة نفسها" }] }); continue; }
    const data: Record<string, string> = {};
    const errors: FieldError[] = [];
    for (const f of domain.fields) {
      // privileged roles are not "invalid values": they are recognised so the account planner can HOLD them for a separate approval
      if (domain.id === "accounts" && f.id === "role" && privilegedRole(p.values[f.id])) { data[f.id] = privilegedRole(p.values[f.id])!; continue; }
      const r = validateField(f, p.values[f.id], refs); data[f.id] = r.value; if (r.error) errors.push(r.error);
    }
    const minName = domain.id === "accounts" ? 2 : 3;
    if (data.fullName && nrm(data.fullName).replace(/\s/g, "").length < minName) errors.push({ field: "fullName", code: "NAME_TOO_SHORT", message: `الاسم ${minName} أحرف على الأقل` });
    if (domain.id === "patients" && data.birthDate && data.birthYear && !data.birthDate.startsWith(data.birthYear)) errors.push({ field: "birthDate", code: "BIRTH_DATE_YEAR_MISMATCH", message: "سنة تاريخ التولد لا تطابق سنة التولد" });
    if (errors.length) { rows.push({ ...base, disposition: "INVALID", reasons: errors.map((e) => e.code), fieldErrors: errors }); continue; }
    norm.push({ rowNumber: p.rowNumber, data, errors });
  }

  const add = (r: RowResult) => rows.push(r);
  const key = (n: number) => `${fileKey}:${n}`;
  if (domain.id === "patients") await planPatients(db, norm, ctx, add, key);
  else if (domain.id === "accounts") await planAccounts(db, norm, ctx, add, key);
  else if (domain.id === "memberships") await planMemberships(db, norm, ctx, add, key);
  else await planPersonnel(db, domain, norm, add, key);

  rows.sort((a, b) => a.rowNumber - b.rowNumber);
  const counts: Record<string, number> = { total: rows.length, ready: 0, matched: 0, duplicate: 0, held: 0, invalid: 0, excluded: 0, updateCandidates: 0 };
  for (const r of rows) {
    if (r.disposition === "READY") counts.ready++; else if (r.disposition === "MATCHED") counts.matched++; else if (r.disposition === "DUPLICATE") counts.duplicate++;
    else if (r.disposition === "HELD") counts.held++; else if (r.disposition === "INVALID") counts.invalid++; else if (r.disposition === "EXCLUDED") counts.excluded++; else counts.updateCandidates++;
  }
  const planSha256 = crypto.createHash("sha256").update(JSON.stringify({ d: domain.id, b: ctx.branchId, f: ctx.fileSha256, r: rows.map((r) => [r.rowNumber, r.disposition, r.matchId ?? null, r.disposition === "READY" ? r.data : null]) })).digest("hex");
  return { domain: domain.id, branchId: ctx.branchId, fileSha256: ctx.fileSha256, sheet: sheet.name, rows, unmappedHeaders: unmapped, counts, planSha256 };
}

type Norm = { rowNumber: number; data: Record<string, string>; errors: FieldError[] };
type Add = (r: RowResult) => void;
const held = (n: Norm, key: (n: number) => string, reason: string, need: string, extra: Partial<RowResult> = {}): RowResult => ({ rowNumber: n.rowNumber, sourceKey: key(n.rowNumber), disposition: "HELD", reasons: [reason], fieldErrors: [{ field: "*", code: reason, message: need }], ...extra });

async function planPatients(db: Db, rows: Norm[], ctx: PlanContext, add: Add, key: (n: number) => string) {
  const phones = [...new Set(rows.map((r) => r.data.phone).filter(Boolean))];
  const names = [...new Set(rows.map((r) => r.data.fullName))];
  const existing = await db.patient.findMany({
    where: { archivedAt: null, OR: [...(phones.length ? [{ phone: { in: phones } }] : []), { fullName: { in: names } }, { legacyFileNumber: { in: rows.map((r) => r.data.legacyFileNumber).filter(Boolean) } }] },
    select: { id: true, fullName: true, phone: true, birthYear: true, branchId: true, motherName: true, gender: true, housing: true, legacyFileNumber: true },
  });
  const groupCount = new Map<string, number[]>();
  for (const r of rows) { const k = `${nrm(r.data.fullName)}|${r.data.phone}`; if (!groupCount.has(k)) groupCount.set(k, []); groupCount.get(k)!.push(r.rowNumber); }
  const legacyCount = new Map<string, number[]>();
  for (const r of rows) if (r.data.legacyFileNumber) { const k = r.data.legacyFileNumber; if (!legacyCount.has(k)) legacyCount.set(k, []); legacyCount.get(k)!.push(r.rowNumber); }
  const phoneNames = new Map<string, Set<string>>();
  for (const r of rows) if (r.data.phone) { if (!phoneNames.has(r.data.phone)) phoneNames.set(r.data.phone, new Set()); phoneNames.get(r.data.phone)!.add(nrm(r.data.fullName)); }
  const strongSeen = new Map<string, number>();
  for (const r of rows) {
    const d = r.data;
    const warn: string[] = [];
    if (d.phone && (phoneNames.get(d.phone)?.size ?? 0) > 1) warn.push("SHARED_PHONE_NOT_AN_IDENTITY_PROOF");
    const n = nrm(d.fullName);
    const strong = d.phone && d.birthYear ? `${n}|${d.phone}|${d.birthYear}` : null;
    if (strong && strongSeen.has(strong)) { add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "DUPLICATE", reasons: ["SAME_NAME_PHONE_BIRTHYEAR_IN_FILE"], fieldErrors: [], ref: strongSeen.get(strong) }); continue; }
    if (strong) strongSeen.set(strong, r.rowNumber);
    const sameGroup = groupCount.get(`${n}|${d.phone}`) ?? [];
    if (sameGroup.length > 1 && !strong) { add(held(r, key, "SAME_NAME_AND_PHONE_WITH_MISSING_BIRTH_YEAR", "اسم وهاتف متطابقان وسنة التولد ناقصة: أكمل سنة التولد أو أزل التكرار")); continue; }
    if (sameGroup.length > 1 && strong) { const withoutYear = rows.filter((x) => sameGroup.includes(x.rowNumber) && !x.data.birthYear); if (withoutYear.length) { add(held(r, key, "SAME_NAME_AND_PHONE_WITH_MISSING_BIRTH_YEAR", "اسم وهاتف متطابقان وسنة التولد ناقصة في صف آخر: أكمل البيانات")); continue; } }
    if (!d.phone && !d.birthYear && rows.filter((x) => nrm(x.data.fullName) === n && !x.data.phone && !x.data.birthYear).length > 1) { add(held(r, key, "SAME_NAME_WITHOUT_ANY_OTHER_IDENTIFIER", "اسم متكرر بلا هاتف أو سنة تولد: أضف معرّفاً ثانياً")); continue; }
    if (d.legacyFileNumber && (legacyCount.get(d.legacyFileNumber)?.length ?? 0) > 1) { add(held(r, key, "LEGACY_FILE_NUMBER_REPEATED_IN_FILE", "رقم الملف السابق مكرر على أكثر من صف")); continue; }
    // existing records: reliable evidence = name + phone + birth year all equal
    const candidates = existing.filter((e) => nrm(e.fullName) === n && (e.phone ?? "") === (d.phone ?? ""));
    const strongMatch = strong ? candidates.filter((e) => String(e.birthYear ?? "") === d.birthYear) : [];
    if (strongMatch.length === 1) {
      const e = strongMatch[0];
      if (e.branchId !== ctx.branchId) { add(held(r, key, "EXISTING_PATIENT_IN_ANOTHER_BRANCH", "مراجع مطابق مسجل في فرع آخر: لا يُربط تلقائياً", { matchId: e.id })); continue; }
      const differs = (d.motherName && e.motherName && nrm(d.motherName) !== nrm(e.motherName)) || (d.housing && e.housing && nrm(d.housing) !== nrm(e.housing)) || (d.gender && e.gender && d.gender !== e.gender);
      add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: differs ? "UPDATE_CANDIDATE" : "MATCHED", reasons: differs ? ["EXISTING_RECORD_DIFFERS_UPDATES_NOT_APPROVED"] : ["EXISTING_VERIFIED_IDENTITY"], fieldErrors: [], matchId: e.id }); continue;
    }
    if (strongMatch.length > 1 || (candidates.length && !strong)) { add(held(r, key, "AMBIGUOUS_WITH_EXISTING_PATIENT", "يطابق ملفاً قائماً بالاسم والهاتف دون سنة تولد مؤكدة: يلزم قرار", { matchId: candidates[0]?.id })); continue; }
    if (candidates.length && strong) { add(held(r, key, "SAME_NAME_PHONE_DIFFERENT_BIRTH_YEAR_EXISTS", "ملف قائم بنفس الاسم والهاتف وسنة تولد مختلفة: يلزم قرار", { matchId: candidates[0].id })); continue; }
    if (d.legacyFileNumber && existing.some((e) => e.legacyFileNumber === d.legacyFileNumber)) { add(held(r, key, "LEGACY_FILE_NUMBER_ALREADY_USED", "رقم الملف السابق مستخدم لمراجع آخر")); continue; }
    add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "READY", reasons: warn, fieldErrors: [], data: d });
  }
}

async function planPersonnel(db: Db, domain: ImportDomain, rows: Norm[], add: Add, key: (n: number) => string) {
  const category = domain.id === "employees" ? "EMPLOYEE" : domain.id === "residents" ? "RESIDENT" : "SPECIALIST";
  const existing = await db.employee.findMany({ where: { name: { in: rows.map((r) => r.data.fullName) } }, select: { id: true, name: true, job: true, department: true, specialty: true, category: true } });
  const sig = (d: Record<string, string>) => [nrm(d.fullName), nrm(d.job ?? ""), nrm(d.specialty ?? ""), nrm(d.department ?? "")].join("|");
  const byName = new Map<string, Norm[]>();
  for (const r of rows) { const k = nrm(r.data.fullName); if (!byName.has(k)) byName.set(k, []); byName.get(k)!.push(r); }
  const seen = new Map<string, number>();
  for (const r of rows) {
    const group = byName.get(nrm(r.data.fullName))!;
    const distinct = new Set(group.map((g) => sig(g.data)));
    if (group.length > 1 && distinct.size > 1) { add(held(r, key, "SAME_NAME_DIFFERENT_DETAILS", "الاسم متكرر بتفاصيل مختلفة: أكّد هل هما شخص واحد أم اثنان")); continue; }
    const s = sig(r.data);
    if (seen.has(s)) { add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "DUPLICATE", reasons: ["IDENTICAL_ROW_IN_FILE"], fieldErrors: [], ref: seen.get(s) }); continue; }
    seen.set(s, r.rowNumber);
    const same = existing.filter((e) => sig({ fullName: e.name, job: e.job ?? "", specialty: e.specialty ?? "", department: e.department ?? "" }) === s && (e.category ?? category) === category);
    if (same.length === 1) { add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "MATCHED", reasons: ["EXISTING_PERSONNEL_RECORD"], fieldErrors: [], matchId: String(same[0].id) }); continue; }
    const sameName = existing.filter((e) => nrm(e.name) === nrm(r.data.fullName));
    if (sameName.length) { add(held(r, key, "SAME_NAME_EXISTS_WITH_DIFFERENT_DETAILS", "سجل بنفس الاسم وتفاصيل مختلفة موجود: يلزم قرار", { matchId: String(sameName[0].id) })); continue; }
    add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "READY", reasons: ["PERSONNEL_RECORD_ONLY_NO_LOGIN"], fieldErrors: [], data: { ...r.data, category } });
  }
}

async function planAccounts(db: Db, rows: Norm[], ctx: PlanContext, add: Add, key: (n: number) => string) {
  const existing = await db.user.findMany({ where: { username: { in: rows.map((r) => r.data.username) } }, select: { id: true, username: true, fullName: true } });
  const byUser = new Map<string, Norm[]>();
  for (const r of rows) { if (!byUser.has(r.data.username)) byUser.set(r.data.username, []); byUser.get(r.data.username)!.push(r); }
  const byName = new Map<string, Norm[]>();
  for (const r of rows) { const k = nrm(r.data.fullName); if (!byName.has(k)) byName.set(k, []); byName.get(k)!.push(r); }
  for (const r of rows) {
    const d = r.data;
    if ((PRIVILEGED_ROLES as readonly string[]).includes(d.role)) { add(held(r, key, "PRIVILEGED_ROLE_NEEDS_SEPARATE_APPROVAL", "حساب بصلاحيات إدارية: لا يُنشأ بالاستيراد؛ يلزم اعتماد منفصل")); continue; }
    const sameUser = byUser.get(d.username)!;
    if (sameUser.length > 1) {
      if (sameUser[0] !== r) { add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "DUPLICATE", reasons: ["USERNAME_REPEATED_IN_FILE"], fieldErrors: [], ref: sameUser[0].rowNumber }); continue; }
    }
    if ((byName.get(nrm(d.fullName))?.length ?? 0) > 1 && new Set(byName.get(nrm(d.fullName))!.map((x) => x.data.username)).size > 1) { add(held(r, key, "MULTIPLE_ACCOUNTS_FOR_SAME_NAME", "عدة حسابات لاسم واحد: أكّد أنها لأشخاص مختلفين أو أبقِ حساباً واحداً")); continue; }
    const ex = existing.find((e) => e.username === d.username);
    if (ex) { add(nrm(ex.fullName) === nrm(d.fullName) ? { rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "MATCHED", reasons: ["EXISTING_ACCOUNT"], fieldErrors: [], matchId: ex.id } : held(r, key, "USERNAME_TAKEN_BY_ANOTHER_PERSON", "اسم المستخدم مستخدم لشخص آخر", { matchId: ex.id })); continue; }
    add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "READY", reasons: ["STAGED_INACTIVE_NO_PASSWORD"], fieldErrors: [], data: d });
  }
}

async function planMemberships(db: Db, rows: Norm[], ctx: PlanContext, add: Add, key: (n: number) => string) {
  const users = await db.user.findMany({ where: { username: { in: rows.map((r) => r.data.username) } }, select: { id: true, username: true, role: true, branchId: true } });
  const centers = await db.center.findMany({ select: { id: true, name: true, active: true } });
  const seen = new Map<string, number>();
  for (const r of rows) {
    const d = r.data;
    const u = users.find((x) => x.username === d.username);
    if (!u) { add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "INVALID", reasons: ["USER_NOT_FOUND"], fieldErrors: [{ field: "username", code: "USER_NOT_FOUND", message: "الحساب غير موجود: استورد الحساب أولاً" }] }); continue; }
    if (u.branchId !== ctx.branchId) { add(held(r, key, "USER_IN_ANOTHER_BRANCH", "الحساب ليس في فرع العملية")); continue; }
    const c = centers.find((x) => nrm(x.name) === nrm(d.centerName));
    if (!c || !c.active) { add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "INVALID", reasons: ["CENTER_NOT_FOUND"], fieldErrors: [{ field: "centerName", code: "CENTER_NOT_FOUND", message: "المركز غير موجود أو غير فعّال بهذا الاسم" }] }); continue; }
    const centerRole = centerRoleForUserRole(u.role);
    if (!centerRole) { add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "INVALID", reasons: ["ROLE_HAS_NO_CENTER_ROLE"], fieldErrors: [{ field: "username", code: "ROLE_HAS_NO_CENTER_ROLE", message: "دور هذا الحساب لا يملك صفة داخل المراكز" }] }); continue; }
    const k = `${c.id}|${u.id}|${centerRole}`;
    if (seen.has(k)) { add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "DUPLICATE", reasons: ["MEMBERSHIP_REPEATED_IN_FILE"], fieldErrors: [], ref: seen.get(k) }); continue; }
    seen.set(k, r.rowNumber);
    const ex = await db.centerMembership.findUnique({ where: { centerId_userId_role: { centerId: c.id, userId: u.id, role: centerRole } } });
    if (ex) { add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "MATCHED", reasons: ["EXISTING_MEMBERSHIP"], fieldErrors: [], matchId: ex.id }); continue; }
    add({ rowNumber: r.rowNumber, sourceKey: key(r.rowNumber), disposition: "READY", reasons: [], fieldErrors: [], data: { ...d, centerId: String(c.id), userId: u.id, centerRole } });
  }
}
