import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient, Prisma } from "@prisma/client";
import { scanBufferWithClamAv } from "@/lib/collaboration-scan";
import { IMPORT_DOMAIN_BY_ID, STAFF_TEMPLATE_VERSION, TEMPLATE_VERSION, decodeStaffRow } from "./registry";
import { type Plan, type RowResult } from "./plan";
import { buildImportPlan } from "./plan-staff";
import { parseUpload, sheetLib, UploadRejected } from "./spreadsheet";

type Db = PrismaClient;
export type Actor = { userId: string; role: string; permissions: ReadonlySet<string>; branchId: number | null };

export class DataCenterDenied extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const PREVIEW_TTL_MS = 24 * 3600_000;
const QUOTA = { previewsPerHour: 20, pendingPreviews: 10, exportsPerHour: 30 } as const;
const BATCH = 200;

/** APPLY is locked unless explicitly enabled by the environment AND the connected database is not on the protected list (QA by default). */
export function applyLockReason(databaseName: string, env: Record<string, string | undefined> = process.env): string | null {
  if (env.DATA_CENTER_APPLY_ENABLED !== "true") return "تنفيذ الاستيراد مقفل في هذه البيئة (DATA_CENTER_APPLY_ENABLED غير مفعّل)؛ المعاينة والتحقق متاحان فقط";
  const forbidden = (env.DATA_CENTER_FORBIDDEN_DATABASES ?? "tahili_rehearsal").split(",").map((s) => s.trim()).filter(Boolean);
  if (forbidden.includes(databaseName)) return `تنفيذ الاستيراد محظور على قاعدة البيانات ${databaseName}`;
  return null;
}
export async function currentDatabaseName(db: Db) { return ((await db.$queryRaw<{ n: string }[]>`select current_database() as n`)[0]).n; }

async function deny(db: Db, actor: Actor, domain: string, code: string, message: string): Promise<never> {
  await db.auditLog.create({ data: { userId: actor.userId, action: "DENIED", tableName: "data_operations", recordId: domain, newValue: { code } } }).catch(() => undefined);
  throw new DataCenterDenied(code, message);
}

/** Branch the actor may import into: their own active branch; ADMIN any active branch. A forged branchId from another branch is denied. */
export async function resolveImportBranch(db: Db, actor: Actor, requested: number | null, domain: string) {
  const id = requested ?? actor.branchId;
  if (id == null) return deny(db, actor, domain, "NO_BRANCH", "اختر فرعاً للعملية (حسابك بلا فرع فعّال)");
  const branch = await db.branch.findUnique({ where: { id } });
  if (!branch || !branch.isActive) return deny(db, actor, domain, "BRANCH_INVALID", "الفرع غير موجود أو غير فعّال");
  if (actor.role !== "ADMIN" && actor.branchId !== branch.id) return deny(db, actor, domain, "BRANCH_FORBIDDEN", "لا يمكنك الاستيراد إلى فرع غير فرعك");
  return branch;
}

export function importAllowed(actor: Actor, domainId: string) {
  const d = IMPORT_DOMAIN_BY_ID[domainId];
  return !!d && actor.permissions.has("datacenter.view") && actor.permissions.has(d.permission) && (d.requires ?? []).every((k) => actor.permissions.has(k));
}

export async function purgeExpired(db: Db) {
  await db.dataOperation.updateMany({ where: { kind: "IMPORT", status: "PREVIEWED", expiresAt: { lt: new Date() } }, data: { status: "CANCELLED", fileBytes: null, error: "انتهت صلاحية المعاينة" } });
}

