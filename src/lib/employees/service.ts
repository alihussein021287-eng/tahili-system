import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { centerRoleForUserRole } from "@/lib/center-membership";
import { sheetLib } from "@/lib/data-center/spreadsheet";

type Db = PrismaClient;
export type EmployeeActor = { userId: string; role: string; permissions: ReadonlySet<string>; branchId: number | null };

export class EmployeeDenied extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const EMPLOYEE_CATEGORIES = { RESIDENT: "طبيب مقيم / تدرج", SPECIALIST: "طبيب اختصاص", EMPLOYEE: "موظف" } as const;
export type EmployeeCategory = keyof typeof EMPLOYEE_CATEGORIES;
export const PAGE_SIZE = 25;

/** Roles that may be staged by the personnel flow. ADMIN/MANAGER always need a separate approval path (Users page). */
export const STAGEABLE_ROLES: UserRole[] = ["DOCTOR", "RESIDENT", "THERAPIST", "HEAD_THERAPIST", "PHARMACIST", "RECEPTION", "SECRETARY", "DATA_ENTRY", "ACCOUNTANT", "LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS", "VIEWER"];

const USERNAME = /^[a-z0-9._-]{3,40}$/;
const isAdmin = (a: EmployeeActor) => a.role === "ADMIN";
const normName = (s: unknown) => sheetLib().normName(s);

async function deny(db: Db, a: EmployeeActor, code: string, message: string, recordId = "employee"): Promise<never> {
  await db.auditLog.create({ data: { userId: a.userId, action: "DENIED", tableName: "Employee", recordId: String(recordId), newValue: { code } } }).catch(() => undefined);
  throw new EmployeeDenied(code, message);
}

/** Personnel scope: ADMIN sees everything (including records not yet assigned to a branch); everyone else only their own branch. */
export function employeeScopeWhere(a: EmployeeActor): Prisma.EmployeeWhereInput {
  if (isAdmin(a)) return {};
  return a.branchId == null ? { id: -1 } : { branchId: a.branchId };
}

export function canViewEmployees(a: EmployeeActor) { return a.permissions.has("employees.view"); }
export function canEditEmployees(a: EmployeeActor) { return a.permissions.has("employees.edit"); }
/** Account staging/linking/activation stays an ADMIN-only contract (same as the Users page). */
export function canManageAccounts(a: EmployeeActor) { return isAdmin(a) && a.permissions.has("users.manage"); }

/** Attendance obligation: explicit flag wins; otherwise only legacy roster rows (no import category) are expected to attend. */
export function attendanceRequired(e: { attendanceRequired: boolean | null; category: string | null }) {
  return e.attendanceRequired ?? e.category == null;
}

export type EmployeeFilters = { q?: string; category?: string; branchId?: number | null; department?: string; centerId?: number | null; link?: "linked" | "unlinked" | ""; page?: number };

function filterWhere(a: EmployeeActor, f: EmployeeFilters): Prisma.EmployeeWhereInput {
  const and: Prisma.EmployeeWhereInput[] = [employeeScopeWhere(a)];
  const q = (f.q ?? "").trim();
  if (q) and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { job: { contains: q, mode: "insensitive" } }, { department: { contains: q, mode: "insensitive" } }, { specialty: { contains: q, mode: "insensitive" } }] });
  if (f.category === "NONE") and.push({ category: null });
  else if (f.category && f.category in EMPLOYEE_CATEGORIES) and.push({ category: f.category });
  if (f.branchId != null && isAdmin(a)) and.push({ branchId: f.branchId });
  if (f.department) and.push({ department: f.department });
  if (f.link === "linked") and.push({ userId: { not: null } });
  if (f.link === "unlinked") and.push({ userId: null });
  if (f.centerId != null) and.push({ user: { centerMemberships: { some: { centerId: f.centerId, status: "ACTIVE" } } } });
  return { AND: and };
}

