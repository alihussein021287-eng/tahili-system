import crypto from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { centerRoleForUserRole } from "@/lib/center-membership";
import { IMPORT_DOMAIN_BY_ID, PRIVILEGED_ROLES, STAFF_ROW_BASE, type TemplateSheet } from "./registry";
import { loadReferences } from "./reference";
import { environmentFingerprint, FINGERPRINT_LABEL } from "./environment";
import { FILE_LIMITS, UploadRejected, type Workbook } from "./spreadsheet";
import { buildPlan, clean, nrm, privilegedRole, validateField, type FieldError, type Plan, type PlanContext, type RowResult } from "./plan";
import { sheetLib } from "./spreadsheet";

type Db = PrismaClient | Prisma.TransactionClient;
type SheetId = "personnel" | "accounts" | "memberships";
type Parsed = { sheet: SheetId; line: number; data: Record<string, string>; errors: FieldError[]; kind: "ok" | "blank" | "formula"; formulaCol?: string };
type Person = { key: string; rowNumber: number; status: "READY" | "MATCHED" | "BLOCKED"; category: string; name: string; job: string; specialty: string; department: string; phone: string; employeeId?: number; userId?: string | null };

const KEY_RE = /^[A-Za-z0-9._-]{1,40}$/;
const rowNo = (sheet: SheetId, line: number) => STAFF_ROW_BASE[sheet] + line;
const REQUIRED_ROLE: Record<string, string> = { RESIDENT: "RESIDENT", SPECIALIST: "DOCTOR" };

/** Dispatcher: the unified staff file has its own coordinated planner; every other domain keeps the existing single-sheet planner. */
export async function buildImportPlan(db: Db, domainId: string, wb: Workbook, ctx: PlanContext): Promise<Plan> {
  return domainId === "staff" ? buildStaffPlan(db, wb, ctx) : buildPlan(db, domainId, wb, ctx);
}

function readSheet(wb: Workbook, sh: TemplateSheet, required: boolean, unmapped: string[]): Parsed[] {
  const ws = wb.sheets.find((s) => nrm(s.name) === nrm(sh.name));
  if (!ws) {
    if (required) throw new UploadRejected("MISSING_SHEETS", `الورقة «${sh.name}» غير موجودة في الملف: استعمل القالب الموحّد الرسمي`);
    return [];
  }
  const headerIdx = ws.rows.findIndex((r) => r.some((c) => clean(c)));
  if (headerIdx < 0) { if (required) throw new UploadRejected("EMPTY_SHEET", `الورقة «${sh.name}» فارغة`); return []; }
  const index: Record<string, number> = {};
  ws.rows[headerIdx].map(String).forEach((h, i) => {
    const n = nrm(h);
    if (!n) return;
    const f = sh.fields.find((x) => [x.id, x.label, ...(x.aliases ?? [])].some((a) => nrm(a) === n));
    if (f && index[f.id] === undefined) index[f.id] = i; else unmapped.push(`${sh.name}: ${clean(h).slice(0, 40)}`);
  });
  const missing = sh.fields.filter((f) => f.required && index[f.id] === undefined);
  if (missing.length) throw new UploadRejected("MISSING_COLUMNS", `أعمدة مطلوبة غير موجودة في ورقة «${sh.name}»: ${missing.map((m) => `${m.label} (${m.id})`).join("، ")}. نزّل القالب الموحّد الرسمي.`);
  const labels = new Set(sh.fields.map((f) => nrm(f.label)));
  const formula = new Set((ws.formulaCells ?? []).map(([r, c]) => `${r}:${c}`));
  const out: Parsed[] = [];
  for (let i = headerIdx + 1; i < ws.rows.length; i++) {
    const cells = ws.rows[i] ?? [];
    const nonEmpty = cells.filter((c) => clean(c));
    if (nonEmpty.length && nonEmpty.every((c) => labels.has(nrm(c)))) continue; // the template's Arabic label row
    const line = i + 1;
    if (!nonEmpty.length) { out.push({ sheet: sh.id, line, data: {}, errors: [], kind: "blank" }); continue; }
    let formulaCol: string | undefined;
    const raw: Record<string, string> = {};
    for (const f of sh.fields) {
      const col = index[f.id];
      raw[f.id] = col === undefined ? "" : String(cells[col] ?? "");
      if (col !== undefined && formula.has(`${i}:${col}`)) formulaCol = f.id;
    }
    if (formulaCol) { out.push({ sheet: sh.id, line, data: {}, errors: [], kind: "formula", formulaCol }); continue; }
    out.push({ sheet: sh.id, line, data: raw, errors: [], kind: "ok" });
  }
  return out;
}