export async function previewImport(db: Db, actor: Actor, input: { domain: string; branchId: number | null; fileName: string; bytes: Buffer }) {
  const domain = IMPORT_DOMAIN_BY_ID[input.domain];
  if (!domain) throw new DataCenterDenied("UNKNOWN_DOMAIN", "نوع البيانات غير مدعوم");
  if (!importAllowed(actor, domain.id)) return deny(db, actor, domain.id, "NO_PERMISSION", "ليست لديك صلاحية استيراد هذا النوع من البيانات");
  const branch = await resolveImportBranch(db, actor, input.branchId, domain.id);
  await purgeExpired(db);
  const hourAgo = new Date(Date.now() - 3600_000);
  if ((await db.dataOperation.count({ where: { actorId: actor.userId, kind: "IMPORT", createdAt: { gt: hourAgo } } })) >= QUOTA.previewsPerHour) throw new DataCenterDenied("RATE_LIMIT", "تجاوزت الحد المسموح من المعاينات في الساعة؛ حاول لاحقاً");
  if ((await db.dataOperation.count({ where: { actorId: actor.userId, kind: "IMPORT", status: "PREVIEWED" } })) >= QUOTA.pendingPreviews) throw new DataCenterDenied("QUOTA", "لديك معاينات معلّقة كثيرة؛ ألغِ بعضها أولاً");

  const wb = parseUpload(input.bytes, input.fileName);
  const scan = await scanBufferWithClamAv(input.bytes);
  if (scan.status === "REJECTED" || scan.status === "FAILED") throw new UploadRejected("SCAN", "رُفض الملف في فحص الأمان");
  const dup = await db.dataOperation.findFirst({ where: { kind: "IMPORT", domain: domain.id, branchId: branch.id, fileSha256: wb.sha256, status: { in: ["APPLIED", "APPLYING"] } }, select: { id: true } });
  if (dup) throw new DataCenterDenied("DUPLICATE_FILE", `هذا الملف نفسه نُفِّذ سابقاً لنفس النوع والفرع (العملية ${dup.id}); لا يُنفَّذ مرتين`);

  const plan = await buildImportPlan(db, domain.id, wb, { branchId: branch.id, fileSha256: wb.sha256 });
  const op = await db.dataOperation.create({
    data: {
      kind: "IMPORT", domain: domain.id, status: "PREVIEWED", branchId: branch.id, actorId: actor.userId, templateVersion: domain.id === "staff" ? STAFF_TEMPLATE_VERSION : TEMPLATE_VERSION, format: wb.format,
      fileName: input.fileName.slice(0, 120), fileSha256: wb.sha256, fileBytes: new Uint8Array(input.bytes), planSha256: plan.planSha256, rowCount: plan.rows.length,
      counts: { ...plan.counts, applied: 0, failed: 0, unmappedHeaders: plan.unmappedHeaders }, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    },
  });
  for (let i = 0; i < plan.rows.length; i += 1000) {
    await db.dataOperationRow.createMany({ data: plan.rows.slice(i, i + 1000).map((r) => ({ operationId: op.id, rowNumber: r.rowNumber, sourceKey: r.sourceKey, disposition: r.disposition, reasons: r.reasons.join(";") || null, fieldErrors: r.fieldErrors.length ? (r.fieldErrors as unknown as Prisma.InputJsonValue) : undefined })) });
  }
  await db.auditLog.create({ data: { userId: actor.userId, action: "PREVIEW", tableName: "data_operations", recordId: op.id, newValue: { domain: domain.id, branchId: branch.id, rows: plan.rows.length, counts: plan.counts, planSha256: plan.planSha256 } } });
  return { operationId: op.id, plan };
}

export async function loadOperation(db: Db, actor: Actor, id: string) {
  const op = await db.dataOperation.findUnique({ where: { id }, select: { id: true, kind: true, domain: true, status: true, branchId: true, branch: { select: { name: true } }, actorId: true, format: true, fileName: true, fileSha256: true, planSha256: true, rowCount: true, counts: true, scope: true, error: true, expiresAt: true, confirmedAt: true, appliedAt: true, createdAt: true, templateVersion: true } });
  if (!op || (op.actorId !== actor.userId && actor.role !== "ADMIN")) return null;
  return op;
}

export async function cancelImport(db: Db, actor: Actor, id: string) {
  const op = await loadOperation(db, actor, id);
  if (!op) return deny(db, actor, id, "NOT_FOUND", "العملية غير موجودة");
  const res = await db.dataOperation.updateMany({ where: { id, status: "PREVIEWED" }, data: { status: "CANCELLED", fileBytes: null } });
  if (res.count) await db.auditLog.create({ data: { userId: actor.userId, action: "CANCEL", tableName: "data_operations", recordId: id } });
  return res.count === 1;
}

export type ApplyResult = { status: "APPLIED" | "PARTIAL" | "FAILED"; applied: number; failed: number; message?: string };