export async function listEmployees(db: Db, a: EmployeeActor, f: EmployeeFilters) {
  if (!canViewEmployees(a)) return deny(db, a, "NO_PERMISSION", "ليست لديك صلاحية عرض سجلات الموظفين");
  const where = filterWhere(a, f);
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.employee.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { branch: { select: { name: true } }, user: { select: { username: true, role: true, isActive: true, needsActivation: true } } } }),
    db.employee.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

const CENTER_ROLES: UserRole[] = ["MANAGER", "HEAD_THERAPIST", "THERAPIST", "SECRETARY", "RESIDENT", "DOCTOR", "DRESSING", "PROSTHETICS"];
const INCOMPLETE: Prisma.EmployeeWhereInput = { OR: [{ job: null }, { department: null }, { phone: null }, { branchId: null }, { category: "SPECIALIST", specialty: null }] };

/** Counts that keep personnel records and user accounts clearly separate. Each person is counted once (one Employee row, one User row), never once per permission.
 * Accounts are scoped like the Users page: all for ADMIN, own branch otherwise. */
export async function staffCounts(db: Db, a: EmployeeActor) {
  const scope = employeeScopeWhere(a);
  const userScope: Prisma.UserWhereInput = isAdmin(a) ? {} : a.branchId == null ? { id: "-" } : { branchId: a.branchId };
  const [personnel, residents, specialists, others, unlinked, linked, accounts, activeAccounts, inactiveAccounts, needsCompletion, needsAccount, needsMembership, byRole, byJob] = await Promise.all([
    db.employee.count({ where: scope }),
    db.employee.count({ where: { AND: [scope, { category: "RESIDENT" }] } }),
    db.employee.count({ where: { AND: [scope, { category: "SPECIALIST" }] } }),
    db.employee.count({ where: { AND: [scope, { OR: [{ category: null }, { category: "EMPLOYEE" }] }] } }),
    db.employee.count({ where: { AND: [scope, { userId: null }] } }),
    db.employee.count({ where: { AND: [scope, { userId: { not: null } }] } }),
    db.user.count({ where: userScope }),
    db.user.count({ where: { AND: [userScope, { isActive: true }] } }),
    db.user.count({ where: { AND: [userScope, { isActive: false }] } }),
    db.employee.count({ where: { AND: [scope, INCOMPLETE] } }),
    db.employee.count({ where: { AND: [scope, { userId: null, category: { in: ["RESIDENT", "SPECIALIST"] } }] } }),
    db.employee.count({ where: { AND: [scope, { user: { role: { in: CENTER_ROLES }, centerMemberships: { none: { status: "ACTIVE" } } } }] } }),
    db.user.groupBy({ by: ["role"], where: userScope, _count: { _all: true } }),
    db.employee.groupBy({ by: ["job"], where: { AND: [scope, { OR: [{ category: null }, { category: "EMPLOYEE" }] }] }, _count: { _all: true }, orderBy: { _count: { job: "desc" } }, take: 12 }),
  ]);
  return {
    personnel, residents, specialists, others, unlinked, linked, accounts, activeAccounts, inactiveAccounts, needsCompletion, needsAccount, needsMembership,
    accountsByRole: byRole.map((r) => ({ role: r.role as string, count: r._count._all })),
    othersByJob: byJob.map((r) => ({ job: r.job, count: r._count._all })),
  };
}

export async function getEmployee(db: Db, a: EmployeeActor, id: number) {
  if (!canViewEmployees(a)) return deny(db, a, "NO_PERMISSION", "ليست لديك صلاحية عرض سجلات الموظفين", String(id));
  return db.employee.findFirst({
    where: { AND: [{ id }, employeeScopeWhere(a)] },
    include: { branch: { select: { id: true, name: true } }, user: { select: { id: true, username: true, fullName: true, role: true, isActive: true, needsActivation: true, branchId: true, centerMemberships: { where: { status: "ACTIVE" }, select: { id: true, role: true, center: { select: { id: true, name: true } } } } } } },
  });
}