/** The coordinated plan of ONE unified staff file (personnel + requested accounts + requested memberships): every row of every sheet gets an explicit disposition. Reads, never writes. */
export async function buildStaffPlan(db: Db, wb: Workbook, ctx: PlanContext): Promise<Plan> {
  const domain = IMPORT_DOMAIN_BY_ID.staff;
  const sheets = domain.sheets!;
  const sh = Object.fromEntries(sheets.map((s) => [s.id, s])) as Record<SheetId, TemplateSheet>;
  // The file must come from THIS environment's template: QA reference values (centers, lists) must never reach another database.
  const [{ n: databaseName }] = await (db as PrismaClient).$queryRaw<{ n: string }[]>`select current_database() as n`;
  const help = wb.sheets.find((s) => nrm(s.name) === nrm("تعليمات"));
  const stamp = help?.rows.flat().map((c) => clean(c)).find((c) => c.startsWith(FINGERPRINT_LABEL));
  if (!stamp) throw new UploadRejected("TEMPLATE_STAMP_MISSING", "الملف ليس من القالب الموحّد الرسمي الحالي (لا بصمة بيئة): نزّل القالب من هذه البيئة بنفس الصفحة");
  if (stamp.replace(`${FINGERPRINT_LABEL}:`, "").trim() !== environmentFingerprint(databaseName)) throw new UploadRejected("TEMPLATE_ENVIRONMENT_MISMATCH", "القالب نُزّل من بيئة أخرى (قوائمه ومراكزه لا تخص هذه البيئة): نزّل القالب الموحّد من هذه البيئة ثم عبّئه");
  const refs = await loadReferences(db);
  const fileKey = ctx.fileSha256.slice(0, 12);
  const unmapped: string[] = [];
  const parsed: Record<SheetId, Parsed[]> = {
    personnel: readSheet(wb, sh.personnel, true, unmapped),
    accounts: readSheet(wb, sh.accounts, false, unmapped),
    memberships: readSheet(wb, sh.memberships, false, unmapped),
  };
  if (parsed.personnel.length + parsed.accounts.length + parsed.memberships.length > FILE_LIMITS.maxRows) throw new UploadRejected("TOO_MANY_ROWS", `عدد الصفوف يتجاوز الحد المسموح (${FILE_LIMITS.maxRows})`);

  const rows: RowResult[] = [];
  const mk = (p: { sheet: SheetId; line: number }, disposition: RowResult["disposition"], reasons: string[], fieldErrors: FieldError[] = [], extra: Partial<RowResult> = {}): RowResult =>
    ({ rowNumber: rowNo(p.sheet, p.line), sourceKey: `${fileKey}:${p.sheet}:${p.line}`, disposition, reasons, fieldErrors, ...extra });
  const held = (p: { sheet: SheetId; line: number }, reason: string, need: string, extra: Partial<RowResult> = {}) => mk(p, "HELD", [reason], [{ field: "*", code: reason, message: need }], extra);
  const invalid = (p: { sheet: SheetId; line: number }, field: string, code: string, message: string) => mk(p, "INVALID", [code], [{ field, code, message }]);

  // field validation of every row (shared validators), blank/formula rows settled immediately
  const valid: Record<SheetId, Parsed[]> = { personnel: [], accounts: [], memberships: [] };
  for (const sheet of ["personnel", "accounts", "memberships"] as SheetId[]) {
    for (const p of parsed[sheet]) {
      if (p.kind === "blank") { rows.push(mk(p, "EXCLUDED", ["BLANK_ROW"])); continue; }
      if (p.kind === "formula") { rows.push(mk(p, "INVALID", ["FORMULA_NOT_ALLOWED"], [{ field: p.formulaCol!, code: "FORMULA_NOT_ALLOWED", message: "الصيغ (formulas) غير مسموحة؛ أدخل القيمة نفسها" }])); continue; }
      const data: Record<string, string> = {};
      const errors: FieldError[] = [];
      for (const f of sh[sheet].fields) {
        const raw = p.data[f.id];
        if (sheet === "accounts" && f.id === "role" && privilegedRole(raw)) { data[f.id] = privilegedRole(raw)!; continue; }
        const r = validateField(f, raw, refs);
        data[f.id] = r.value;
        if (r.error) errors.push(r.error);
      }
      if (data.personKey && !KEY_RE.test(clean(raw(p, "personKey")))) errors.push({ field: "personKey", code: "INVALID_PERSON_KEY", message: "رمز الشخص: حروف وأرقام إنجليزية فقط (. _ - مسموحة) حتى 40 حرفاً" });
      if (sheet === "personnel" && data.fullName && nrm(data.fullName).replace(/\s/g, "").length < 3) errors.push({ field: "fullName", code: "NAME_TOO_SHORT", message: "الاسم 3 أحرف على الأقل" });
      if (sheet === "personnel" && !errors.length) {
        if (data.category === "RESIDENT" && !data.job) errors.push({ field: "job", code: "REQUIRED", message: "الوظيفة / العنوان الوظيفي مطلوب للطبيب المقيم" });
        if (data.category === "SPECIALIST" && !data.specialty) errors.push({ field: "specialty", code: "REQUIRED", message: "الاختصاص مطلوب لطبيب الاختصاص" });
      }
      p.data = data; p.errors = errors;
      if (errors.length) rows.push(mk(p, "INVALID", errors.map((e) => e.code), errors)); else valid[sheet].push(p);
    }
  }
  function raw(p: Parsed, id: string) { return p.data[id] ?? ""; }

  const pk = (p: Parsed) => p.data.personKey.toLowerCase();
  const sig = (d: { job?: string | null; specialty?: string | null; department?: string | null }) => [nrm(d.job ?? ""), nrm(d.specialty ?? ""), nrm(d.department ?? "")].join("|");
  const persons = new Map<string, Person>();
  const blockedKeys = new Set<string>(); // keys present in the file whose personnel row is not importable

  // ---- personnel: key and identity ambiguity first ----
  const byKey = new Map<string, Parsed[]>();
  for (const p of valid.personnel) { const k = pk(p); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(p); }
  const candidates: Parsed[] = [];
  for (const [k, group] of byKey) {
    if (group.length > 1) {
      const same = group.every((g) => `${nrm(g.data.fullName)}|${g.data.category}|${sig(g.data)}` === `${nrm(group[0].data.fullName)}|${group[0].data.category}|${sig(group[0].data)}`);
      if (!same) { for (const g of group) rows.push(held(g, "PERSON_KEY_REPEATED_WITH_DIFFERENT_DETAILS", "رمز الشخص مكرر لتفاصيل مختلفة: اجعل لكل شخص رمزاً واحداً")); blockedKeys.add(k); continue; }
      group.slice(1).forEach((g) => rows.push(mk(g, "DUPLICATE", ["IDENTICAL_PERSON_ROW_IN_FILE"], [], { ref: rowNo("personnel", group[0].line) })));
    }
    candidates.push(group[0]);
  }
  const byIdentity = new Map<string, Parsed[]>();
  for (const p of candidates) { const k = `${nrm(p.data.fullName)}|${p.data.category}`; if (!byIdentity.has(k)) byIdentity.set(k, []); byIdentity.get(k)!.push(p); }
  const unique: Parsed[] = [];
  for (const group of byIdentity.values()) {
    if (group.length > 1) { for (const g of group) { rows.push(held(g, "SAME_PERSON_UNDER_DIFFERENT_KEYS", "الاسم والفئة نفسهما تحت أكثر من رمز: أكّد هل هما شخص واحد أم اثنان")); blockedKeys.add(pk(g)); } continue; }
    unique.push(group[0]);
  }

  // ---- personnel: existing records of the same branch (trustworthy evidence only, never overwritten) ----
  const existing = unique.length ? await db.employee.findMany({ where: { name: { in: unique.map((p) => p.data.fullName) }, OR: [{ branchId: ctx.branchId }, { branchId: null }] }, select: { id: true, name: true, job: true, specialty: true, department: true, category: true, branchId: true, userId: true, user: { select: { username: true } } } }) : [];
  const existingUserName = new Map<number, string | null>(existing.map((e) => [e.id, e.user?.username ?? null]));
  for (const p of unique) {
    const d = p.data;
    const sameName = existing.filter((e) => nrm(e.name) === nrm(d.fullName));
    const base: Person = { key: pk(p), rowNumber: rowNo("personnel", p.line), status: "READY", category: d.category, name: d.fullName, job: d.job, specialty: d.specialty, department: d.department, phone: d.phone };
    if (!sameName.length) { persons.set(base.key, base); rows.push(mk(p, "READY", ["PERSONNEL_RECORD_NO_LOGIN_UNTIL_ACTIVATED"], [], { data: { kind: "personnel", ...d } })); continue; }
    const exact = sameName.filter((e) => e.branchId === ctx.branchId && e.category === d.category && sig(e) === sig(d));
    if (exact.length === 1) {
      const e = exact[0];
      persons.set(base.key, { ...base, status: "MATCHED", employeeId: e.id, userId: e.userId });
      rows.push(mk(p, "MATCHED", ["EXISTING_PERSONNEL_RECORD"], [], { matchId: String(e.id) }));
      continue;
    }
    blockedKeys.add(base.key);
    rows.push(held(p, sameName.some((e) => e.branchId == null) ? "EXISTING_UNASSIGNED_RECORD_WITH_SAME_NAME" : "SAME_NAME_EXISTS_WITH_DIFFERENT_DETAILS", "سجل بنفس الاسم موجود بتفاصيل مختلفة أو بلا فرع: يلزم قرار المالك ولا يُحدَّث تلقائياً", { matchId: String(sameName[0].id) }));
  }
  void existingUserName;
  const personOf = (p: Parsed) => persons.get(pk(p));

  // ---- accounts ----
  const dbUsers = valid.accounts.length ? await db.user.findMany({ where: { OR: [{ username: { in: valid.accounts.map((a) => a.data.username) } }, { branchId: ctx.branchId }] }, select: { id: true, username: true, fullName: true, role: true, branchId: true } }) : [];
  const acctByKey = new Map<string, Parsed[]>();
  const acctByUser = new Map<string, Parsed[]>();
  for (const a of valid.accounts) {
    const k = pk(a); if (!acctByKey.has(k)) acctByKey.set(k, []); acctByKey.get(k)!.push(a);
    if (a.data.username) { if (!acctByUser.has(a.data.username)) acctByUser.set(a.data.username, []); acctByUser.get(a.data.username)!.push(a); }
  }
  type Acct = { rowNumber: number; role: string; userId?: string; status: "READY" | "MATCHED" };
  const accounts = new Map<string, Acct>();
  for (const a of valid.accounts) {
    const d = a.data;
    const person = personOf(a);
    if (!person) {
      if (blockedKeys.has(pk(a))) { rows.push(held(a, "PERSON_NOT_IMPORTABLE", "شخص هذا الحساب محجوز أو غير صالح في ورقة الأشخاص: عالجه أولاً")); continue; }
      const inFile = [...byKey.keys()].includes(pk(a)) || parsed.personnel.some((x) => x.kind === "ok" && x.data.personKey && x.data.personKey.toLowerCase() === pk(a));
      rows.push(inFile ? held(a, "PERSON_NOT_IMPORTABLE", "شخص هذا الحساب غير صالح في ورقة الأشخاص: صحّحه أولاً") : invalid(a, "personKey", "PERSON_KEY_NOT_FOUND", "رمز الشخص غير موجود في ورقة الأشخاص"));
      continue;
    }
    if ((PRIVILEGED_ROLES as readonly string[]).includes(d.role)) { rows.push(held(a, "PRIVILEGED_ROLE_NEEDS_SEPARATE_APPROVAL", "حساب بصلاحيات إدارية: لا يُنشأ بالاستيراد؛ يلزم اعتماد منفصل")); continue; }
    const required = REQUIRED_ROLE[person.category];
    const role = d.role || required || "";
    if (required && d.role && d.role !== required) { rows.push(invalid(a, "role", "ROLE_CONFLICTS_WITH_CATEGORY", `هذه الفئة تقتضي الدور ${required} (قرار المالك)`)); continue; }
    if (!role) { rows.push(invalid(a, "role", "REQUIRED", "الدور المطلوب إلزامي لحسابات الموظفين")); continue; }
    if (!required && d.roleVerified !== "1") { rows.push(held(a, "ROLE_NOT_VERIFIED", "دور الموظف لم يُتحقق منه: اكتب «نعم» في عمود التحقق بعد مراجعة الوظيفة والقسم الفعليين")); continue; }
    const sameKey = acctByKey.get(pk(a))!;
    if (sameKey.length > 1) {
      if (sameKey.some((x) => x.data.username !== d.username)) { rows.push(held(a, "ACCOUNT_REQUESTED_TWICE_FOR_PERSON", "أكثر من حساب مطلوب للشخص نفسه: أبقِ حساباً واحداً")); continue; }
      if (sameKey[0] !== a) { rows.push(mk(a, "DUPLICATE", ["IDENTICAL_ACCOUNT_ROW_IN_FILE"], [], { ref: rowNo("accounts", sameKey[0].line) })); continue; }
    }
    const sameUser = acctByUser.get(d.username)!;
    if (new Set(sameUser.map((x) => pk(x))).size > 1) { rows.push(held(a, "USERNAME_REPEATED_ACROSS_PERSONS", "اسم المستخدم نفسه مطلوب لأكثر من شخص")); continue; }
    if (person.status === "MATCHED" && person.userId) {
      const linked = dbUsers.find((u) => u.id === person.userId);
      rows.push(linked && linked.username === d.username
        ? mk(a, "MATCHED", ["EXISTING_ACCOUNT_LINKED_TO_PERSON"], [], { matchId: linked.id })
        : held(a, "EMPLOYEE_ALREADY_HAS_ACCOUNT", "هذا الشخص مرتبط بحساب آخر: لا يُنشأ حساب ثانٍ"));
      if (linked && linked.username === d.username) accounts.set(pk(a), { rowNumber: rowNo("accounts", a.line), role: linked.role, userId: linked.id, status: "MATCHED" });
      continue;
    }
    if (dbUsers.some((u) => u.username === d.username)) { rows.push(held(a, "USERNAME_TAKEN", "اسم المستخدم مستخدم لحساب قائم: لا يُدمج تلقائياً")); continue; }
    if (dbUsers.some((u) => u.branchId === ctx.branchId && nrm(u.fullName) === nrm(person.name))) { rows.push(held(a, "POSSIBLE_DUPLICATE_ACCOUNT", "يوجد حساب بالاسم نفسه في الفرع: اربطه من ملف الموظف بدل إنشاء حساب مكرر")); continue; }
    accounts.set(pk(a), { rowNumber: rowNo("accounts", a.line), role, status: "READY" });
    rows.push(mk(a, "READY", ["STAGED_INACTIVE_NO_PASSWORD"], [], { data: { kind: "accounts", personKey: d.personKey, username: d.username, role, email: d.email, fullName: person.name, jobTitle: person.job, department: person.department, phone: person.phone, ...(person.employeeId ? { employeeId: String(person.employeeId) } : {}) } }));
  }

  // ---- memberships ----
  const centers = await db.center.findMany({ select: { id: true, name: true, active: true } });
  const seenMembership = new Map<string, number>();
  const membershipForKey = new Set<string>();
  for (const m of valid.memberships) {
    const d = m.data;
    const person = personOf(m);
    if (!person) {
      rows.push(blockedKeys.has(pk(m)) || parsed.personnel.some((x) => x.kind === "ok" && (x.data.personKey ?? "").toLowerCase() === pk(m))
        ? held(m, "PERSON_NOT_IMPORTABLE", "شخص هذه العضوية محجوز أو غير صالح في ورقة الأشخاص: عالجه أولاً")
        : invalid(m, "personKey", "PERSON_KEY_NOT_FOUND", "رمز الشخص غير موجود في ورقة الأشخاص"));
      continue;
    }
    const acct = accounts.get(pk(m));
    let role = acct?.role;
    let userId = acct?.userId;
    if (!acct) {
      const linked = person.userId ? dbUsers.find((u) => u.id === person.userId && u.branchId === ctx.branchId) : undefined;
      if (!linked) { rows.push(held(m, "NO_ACCOUNT_FOR_PERSON", "لا يوجد حساب مطلوب أو قائم لهذا الشخص: أضف صفه في ورقة الحسابات أولاً")); continue; }
      role = linked.role; userId = linked.id;
    }
    const centerRole = centerRoleForUserRole(role as never);
    if (!centerRole) { rows.push(invalid(m, "personKey", "ROLE_HAS_NO_CENTER_ROLE", "دور هذا الحساب لا يملك صفة داخل المراكز")); continue; }
    const center = centers.find((c) => c.active && nrm(c.name) === nrm(d.centerName));
    if (!center) { rows.push(invalid(m, "centerName", "CENTER_NOT_FOUND", "المركز غير موجود أو غير فعّال")); continue; }
    const mkKey = `${pk(m)}|${center.id}`;
    if (seenMembership.has(mkKey)) { rows.push(mk(m, "DUPLICATE", ["MEMBERSHIP_REPEATED_IN_FILE"], [], { ref: seenMembership.get(mkKey) })); continue; }
    seenMembership.set(mkKey, rowNo("memberships", m.line));
    if (userId) {
      const ex = await db.centerMembership.findUnique({ where: { centerId_userId_role: { centerId: center.id, userId, role: centerRole } } });
      if (ex) { rows.push(mk(m, "MATCHED", ["EXISTING_MEMBERSHIP"], [], { matchId: ex.id })); continue; }
    }
    membershipForKey.add(pk(m));
    rows.push(mk(m, "READY", [], [], { data: { kind: "memberships", personKey: d.personKey, centerId: String(center.id), centerRole, specialty: d.specialty, startDate: d.startDate, ...(userId ? { userId } : {}) } }));
  }
  // an account without a requested membership is allowed but flagged: it will reach no center until a verified membership is added
  for (const r of rows) {
    if (r.disposition !== "READY" || r.data?.kind !== "accounts") continue;
    if (centerRoleForUserRole(r.data.role as never) && !membershipForKey.has(r.data.personKey.toLowerCase())) r.reasons.push("NO_CENTER_MEMBERSHIP_REQUESTED");
  }

  rows.sort((a, b) => a.rowNumber - b.rowNumber);
  const counts: Record<string, number> = { total: rows.length, ready: 0, matched: 0, duplicate: 0, held: 0, invalid: 0, excluded: 0, updateCandidates: 0 };
  for (const r of rows) {
    if (r.disposition === "READY") counts.ready++; else if (r.disposition === "MATCHED") counts.matched++; else if (r.disposition === "DUPLICATE") counts.duplicate++;
    else if (r.disposition === "HELD") counts.held++; else if (r.disposition === "INVALID") counts.invalid++; else if (r.disposition === "EXCLUDED") counts.excluded++; else counts.updateCandidates++;
  }
  const by = (s: SheetId) => rows.filter((r) => r.disposition === "READY" && r.data?.kind === (s === "personnel" ? "personnel" : s)).length;
  counts.readyPersonnel = by("personnel"); counts.readyAccounts = by("accounts"); counts.readyMemberships = by("memberships");
  const planSha256 = crypto.createHash("sha256").update(JSON.stringify({ d: "staff", b: ctx.branchId, f: ctx.fileSha256, r: rows.map((r) => [r.rowNumber, r.disposition, r.matchId ?? null, r.disposition === "READY" ? r.data : null]) })).digest("hex");
  void sheetLib;
  return { domain: "staff", branchId: ctx.branchId, fileSha256: ctx.fileSha256, sheet: sheets.map((s) => s.name).join(" + "), rows, unmappedHeaders: unmapped, counts, planSha256 };
}