export async function confirmImport(db: Db, actor: Actor, id: string, expectedPlanSha: string): Promise<ApplyResult> {
  const op = await db.dataOperation.findUnique({ where: { id } });
  if (!op || op.kind !== "IMPORT" || (op.actorId !== actor.userId && actor.role !== "ADMIN")) return deny(db, actor, id, "NOT_FOUND", "العملية غير موجودة");
  const domain = IMPORT_DOMAIN_BY_ID[op.domain];
  if (!domain || !actor.permissions.has(domain.permission) || !(domain.requires ?? []).every((k) => actor.permissions.has(k)) || !actor.permissions.has("datacenter.import.apply")) return deny(db, actor, op.domain, "NO_APPLY_PERMISSION", "ليست لديك صلاحية تنفيذ الاستيراد");
  const lock = applyLockReason(await currentDatabaseName(db));
  if (lock) return deny(db, actor, op.domain, "APPLY_LOCKED", lock);
  const branch = await resolveImportBranch(db, actor, op.branchId, op.domain);
  if (op.status !== "PREVIEWED" || !op.fileBytes || (op.expiresAt && op.expiresAt < new Date())) throw new DataCenterDenied("NOT_CONFIRMABLE", "المعاينة لم تعد صالحة للتنفيذ؛ ارفع الملف وعاينه من جديد");
  if (!op.planSha256 || op.planSha256 !== expectedPlanSha) throw new DataCenterDenied("PLAN_MISMATCH", "خطة التنفيذ تغيّرت عن المعروضة؛ أعد المعاينة");
  const dup = await db.dataOperation.findFirst({ where: { kind: "IMPORT", domain: op.domain, branchId: op.branchId, fileSha256: op.fileSha256, status: { in: ["APPLIED", "APPLYING"] }, id: { not: id } }, select: { id: true } });
  if (dup) throw new DataCenterDenied("DUPLICATE_FILE", "هذا الملف نُفِّذ سابقاً");
  // server revalidation against the CURRENT database state
  const plan = await buildImportPlan(db, op.domain, parseUpload(Buffer.from(op.fileBytes), op.fileName ?? "upload.xlsx"), { branchId: branch.id, fileSha256: op.fileSha256! });
  if (plan.planSha256 !== op.planSha256) throw new DataCenterDenied("PLAN_MISMATCH", "حالة البيانات تغيّرت منذ المعاينة؛ أعد المعاينة");
  const claim = await db.dataOperation.updateMany({ where: { id, status: "PREVIEWED" }, data: { status: "APPLYING", confirmedAt: new Date() } });
  if (claim.count !== 1) throw new DataCenterDenied("ALREADY_RUNNING", "العملية قيد التنفيذ أو انتهت");

  const ready = plan.rows.filter((r) => r.disposition === "READY");
  let applied = 0, failed = 0, message: string | undefined;
  const refs = await referenceMaps(db);
  if (op.domain === "staff") {
    // Personnel, accounts and memberships reference each other: apply them as ONE all-or-nothing transaction.
    try {
      const staff: StaffCtx = { employeeByKey: new Map(), userByKey: new Map() };
      const results = await db.$transaction(async (tx) => {
        const out: { row: RowResult; id: string }[] = [];
        for (const r of ready) out.push({ row: r, id: await applyStaffRow(tx as unknown as Db, r, { branchId: branch.id, operationId: id, actorId: actor.userId, staff }) });
        await tx.auditLog.create({ data: { userId: actor.userId, action: "APPLY", tableName: "data_operations", recordId: id, newValue: { atomic: true, size: ready.length, domain: op.domain, branchId: branch.id, personnel: plan.counts.readyPersonnel, accounts: plan.counts.readyAccounts, memberships: plan.counts.readyMemberships } } });
        return out;
      }, { timeout: 120_000, maxWait: 20_000 });
      for (const { row, id: rid } of results) await db.dataOperationRow.updateMany({ where: { operationId: id, rowNumber: row.rowNumber }, data: { disposition: "APPLIED", resultRecordId: rid } });
      applied = results.length;
    } catch (e) {
      failed = ready.length;
      message = `تراجع التنفيذ كاملاً ولم يُكتب شيء: ${(e as Error).message.slice(0, 160)}`;
    }
  } else
  for (let i = 0; i < ready.length; i += BATCH) {
    const chunk = ready.slice(i, i + BATCH);
    try {
      const results = await db.$transaction(async (tx) => {
        const out: { row: RowResult; id: string }[] = [];
        for (const r of chunk) out.push({ row: r, id: await applyRow(tx as unknown as Db, op.domain, r, { branchId: branch.id, operationId: id, actorId: actor.userId, refs }) });
        await tx.auditLog.create({ data: { userId: actor.userId, action: "APPLY", tableName: "data_operations", recordId: id, newValue: { batch: Math.floor(i / BATCH), size: chunk.length, domain: op.domain, branchId: branch.id } } });
        return out;
      });
      for (const { row, id: rid } of results) await db.dataOperationRow.updateMany({ where: { operationId: id, rowNumber: row.rowNumber }, data: { disposition: "APPLIED", resultRecordId: rid } });
      applied += results.length;
    } catch (e) {
      failed = ready.length - applied;
      message = `توقف التنفيذ عند الدفعة ${Math.floor(i / BATCH) + 1}: ${(e as Error).message.slice(0, 160)}`;
      break;
    }
  }
  const status = failed ? (applied ? "PARTIAL" : "FAILED") : "APPLIED";
  await db.dataOperation.update({ where: { id }, data: { status, appliedAt: new Date(), error: message ?? null, fileBytes: status === "APPLIED" ? null : op.fileBytes, counts: { ...(op.counts as object), applied, failed } } });
  await db.auditLog.create({ data: { userId: actor.userId, action: "APPLY_DONE", tableName: "data_operations", recordId: id, newValue: { status, applied, failed, domain: op.domain } } });
  return { status, applied, failed, message };
}