export const MISSING_LABELS: Record<string, string> = { job: "الوظيفة", department: "القسم", specialty: "الاختصاص", phone: "الهاتف", branch: "الفرع" };
export function missingFields(e: { job: string | null; department: string | null; specialty: string | null; phone: string | null; branchId: number | null; category: string | null }) {
  const out: string[] = [];
  if (!e.job) out.push("job");
  if (!e.department) out.push("department");
  if (e.category === "SPECIALIST" && !e.specialty) out.push("specialty");
  if (!e.phone) out.push("phone");
  if (e.branchId == null) out.push("branch");
  return out;
}

const clean = (v: unknown, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export type EmployeePatch = { name?: string; job?: string; department?: string; specialty?: string; capacity?: string; phone?: string; notes?: string; category?: string; attendanceRequired?: "" | "yes" | "no"; branchId?: number | null };

export async function updateEmployee(db: Db, a: EmployeeActor, id: number, patch: EmployeePatch) {
  if (!canEditEmployees(a)) return deny(db, a, "NO_PERMISSION", "ليست لديك صلاحية تعديل سجلات الموظفين", String(id));
  const current = await db.employee.findFirst({ where: { AND: [{ id }, employeeScopeWhere(a)] } });
  if (!current) return deny(db, a, "NOT_FOUND", "السجل غير موجود في نطاقك", String(id));
  const data: Prisma.EmployeeUpdateInput = {};
  const changed: string[] = [];
  const set = (field: string, value: unknown, prev: unknown) => { if (value !== prev) { (data as Record<string, unknown>)[field] = value; changed.push(field); } };
  if (patch.name !== undefined) {
    const name = clean(patch.name, 120);
    if (name.length < 3) throw new EmployeeDenied("NAME_REQUIRED", "الاسم مطلوب (3 أحرف على الأقل)");
    set("name", name, current.name);
  }
  for (const f of ["job", "department", "specialty", "capacity"] as const) if (patch[f] !== undefined) set(f, clean(patch[f]) || null, current[f]);
  if (patch.notes !== undefined) set("notes", clean(patch.notes, 1000) || null, current.notes);
  if (patch.phone !== undefined) {
    const raw = clean(patch.phone, 30);
    if (raw) { const p = sheetLib().normPhone(raw); if (!p.valid || !p.value) throw new EmployeeDenied("PHONE_INVALID", "رقم الهاتف غير صالح (07xxxxxxxxx)"); set("phone", p.value, current.phone); } else set("phone", null, current.phone);
  }
  if (patch.category !== undefined && patch.category !== (current.category ?? "")) {
    if (current.userId) throw new EmployeeDenied("CATEGORY_LOCKED", "لا تُغيَّر فئة سجل مرتبط بحساب");
    if (!(patch.category in EMPLOYEE_CATEGORIES)) throw new EmployeeDenied("CATEGORY_INVALID", "فئة غير معروفة");
    set("category", patch.category, current.category);
  }
  if (patch.attendanceRequired !== undefined) set("attendanceRequired", patch.attendanceRequired === "yes" ? true : patch.attendanceRequired === "no" ? false : null, current.attendanceRequired);
  if (patch.branchId !== undefined && patch.branchId !== current.branchId) {
    if (!isAdmin(a)) return deny(db, a, "BRANCH_FORBIDDEN", "تحديد فرع السجل لمدير النظام فقط", String(id));
    if (current.userId) throw new EmployeeDenied("BRANCH_LOCKED", "لا يُغيَّر فرع سجل مرتبط بحساب");
    if (patch.branchId != null) {
      const b = await db.branch.findUnique({ where: { id: patch.branchId } });
      if (!b || !b.isActive) throw new EmployeeDenied("BRANCH_INVALID", "الفرع غير موجود أو غير فعّال");
    }
    set("branch", patch.branchId == null ? { disconnect: true } : { connect: { id: patch.branchId } }, current.branchId);
    changed[changed.length - 1] = "branchId";
  }
  if (!changed.length) return { changed: [] as string[] };
  await db.$transaction([
    db.employee.update({ where: { id }, data }),
    db.auditLog.create({ data: { userId: a.userId, action: "UPDATE", tableName: "Employee", recordId: String(id), newValue: { fields: changed } } }),
  ]);
  return { changed };
}

// ---------------- role suggestions (never applied automatically) ----------------

export type RoleSuggestion = { role: UserRole | null; basis: "category" | "exact-title" | "review"; note: string };
const TITLE_RULES: { match: RegExp; role: UserRole | null; note: string }[] = [
  { match: /^(صيدلي|صيدلاني|صيدلانيه|صيدليه|صيدلية)$/, role: "PHARMACIST", note: "صيدلية" },
  { match: /^(معالج|معالج طبيعي|معالجه|اخصائي علاج طبيعي|علاج طبيعي)$/, role: "THERAPIST", note: "علاج طبيعي" },
  { match: /^(استعلامات|موظف استعلامات|استقبال|موظف استقبال)$/, role: "RECEPTION", note: "استقبال/استعلامات" },
  { match: /^(كافتيريا|كافيتريا|عامل كافتيريا|مطبخ)$/, role: null, note: "سجل شخصي بلا وصول سريري" },
];
/** Suggestion only: category-based mapping approved by the owner; other roles only from an exact normalized title. Free text never grants privilege. */
export function suggestRole(e: { category: string | null; job: string | null; department: string | null }): RoleSuggestion {
  if (e.category === "RESIDENT") return { role: "RESIDENT", basis: "category", note: "اطباء التدرج = RESIDENT (قرار المالك)" };
  if (e.category === "SPECIALIST") return { role: "DOCTOR", basis: "category", note: "الاطباء الاختصاص = DOCTOR (قرار المالك)" };
  const titles = [e.job, e.department].map((t) => normName(t ?? ""));
  for (const t of titles) {
    const rule = t && TITLE_RULES.find((r) => r.match.test(t));
    if (rule) return { role: rule.role, basis: "exact-title", note: `مطابقة تامة للمسمى (${rule.note}) — تحتاج تأكيد المدير` };
  }
  return { role: null, basis: "review", note: "غامض: يحتاج قراراً بشرياً قبل أي حساب" };
}

export async function roleMappingGroups(db: Db, a: EmployeeActor) {
  if (!canViewEmployees(a)) return deny(db, a, "NO_PERMISSION", "ليست لديك صلاحية عرض سجلات الموظفين");
  const rows = await db.employee.groupBy({ by: ["category", "job", "department"], where: employeeScopeWhere(a), _count: { _all: true }, orderBy: [{ category: "asc" }, { job: "asc" }] });
  return rows.map((r) => ({ category: r.category, job: r.job, department: r.department, count: r._count._all, suggestion: suggestRole({ category: r.category, job: r.job, department: r.department }) }));
}

// ---------------- account linking ----------------

export type LinkEvidence = { ok: boolean; checks: { key: string; ok: boolean; label: string }[]; user?: { id: string; username: string; fullName: string; role: string; isActive: boolean } };

async function evaluateLink(db: Pick<Db, "employee" | "user">, emp: { id: number; name: string; category: string | null; branchId: number | null; userId: string | null }, username: string): Promise<LinkEvidence> {
  const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() }, select: { id: true, username: true, fullName: true, role: true, isActive: true, branchId: true, employeeRecord: { select: { id: true } } } });
  if (!user) return { ok: false, checks: [{ key: "exists", ok: false, label: "لا يوجد حساب بهذا اسم المستخدم" }] };
  const requiredRole = emp.category === "RESIDENT" ? "RESIDENT" : emp.category === "SPECIALIST" ? "DOCTOR" : null;
  const checks = [
    { key: "employeeFree", ok: emp.userId == null, label: "السجل غير مرتبط بحساب" },
    { key: "userFree", ok: user.employeeRecord == null, label: "الحساب غير مرتبط بسجل آخر" },
    { key: "nameEqual", ok: normName(user.fullName) === normName(emp.name) && normName(emp.name).length > 0, label: "الاسم الكامل مطابق تماماً (بعد التطبيع)" },
    { key: "branch", ok: emp.branchId != null && user.branchId === emp.branchId, label: "الفرع نفسه (محدد وغير فارغ)" },
    { key: "role", ok: !["ADMIN", "MANAGER"].includes(user.role) && (requiredRole == null || user.role === requiredRole), label: requiredRole ? `دور الحساب ${requiredRole}` : "دور الحساب ليس ADMIN/MANAGER" },
  ];
  return { ok: checks.every((c) => c.ok), checks, user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role, isActive: user.isActive } };
}

