import type { PrismaClient, Prisma } from "@prisma/client";
import { patientAdministrativeWhere, patientScopeWhere } from "@/lib/patient-access";
import { batchViewWhere, movementViewWhere, type StockViewer } from "@/lib/pharmacy-stock";
import type { Actor } from "./operations";
import { DataCenterDenied } from "./operations";
import type { ExportDomainId, ExportDomainInfo } from "./registry";

type Db = PrismaClient;
export const EXPORT_ROW_CAP = 20_000;
const MAX_RANGE_DAYS = 366;

export const EXPORT_DOMAINS: ExportDomainInfo[] = [
  { id: "patients", title: "المراجعون — الحقول الإدارية", permission: "datacenter.export.patients", requires: ["patients.view"], needsRange: false, note: "حقول إدارية فقط (بلا تشخيص أو نوع إصابة أو ملاحظات)",
    columns: ["رقم الملف", "رقم الملف السابق", "الاسم", "الجنس", "سنة التولد", "الهاتف", "المحافظة", "الفرع", "الحالة", "تاريخ التسجيل"] },
  { id: "personnel", title: "الموظفون والأطباء (المقيمون والاختصاص)", permission: "datacenter.export.personnel", requires: ["users.view"], needsRange: false, note: "بيانات الموظفين دون أي بيانات دخول",
    columns: ["الاسم", "الفئة", "الوظيفة", "القسم", "الاختصاص", "الصفة", "له حساب دخول"] },
  { id: "users", title: "قائمة المستخدمين (بلا أسرار)", permission: "datacenter.export.users", requires: ["users.view"], needsRange: false, note: "لا كلمات سر ولا رموز ولا جلسات",
    columns: ["اسم المستخدم", "الاسم", "الدور", "الفرع", "فعّال", "يحتاج تفعيلاً", "المسمى الوظيفي", "القسم", "الهاتف"] },
  { id: "reference", title: "قوائم الفروع والمراكز", permission: "datacenter.export.reference", requires: [], needsRange: false, note: "مرجعية",
    columns: ["النوع", "الاسم", "فعّال"] },
  { id: "appointments", title: "ملخص المواعيد", permission: "datacenter.export.appointments", requires: ["appointments.view"], needsRange: true, note: "رقم الملف فقط دون اسم المراجع",
    columns: ["التاريخ", "النوع", "الحالة", "المسؤول", "المركز", "رقم الملف", "الفرع"] },
  { id: "sessions", title: "ملخص الجلسات العلاجية", permission: "datacenter.export.appointments", requires: ["therapy.view"], needsRange: true, note: "ملخص فقط دون محتوى سريري",
    columns: ["التاريخ", "النوع", "المركز", "عدد الجلسات المخطط", "الجلسات الفعلية", "رقم الملف", "الفرع"] },
  { id: "pharmacy_stock", title: "مخزون صيدلية الفرع", permission: "datacenter.export.pharmacy", requires: [], needsRange: false, note: "مخزون الفرع نفسه (الأدمن: كل الفروع بقراءة فقط)",
    columns: ["المادة", "الوحدة", "رقم الدفعة", "تاريخ الانتهاء", "الكمية", "الفرع"] },
  { id: "pharmacy_movements", title: "ملخص حركات مخزون الفرع", permission: "datacenter.export.pharmacy", requires: [], needsRange: true, note: "بلا أسماء مراجعين ولا ملاحظات حرة",
    columns: ["التاريخ", "النوع", "المادة", "الكمية", "رقم الدفعة", "الفرع"] },
  { id: "finance_invoices", title: "ملخص الفواتير التشغيلية", permission: "datacenter.export.finance", requires: ["finance.report"], needsRange: true, note: "فواتير الفرع المالك فقط؛ لا تصدير مالي عابر للفروع",
    columns: ["تاريخ الإصدار", "المبلغ", "المدفوع", "الحالة", "رقم الملف", "الفرع المالك", "مرتبطة بزيارة"] },
];