type StaffCtx = { employeeByKey: Map<string, number>; userByKey: Map<string, string> };

/** Writes one READY row of the unified staff plan inside the shared transaction (personnel first, then accounts, then memberships: row numbers are ordered by sheet). */
async function applyStaffRow(tx: Db, r: RowResult, ctx: { branchId: number; operationId: string; actorId: string; staff: StaffCtx }): Promise<string> {
  const d = r.data!;
  const marker = `${ctx.operationId.slice(-8)}:${r.sourceKey}`;
  const key = (d.personKey ?? "").toLowerCase();
  if (d.kind === "personnel") {
    const e = await tx.employee.create({ data: { name: d.fullName, job: d.job || null, department: d.department || null, specialty: d.specialty || null, capacity: d.capacity || null, phone: d.phone || null, category: d.category, sourceKey: marker, branchId: ctx.branchId } });
    ctx.staff.employeeByKey.set(key, e.id);
    await tx.auditLog.create({ data: { userId: ctx.actorId, action: "CREATE", tableName: "Employee", recordId: String(e.id), newValue: { operation: ctx.operationId, category: d.category, source: "unified-staff-import" } } });
    return String(e.id);
  }
  if (d.kind === "accounts") {
    const employeeId = ctx.staff.employeeByKey.get(key) ?? (d.employeeId ? Number(d.employeeId) : undefined);
    if (!employeeId) throw new Error("لا يوجد سجل موظف لهذا الحساب");
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    const u = await tx.user.create({ data: { username: d.username, fullName: d.fullName, role: d.role as never, branchId: ctx.branchId, isActive: false, needsActivation: true, passwordHash: hash, jobTitle: d.jobTitle || null, department: d.department || null, phone: d.phone || null, email: d.email || null, note: `مُجهَّز بالاستيراد الموحّد ${ctx.operationId.slice(-8)}؛ غير مفعّل حتى اعتماد الهوية والصلاحية` } });
    const link = await tx.employee.updateMany({ where: { id: employeeId, userId: null }, data: { userId: u.id } });
    if (link.count !== 1) throw new Error("سجل الموظف مرتبط بحساب آخر");
    ctx.staff.userByKey.set(key, u.id);
    await tx.auditLog.create({ data: { userId: ctx.actorId, action: "CREATE", tableName: "users", recordId: u.id, newValue: { staged: true, inactive: true, role: d.role, employeeId, branchId: ctx.branchId, operation: ctx.operationId } } });
    return u.id;
  }
  if (d.kind === "memberships") {
    const userId = ctx.staff.userByKey.get(key) ?? d.userId;
    if (!userId) throw new Error("لا يوجد حساب لهذه العضوية");
    const m = await tx.centerMembership.create({ data: { centerId: Number(d.centerId), userId, role: d.centerRole as never, specialty: d.specialty || null, status: "ACTIVE", startDate: d.startDate ? new Date(d.startDate) : undefined } });
    await tx.auditLog.create({ data: { userId: ctx.actorId, action: "CREATE", tableName: "center_memberships", recordId: m.id, newValue: { operation: ctx.operationId, role: d.centerRole } } });
    return m.id;
  }
  throw new Error("unsupported staff row");
}