/** Read-only proposal for the administrator to review. The username is typed by the administrator; names or phones alone never produce a proposal. */
export async function proposeLink(db: Db, a: EmployeeActor, employeeId: number, username: string) {
  if (!canManageAccounts(a)) return deny(db, a, "NO_ACCOUNT_PERMISSION", "ربط الحسابات لمدير النظام فقط", String(employeeId));
  const emp = await db.employee.findFirst({ where: { AND: [{ id: employeeId }, employeeScopeWhere(a)] } });
  if (!emp) return deny(db, a, "NOT_FOUND", "السجل غير موجود", String(employeeId));
  return evaluateLink(db, emp, username);
}

export async function confirmLink(db: Db, a: EmployeeActor, employeeId: number, username: string, verificationNote: string) {
  if (!canManageAccounts(a)) return deny(db, a, "NO_ACCOUNT_PERMISSION", "ربط الحسابات لمدير النظام فقط", String(employeeId));
  const note = clean(verificationNote, 300);
  if (note.length < 5) throw new EmployeeDenied("NOTE_REQUIRED", "اكتب كيف تحقّقت من هوية صاحب الحساب (5 أحرف على الأقل)");
  try {
    return await db.$transaction(async (tx) => {
      const emp = await tx.employee.findFirst({ where: { AND: [{ id: employeeId }, employeeScopeWhere(a)] } });
      if (!emp) throw new EmployeeDenied("NOT_FOUND", "السجل غير موجود");
      const ev = await evaluateLink(tx as unknown as Db, emp, username);
      if (!ev.ok || !ev.user) throw new EmployeeDenied("LINK_REJECTED", "الأدلة غير كافية للربط: " + ev.checks.filter((c) => !c.ok).map((c) => c.label).join("؛ "));
      const claim = await tx.employee.updateMany({ where: { id: emp.id, userId: null }, data: { userId: ev.user.id } });
      if (claim.count !== 1) throw new EmployeeDenied("ALREADY_LINKED", "السجل ارتبط بحساب في الأثناء");
      await tx.auditLog.create({ data: { userId: a.userId, action: "LINK", tableName: "Employee", recordId: String(emp.id), newValue: { linkedUserId: ev.user.id, verification: note } } });
      return ev.user;
    }, { isolationLevel: "Serializable" });
  } catch (e) {
    if (e instanceof EmployeeDenied) { await deny(db, a, e.code, e.message, String(employeeId)).catch(() => undefined); throw e; }
    if ((e as { code?: string }).code === "P2002" || (e as { code?: string }).code === "P2034") throw new EmployeeDenied("CONFLICT", "تعارض في الربط: هذا الحساب أو السجل ارتبط للتو");
    throw e;
  }
}