export function exportInfo(id: string) { return EXPORT_DOMAINS.find((d) => d.id === id); }
export function exportAllowed(actor: Actor, id: string) {
  const d = exportInfo(id);
  return !!d && actor.permissions.has("datacenter.view") && actor.permissions.has(d.permission) && d.requires.every((p) => actor.permissions.has(p));
}

export type ExportRequest = { domain: string; branchId?: number | null; from?: string | null; to?: string | null };
export type ExportResult = { headers: string[]; rows: (string | number)[][]; count: number; scope: Prisma.InputJsonValue; branchId: number | null };

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

async function range(req: ExportRequest, info: ExportDomainInfo) {
  if (!info.needsRange) return null;
  const from = req.from ? new Date(`${req.from}T00:00:00Z`) : null, to = req.to ? new Date(`${req.to}T23:59:59Z`) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw new DataCenterDenied("RANGE_REQUIRED", "حدّد نطاقاً زمنياً صحيحاً (من/إلى)");
  if ((to.getTime() - from.getTime()) / 86400000 > MAX_RANGE_DAYS) throw new DataCenterDenied("RANGE_TOO_LARGE", `النطاق الزمني يتجاوز ${MAX_RANGE_DAYS} يوماً`);
  return { gte: from, lte: to };
}

/** Runs (or only counts) an export. Everything is derived server-side from the actor; forged filters cannot widen the scope. */
export async function runExport(db: Db, actor: Actor, req: ExportRequest, countOnly = false): Promise<ExportResult> {
  const info = exportInfo(req.domain);
  const deny = async (code: string, message: string): Promise<never> => {
    await db.auditLog.create({ data: { userId: actor.userId, action: "DENIED", tableName: "data_operations", recordId: req.domain, newValue: { code, kind: "EXPORT" } } }).catch(() => undefined);
    throw new DataCenterDenied(code, message);
  };
  if (!info) return deny("UNKNOWN_DOMAIN", "نوع التصدير غير مدعوم");
  if (!exportAllowed(actor, info.id)) return deny("NO_PERMISSION", "ليست لديك صلاحية تصدير هذا النوع (صلاحية العرض وحدها لا تكفي)");
  const isAdmin = actor.role === "ADMIN";
  // Branch selection: only ADMIN may choose; everyone else is pinned to their own active branch (a forged value is refused).
  let branchId: number | null = actor.branchId;
  if (req.branchId != null && req.branchId !== actor.branchId) {
    if (!isAdmin) return deny("BRANCH_FORBIDDEN", "لا يمكن التصدير من فرع غير فرعك");
    const b = await db.branch.findUnique({ where: { id: req.branchId } });
    if (!b) return deny("BRANCH_INVALID", "الفرع غير موجود");
    branchId = b.id;
  } else if (isAdmin && req.branchId == null) branchId = null; // ADMIN without a choice: all branches
  if (!isAdmin && branchId == null) return deny("NO_BRANCH", "حسابك بلا فرع فعّال");
  const dates = await range(req, info);
  const person = { userId: actor.userId, role: actor.role as never, permissions: actor.permissions };
  const scope = { branchId, from: req.from ?? null, to: req.to ?? null } as Prisma.InputJsonValue;
  const done = (rows: (string | number)[][]): ExportResult => ({ headers: info.columns, rows, count: rows.length, scope, branchId });
  const guardCount = async (n: number) => { if (n > EXPORT_ROW_CAP) await deny("TOO_MANY_ROWS", `النتيجة (${n}) تتجاوز ${EXPORT_ROW_CAP} صفاً؛ ضيّق الفلاتر`); };
  const take = countOnly ? 0 : EXPORT_ROW_CAP + 1;
  const stock: StockViewer = { userId: actor.userId, role: actor.role as never, isAdmin, branchId: actor.branchId };

  switch (info.id as ExportDomainId) {
    case "patients": {
      const admin = await patientAdministrativeWhere(db, person);
      const where: Prisma.PatientWhereInput = { AND: [admin, ...(branchId != null ? [{ branchId }] : []), { archivedAt: null }] };
      const n = await db.patient.count({ where }); await guardCount(n);
      if (countOnly) return { ...done([]), count: n };
      const list = await db.patient.findMany({ where, orderBy: { fileNumber: "asc" }, take, select: { fileNumber: true, legacyFileNumber: true, fullName: true, gender: true, birthYear: true, phone: true, governorate: { select: { name: true } }, branch: { select: { name: true } }, status: true, registrationDate: true } });
      return done(list.map((p) => [p.fileNumber, p.legacyFileNumber ?? "", p.fullName, p.gender === "MALE" ? "ذكر" : p.gender === "FEMALE" ? "أنثى" : "", p.birthYear ?? "", p.phone ?? "", p.governorate?.name ?? "", p.branch?.name ?? "", p.status, day(p.registrationDate)]));
    }
    case "personnel": {
      const n = await db.employee.count(); await guardCount(n);
      if (countOnly) return { ...done([]), count: n };
      const list = await db.employee.findMany({ orderBy: { id: "asc" }, take, select: { name: true, category: true, job: true, department: true, specialty: true, capacity: true, userId: true } });
      return done(list.map((e) => [e.name, e.category ?? "", e.job ?? "", e.department ?? "", e.specialty ?? "", e.capacity ?? "", e.userId ? "نعم" : "لا"]));
    }
    case "users": {
      const where: Prisma.UserWhereInput = branchId != null ? { branchId } : {};
      const n = await db.user.count({ where }); await guardCount(n);
      if (countOnly) return { ...done([]), count: n };
      const list = await db.user.findMany({ where, orderBy: { username: "asc" }, take, select: { username: true, fullName: true, role: true, branch: { select: { name: true } }, isActive: true, needsActivation: true, jobTitle: true, department: true, phone: true } });
      return done(list.map((u) => [u.username, u.fullName, u.role, u.branch?.name ?? "", u.isActive ? "نعم" : "لا", u.needsActivation ? "نعم" : "لا", u.jobTitle ?? "", u.department ?? "", u.phone ?? ""]));
    }
    case "reference": {
      const branches = await db.branch.findMany({ where: isAdmin ? {} : { id: actor.branchId ?? -1 }, orderBy: { name: "asc" }, select: { name: true, isActive: true } });
      const centers = await db.center.findMany({ orderBy: { name: "asc" }, select: { name: true, active: true } });
      const rows: (string | number)[][] = [...branches.map((b): (string | number)[] => ["فرع", b.name, b.isActive ? "نعم" : "لا"]), ...centers.map((c): (string | number)[] => ["مركز", c.name, c.active ? "نعم" : "لا"])];
      return done(rows);
    }
    case "appointments": {
      const patient = await patientScopeWhere(db, person);
      const where: Prisma.AppointmentWhereInput = { scheduledAt: dates!, patient: { AND: [patient, ...(branchId != null ? [{ branchId }] : [])] } };
      const n = await db.appointment.count({ where }); await guardCount(n);
      if (countOnly) return { ...done([]), count: n };
      const list = await db.appointment.findMany({ where, orderBy: { scheduledAt: "asc" }, take, select: { scheduledAt: true, type: true, status: true, assignedTo: true, center: { select: { name: true } }, patient: { select: { fileNumber: true, branch: { select: { name: true } } } } } });
      return done(list.map((a) => [day(a.scheduledAt), a.type ?? "", a.status, a.assignedTo ?? "", a.center?.name ?? "", a.patient.fileNumber, a.patient.branch?.name ?? ""]));
    }
    case "sessions": {
      const patient = await patientScopeWhere(db, person);
      const where: Prisma.TherapySessionWhereInput = { createdAt: dates!, patient: { AND: [patient, ...(branchId != null ? [{ branchId }] : [])] } };
      const n = await db.therapySession.count({ where }); await guardCount(n);
      if (countOnly) return { ...done([]), count: n };
      const list = await db.therapySession.findMany({ where, orderBy: { createdAt: "asc" }, take, select: { createdAt: true, therapyType: true, center: { select: { name: true } }, totalSessions: true, actualSessions: true, patient: { select: { fileNumber: true, branch: { select: { name: true } } } } } });
      return done(list.map((s) => [day(s.createdAt), s.therapyType, s.center?.name ?? "", s.totalSessions ?? "", s.actualSessions ?? "", s.patient.fileNumber, s.patient.branch?.name ?? ""]));
    }
    case "pharmacy_stock": {
      const where: Prisma.MedicationBatchWhereInput = { AND: [batchViewWhere(stock), ...(branchId != null && isAdmin ? [{ branchId }] : [])] };
      const n = await db.medicationBatch.count({ where }); await guardCount(n);
      if (countOnly) return { ...done([]), count: n };
      const list = await db.medicationBatch.findMany({ where, orderBy: [{ branchId: "asc" }, { medicationId: "asc" }], take, select: { medication: { select: { name: true, unit: true } }, batchNo: true, expiryDate: true, quantity: true, branch: { select: { name: true } } } });
      return done(list.map((b) => [b.medication.name, b.medication.unit ?? "", b.batchNo ?? "", day(b.expiryDate), b.quantity, b.branch?.name ?? "غير مُسنَد (قديم)"]));
    }
    case "pharmacy_movements": {
      const where: Prisma.StockMovementWhereInput = { AND: [movementViewWhere(stock), { createdAt: dates! }, ...(branchId != null && isAdmin ? [{ branchId }] : [])] };
      const n = await db.stockMovement.count({ where }); await guardCount(n);
      if (countOnly) return { ...done([]), count: n };
      const list = await db.stockMovement.findMany({ where, orderBy: { createdAt: "asc" }, take, select: { createdAt: true, type: true, medication: { select: { name: true } }, quantity: true, batchId: true, branch: { select: { name: true } } } });
      const batchNos = new Map((await db.medicationBatch.findMany({ where: { id: { in: list.map((m) => m.batchId).filter((x): x is number => x != null) } }, select: { id: true, batchNo: true } })).map((b) => [b.id, b.batchNo ?? ""]));
      return done(list.map((m) => [day(m.createdAt), m.type, m.medication.name, m.quantity, m.batchId ? batchNos.get(m.batchId) ?? "" : "", m.branch?.name ?? ""]));
    }
    case "finance_invoices": {
      // Strictly branch-owned: visit invoices of the visit's branch, visit-less invoices of the patient's home branch. No central/registrar widening.
      const ownBranch = isAdmin ? branchId : actor.branchId;
      const owned: Prisma.InvoiceWhereInput = ownBranch != null ? { OR: [{ visit: { branchId: ownBranch } }, { visitId: null, patient: { branchId: ownBranch } }] } : {};
      const where: Prisma.InvoiceWhereInput = { AND: [owned, { issuedAt: dates! }] };
      const n = await db.invoice.count({ where }); await guardCount(n);
      if (countOnly) return { ...done([]), count: n };
      const list = await db.invoice.findMany({ where, orderBy: { issuedAt: "asc" }, take, select: { issuedAt: true, amount: true, paidAmount: true, status: true, visitId: true, visit: { select: { branch: { select: { name: true } } } }, patient: { select: { fileNumber: true, branch: { select: { name: true } } } } } });
      return done(list.map((i) => [day(i.issuedAt), i.amount, i.paidAmount, i.status, i.patient.fileNumber, (i.visitId ? i.visit?.branch?.name : i.patient.branch?.name) ?? "", i.visitId ? "نعم" : "لا"]));
    }
  }
  return deny("UNKNOWN_DOMAIN", "نوع التصدير غير مدعوم");
}