async function referenceMaps(db: Db) {
  const gov = new Map((await db.governorate.findMany({ select: { id: true, name: true } })).map((g) => [g.name.trim(), g.id]));
  const inj = new Map((await db.injuryType.findMany({ select: { id: true, name: true } })).map((g) => [g.name.trim(), g.id]));
  return { gov, inj };
}

const GENDER: Record<string, "MALE" | "FEMALE"> = { "ذكر": "MALE", "أنثى": "FEMALE" };

async function applyRow(tx: Db, domain: string, r: RowResult, ctx: { branchId: number; operationId: string; actorId: string; refs: { gov: Map<string, number>; inj: Map<string, number> } }): Promise<string> {
  const d = r.data!;
  const marker = `${ctx.operationId.slice(-8)}:${r.sourceKey}`;
  if (domain === "patients") {
    const num = (v: string | undefined) => (v ? Number(v) : null);
    const bool = (v: string | undefined) => (v === "1" ? true : v === "0" ? false : null);
    const day = (v: string | undefined) => (v ? new Date(v) : null);
    const row = await tx.patient.create({
      data: {
        fullName: d.fullName, motherName: d.motherName || null, gender: d.gender as never, birthYear: Number(d.birthYear), birthDate: day(d.birthDate), phone: d.phone,
        housing: d.housing || null, maritalStatus: (d.maritalStatus || null) as never, childrenCount: num(d.childrenCount), wivesCount: num(d.wivesCount), education: d.education || null,
        kinshipDegree: d.kinshipDegree || null, caseType: d.caseType as never, governorateId: ctx.refs.gov.get(d.governorate) ?? null, injuryTypeId: ctx.refs.inj.get(d.injuryType) ?? null,
        rank: d.rank || null, formationText: d.formationText || null, militaryStatus: d.militaryStatus || null, inMobilization: bool(d.inMobilization), receivesSalary: bool(d.receivesSalary),
        disabilityPct: num(d.disabilityPct), injuryCause: d.injuryCause || null, injuryDate: day(d.injuryDate), mobility: d.mobility || null, mobilityAid: d.mobilityAid || null,
        prosthetic: d.prosthetic || null, referredToCenter: d.referredToCenter || null, status: (d.status || "ACTIVE") as never, notes: d.notes || null,
        branchId: ctx.branchId, legacyFileNumber: d.legacyFileNumber || null, importSourceKey: marker, dataEntryBy: `import:${ctx.operationId.slice(-8)}`,
      },
    });
    return row.id;
  }
  if (domain === "employees" || domain === "residents" || domain === "specialists") {
    const row = await tx.employee.create({ data: { name: d.fullName, job: d.job || null, department: d.department || null, specialty: d.specialty || null, capacity: d.capacity || null, phone: d.phone || null, category: d.category, sourceKey: marker, branchId: ctx.branchId } });
    return String(row.id);
  }
  if (domain === "accounts") {
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    const u = await tx.user.create({ data: { username: d.username, fullName: d.fullName, role: d.role as never, branchId: ctx.branchId, isActive: false, needsActivation: true, passwordHash: hash, jobTitle: d.jobTitle || null, department: d.department || null, phone: d.phone || null, email: d.email || null, note: `مُجهَّز بالاستيراد ${ctx.operationId.slice(-8)}؛ غير مفعّل حتى اعتماد الهوية والصلاحية` } });
    await tx.auditLog.create({ data: { userId: ctx.actorId, action: "CREATE", tableName: "users", recordId: u.id, newValue: { staged: true, inactive: true, role: d.role, branchId: ctx.branchId, operation: ctx.operationId } } });
    return u.id;
  }
  if (domain === "memberships") {
    const m = await tx.centerMembership.create({ data: { centerId: Number(d.centerId), userId: d.userId, role: d.centerRole as never, specialty: d.specialty || null, status: "ACTIVE", startDate: d.startDate ? new Date(d.startDate) : undefined } });
    await tx.auditLog.create({ data: { userId: ctx.actorId, action: "CREATE", tableName: "center_memberships", recordId: m.id, newValue: { operation: ctx.operationId, role: d.centerRole } } });
    return m.id;
  }
  throw new Error("unsupported domain");
}