export type StageInput = { username: string; role: string; centerId?: number | null };
export type StageResult = { userId: string; membership: boolean; warnings: string[] };

/** Prepares an INACTIVE account (random unusable password, needsActivation) linked one-to-one to the existing Employee record. Activation is a separate step on the Users page. */
export async function stageAccount(db: Db, a: EmployeeActor, employeeId: number, input: StageInput): Promise<StageResult> {
  if (!canManageAccounts(a)) return deny(db, a, "NO_ACCOUNT_PERMISSION", "إنشاء الحسابات لمدير النظام فقط", String(employeeId));
  const username = input.username.trim().toLowerCase();
  if (!USERNAME.test(username)) throw new EmployeeDenied("USERNAME_INVALID", "اسم المستخدم: أحرف لاتينية صغيرة وأرقام ونقطة وشرطة (3–40)");
  const role = input.role as UserRole;
  if (!STAGEABLE_ROLES.includes(role)) return deny(db, a, "ROLE_NOT_ALLOWED", "هذا الدور يحتاج اعتماداً منفصلاً من صفحة الحسابات", String(employeeId));
  const warnings: string[] = [];
  try {
    return await db.$transaction(async (tx) => {
      const emp = await tx.employee.findFirst({ where: { AND: [{ id: employeeId }, employeeScopeWhere(a)] } });
      if (!emp) throw new EmployeeDenied("NOT_FOUND", "السجل غير موجود");
      if (emp.userId) throw new EmployeeDenied("ALREADY_LINKED", "السجل مرتبط بحساب بالفعل");
      if (emp.branchId == null) throw new EmployeeDenied("BRANCH_REQUIRED", "حدّد فرع السجل أولاً");
      const required = emp.category === "RESIDENT" ? "RESIDENT" : emp.category === "SPECIALIST" ? "DOCTOR" : null;
      if (required && role !== required) throw new EmployeeDenied("ROLE_MISMATCH", `فئة هذا السجل تقتضي الدور ${required}`);
      if (await tx.user.findUnique({ where: { username }, select: { id: true } })) throw new EmployeeDenied("USERNAME_TAKEN", "اسم المستخدم مستخدم");
      const dupName = await tx.user.findMany({ where: { branchId: emp.branchId }, select: { fullName: true } });
      if (dupName.some((u) => normName(u.fullName) === normName(emp.name))) throw new EmployeeDenied("POSSIBLE_DUPLICATE", "يوجد حساب بالاسم نفسه في الفرع: استخدم «ربط حساب موجود» بدل إنشاء حساب مكرر");
      let centerId: number | null = null;
      const centerRole = centerRoleForUserRole(role);
      if (input.centerId != null) {
        const c = await tx.center.findUnique({ where: { id: input.centerId } });
        if (!c || !c.active) throw new EmployeeDenied("CENTER_INVALID", "المركز غير موجود أو غير فعّال");
        if (!centerRole) throw new EmployeeDenied("CENTER_ROLE_NONE", "هذا الدور لا يملك صفة داخل المراكز");
        centerId = c.id;
      } else if (centerRole) warnings.push("لا توجد عضوية مركز: لن يصل الحساب إلى أي مركز حتى تُضاف عضوية موثقة");
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      const user = await tx.user.create({ data: { username, fullName: emp.name, role, branchId: emp.branchId, passwordHash, isActive: false, needsActivation: true, jobTitle: emp.job, department: emp.department, phone: emp.phone, email: null } });
      const claim = await tx.employee.updateMany({ where: { id: emp.id, userId: null }, data: { userId: user.id } });
      if (claim.count !== 1) throw new EmployeeDenied("ALREADY_LINKED", "السجل ارتبط بحساب في الأثناء");
      let membership = false;
      if (centerId != null && centerRole) {
        await tx.centerMembership.create({ data: { centerId, userId: user.id, role: centerRole, status: "ACTIVE", specialty: emp.specialty } });
        membership = true;
      }
      await tx.auditLog.create({ data: { userId: a.userId, action: "CREATE", tableName: "users", recordId: user.id, newValue: { staged: true, employeeId: emp.id, role, inactive: true, membership } } });
      return { userId: user.id, membership, warnings };
    }, { isolationLevel: "Serializable" });
  } catch (e) {
    if (e instanceof EmployeeDenied) { await deny(db, a, e.code, e.message, String(employeeId)).catch(() => undefined); throw e; }
    if ((e as { code?: string }).code === "P2002" || (e as { code?: string }).code === "P2034") throw new EmployeeDenied("CONFLICT", "تعارض: اسم المستخدم أو السجل استُخدم للتو");
    throw e;
  }
}