/** Protected error report: row number, field, actionable correction. No cell values. */
export async function errorReportRows(db: Db, actor: Actor, id: string) {
  const op = await loadOperation(db, actor, id);
  if (!op) return null;
  const rows = await db.dataOperationRow.findMany({ where: { operationId: id, disposition: { in: ["INVALID", "HELD", "DUPLICATE", "UPDATE_CANDIDATE", "EXCLUDED"] } }, orderBy: { rowNumber: "asc" }, take: 6000 });
  const lib = sheetLib();
  const staff = op.domain === "staff";
  const SHEET_AR = { personnel: "الأشخاص", accounts: "الحسابات", memberships: "العضويات" } as const;
  const head = staff ? ["الورقة", "رقم الصف في الملف", "الحالة", "الحقل", "الرمز", "الإجراء المطلوب"] : ["رقم الصف في الملف", "الحالة", "الحقل", "الرمز", "الإجراء المطلوب"];
  const label = (n: number): (string | number)[] => { if (!staff) return [n]; const x = decodeStaffRow(n); return [SHEET_AR[x.sheet], x.row]; };
  const body: (string | number)[][] = [];
  for (const r of rows) {
    const errs = (r.fieldErrors as { field: string; code: string; message: string }[] | null) ?? [];
    if (errs.length) for (const e of errs) body.push([...label(r.rowNumber), r.disposition, e.field, e.code, e.message]);
    else body.push([...label(r.rowNumber), r.disposition, "", r.reasons ?? "", dispositionHint(r.disposition, r.reasons)]);
  }
  return { op, head, body, lib };
}
function dispositionHint(d: string, reasons: string | null) {
  if (d === "DUPLICATE") return "صف مكرر داخل الملف: يُحتفظ بالأول فقط";
  if (d === "UPDATE_CANDIDATE") return "سجل قائم يختلف عن الملف: التحديث غير معتمد حالياً ولن يُطبَّق";
  if (d === "EXCLUDED") return "صف فارغ أو خارج النطاق";
  return reasons ? `يلزم قرار/تصحيح: ${reasons}` : "يلزم قرار";
}

export async function listOperations(db: Db, actor: Actor, take = 100) {
  return db.dataOperation.findMany({ where: actor.role === "ADMIN" ? {} : { actorId: actor.userId }, orderBy: { createdAt: "desc" }, take, select: { id: true, kind: true, domain: true, status: true, branch: { select: { name: true } }, fileName: true, rowCount: true, counts: true, createdAt: true, actor: { select: { fullName: true } } } });
}

export async function recordExport(db: Db, actor: Actor, domain: string, status: "COMPLETED" | "DENIED", info: { branchId: number | null; scope: Prisma.InputJsonValue; rowCount: number; format: string; error?: string }) {
  const op = await db.dataOperation.create({ data: { kind: "EXPORT", domain, status, branchId: info.branchId, actorId: actor.userId, format: info.format, rowCount: info.rowCount, scope: info.scope, error: info.error ?? null } });
  await db.auditLog.create({ data: { userId: actor.userId, action: status === "COMPLETED" ? "EXPORT" : "DENIED", tableName: "data_operations", recordId: op.id, newValue: { domain, rows: info.rowCount, scope: info.scope, format: info.format } } });
  return op;
}

export async function exportQuotaOk(db: Db, actor: Actor) {
  return (await db.dataOperation.count({ where: { actorId: actor.userId, kind: "EXPORT", createdAt: { gt: new Date(Date.now() - 3600_000) } } })) < QUOTA.exportsPerHour;
}
