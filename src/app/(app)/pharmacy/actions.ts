"use server";
import { withSerializableRetry } from "@/lib/serializable-retry";
import { prisma } from "@/lib/db";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { assertPharmacyPrescriptionScope } from "@/lib/pharmacy-scope";
import { requireStockActor, type StockActor } from "@/lib/pharmacy-stock";
import type { Prisma } from "@prisma/client";

/**
 * Independent branch pharmacies: every stock change below is bound to the acting pharmacist's ACTIVE branch
 * (requireStockActor). Batches carry branchId; a batch of another branch or an unassigned legacy batch can never be
 * changed here (legacy stock is assigned only by the reconciliation procedure). No transfer, pooling or central bypass.
 */
type Tx = Prisma.TransactionClient;

// Medication.quantity is a legacy all-branch aggregate (sum of every batch); branch quantities always come from batches.
async function recomputeMedicationQuantity(db: Tx | typeof prisma, medicationId: number) {
  const agg = await db.medicationBatch.aggregate({ where: { medicationId }, _sum: { quantity: true } });
  await db.medication.update({ where: { id: medicationId }, data: { quantity: Math.max(0, agg._sum.quantity ?? 0) } });
}

function rxCount(rx: { count: number | null; quantity: string | null }) {
  if (rx.count && rx.count > 0) return rx.count;
  const m = (rx.quantity || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

async function branchQuantity(db: Tx, branchId: number, medicationId: number) {
  const agg = await db.medicationBatch.aggregate({ where: { branchId, medicationId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

async function notifyLowStock(db: Tx, branchId: number, medication: { id: number; name: string; minQuantity: number }, qty: number) {
  if (qty > medication.minQuantity) return;
  const ids = (await db.user.findMany({ where: { role: "PHARMACIST", isActive: true, branchId }, select: { id: true } })).map((u) => u.id);
  if (!ids.length) return;
  await db.notification.createMany({ data: ids.map((targetUserId) => ({
    targetUserId, title: qty <= 0 ? "نفاد مادة مخزنية" : "انخفاض مادة مخزنية",
    body: `${medication.name} — راجع مخزون صيدلية فرعك لإعادة التزويد.`, link: "/pharmacy/stock",
  })) });
}

class StockError extends Error {}
const SCOPE_RETRY = "تغيّر المخزون أثناء الصرف؛ أعد المحاولة";

// ===== تجهيز وصفة (كمية يدوية) — خصم FEFO من مخزون فرع الصيدلي فقط + حركة لكل دفعة =====
export async function dispensePrescription(prescriptionId: string, fd: FormData) {
  await assertPerm("pharmacy.dispense");
  const actor = await requireStockActor();
  const { branchId } = await assertPharmacyPrescriptionScope(prescriptionId);
  if (branchId !== actor.branchId) throw new Error("هذه الوصفة خارج نطاق صيدلية فرعك");
  const partial = fd.get("partial")?.toString() === "1";
  if (partial) await assertPerm("pharmacy.dispense.partial");
  const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const rx = await tx.prescription.findUnique({ where: { id: prescriptionId }, include: { patient: { select: { fullName: true } } } });
    if (!rx) throw new Error("الوصفة غير موجودة");
    if (rx.originBranchId !== actor.branchId) throw new Error("هذه الوصفة خارج نطاق صيدلية فرعك");
    if (rx.isDispensed || rx.status === "DISPENSED") return { patientId: rx.patientId, repeated: true };
    if (rx.status === "REJECTED") throw new Error("الوصفة ليست مؤهلة للصرف: تم رفضها");
    if (rx.prescriptionType !== "INTERNAL" || rx.eligibilityDecision !== "ELIGIBLE") throw new Error("الوصفة ليست وصفة داخلية مؤهلة للصرف");
    if (!rx.medicationId) throw new Error("اربط الوصفة بمادة مخزنية قبل الصرف");
    // Revalidate the encounter: explicit visit of the same patient whose receiving branch is the origin and this pharmacy.
    if (!rx.visitId) throw new Error("الوصفة غير مرتبطة بزيارة موثقة (تحتاج مطابقة قبل الصرف)");
    const visit = await tx.visit.findFirst({ where: { id: rx.visitId, patientId: rx.patientId }, select: { branchId: true, branch: { select: { isActive: true } } } });
    if (!visit || !visit.branch?.isActive || visit.branchId !== rx.originBranchId || visit.branchId !== actor.branchId) throw new Error("زيارة الوصفة لا تطابق صيدلية فرعك (تحتاج مطابقة)");
    const targetTotal = rxCount(rx);
    const remainingNeed = Math.max(0, targetTotal - rx.dispensedQty);
    if (remainingNeed <= 0) return { patientId: rx.patientId, repeated: true };
    const requested = Math.max(1, Number(fd.get("qty")) || remainingNeed);
    const want = partial ? Math.min(requested, remainingNeed) : remainingNeed;
    const now = new Date();
    const batches = await tx.medicationBatch.findMany({
      where: { branchId: actor.branchId, medicationId: rx.medicationId, quantity: { gt: 0 }, OR: [{ expiryDate: null }, { expiryDate: { gt: now } }] },
      orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    });
    const available = batches.reduce((sum, batch) => sum + batch.quantity, 0);
    if (available < want) throw new Error(partial ? "الكمية المطلوبة غير متوفرة" : "المخزون غير كافٍ للصرف الكامل");
    let left = want;
    for (const batch of batches) {
      if (left <= 0) break;
      const take = Math.min(batch.quantity, left);
      const done = await tx.medicationBatch.updateMany({ where: { id: batch.id, branchId: actor.branchId, quantity: { gte: take } }, data: { quantity: { decrement: take } } });
      if (done.count !== 1) throw new StockError(SCOPE_RETRY);
      await tx.stockMovement.create({ data: {
        type: "DISPENSE", medicationId: rx.medicationId, batchId: batch.id, quantity: take, branchId: actor.branchId, actorId: actor.userId,
        byName: actor.name, patientId: rx.patientId, patientName: rx.patient.fullName, prescriptionId: rx.id,
      } });
      left -= take;
    }
    const totalDispensed = rx.dispensedQty + want;
    const isFull = totalDispensed >= targetTotal;
    const upd = await tx.prescription.updateMany({
      where: { id: prescriptionId, originBranchId: actor.branchId, dispensedQty: rx.dispensedQty, status: { not: "REJECTED" } },
      data: { dispensedQty: totalDispensed, isDispensed: isFull, status: isFull ? "DISPENSED" : "PARTIAL", dispensedAt: new Date(), dispensedBy: actor.name, dispensingBranchId: actor.branchId },
    });
    if (upd.count !== 1) throw new StockError(SCOPE_RETRY);
    await recomputeMedicationQuantity(tx, rx.medicationId);
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "prescriptions", recordId: prescriptionId, newValue: { status: isFull ? "DISPENSED" : "PARTIAL", dispensedNow: want, remaining: Math.max(0, targetTotal - totalDispensed), dispensingBranchId: actor.branchId } } });
    const medication = await tx.medication.findUniqueOrThrow({ where: { id: rx.medicationId }, select: { id: true, name: true, minQuantity: true } });
    await notifyLowStock(tx, actor.branchId, medication, await branchQuantity(tx, actor.branchId, rx.medicationId));
    return { patientId: rx.patientId, repeated: false };
  }, { isolationLevel: "Serializable" }));
  revalidatePath("/pharmacy");
  if (result.patientId) revalidatePath(`/patients/${result.patientId}`);
}

export type PharmacyActionState = { ok: boolean; message: string } | null;

const KNOWN_REASONS = ["المخزون غير كافٍ", "الكمية المطلوبة غير متوفرة", "الوصفة ليست", "اربط الوصفة", "خارج نطاق", "غير مصرّح", "الوصفة غير موجودة", "لا يمكن رفض", "لا يمكن إعادة فتح", "غير مرتبطة بفرع", "غير مرتبطة بزيارة", "زيارة الوصفة", "لا يوجد فرع صيدلية", "تغيّر المخزون"];

/** Runs a dispensing step and turns a refusal into an inline, understandable message (the transaction itself still fails closed). */
async function withFeedback(run: () => Promise<void>, okMessage: string): Promise<PharmacyActionState> {
  try {
    await run();
    return { ok: true, message: okMessage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "P2034") return { ok: false, message: "الخادم مشغول حالياً؛ لم يُنفَّذ الإجراء ولم يتغيّر المخزون. أعد المحاولة." };
    const known = KNOWN_REASONS.find((reason) => message.includes(reason));
    return { ok: false, message: known ? message : "تعذّر تنفيذ الإجراء؛ لم يتغيّر المخزون ولا حالة الوصفة." };
  }
}

export async function dispenseWithFeedback(prescriptionId: string, _prev: PharmacyActionState, fd: FormData) {
  return withFeedback(() => dispensePrescription(prescriptionId, fd), "تم تسجيل الصرف");
}

export async function rejectWithFeedback(prescriptionId: string, _prev: PharmacyActionState, fd: FormData) {
  return withFeedback(() => rejectPrescription(prescriptionId, fd), "تم رفض الوصفة");
}

// رفض وصفة مع سبب — مشروط بعدم بدء الصرف (يمنع السباق مع الصرف)
export async function rejectPrescription(prescriptionId: string, fd: FormData) {
  await assertPerm("pharmacy.dispense");
  const actor = await requireStockActor();
  const { branchId } = await assertPharmacyPrescriptionScope(prescriptionId);
  if (branchId !== actor.branchId) throw new Error("هذه الوصفة خارج نطاق صيدلية فرعك");
  const upd = await prisma.prescription.updateMany({
    where: { id: prescriptionId, originBranchId: actor.branchId, dispensedQty: 0, isDispensed: false, status: { not: "DISPENSED" } },
    data: { status: "REJECTED", isDispensed: false, rejectReason: fd.get("reason")?.toString() || "غير محدّد" },
  });
  if (upd.count !== 1) throw new Error("لا يمكن رفض وصفة بدأ صرفها");
  await logAudit({ userId: actor.userId, action: "UPDATE", tableName: "prescriptions", recordId: prescriptionId, newValue: { status: "REJECTED", branchId: actor.branchId } });
  revalidatePath("/pharmacy");
}

// إعادة وصفة للقائمة (تراجع عن رفض)
export async function reopenPrescription(prescriptionId: string) {
  await assertPerm("pharmacy.dispense");
  const actor = await requireStockActor();
  const { branchId } = await assertPharmacyPrescriptionScope(prescriptionId);
  if (branchId !== actor.branchId) throw new Error("هذه الوصفة خارج نطاق صيدلية فرعك");
  const upd = await prisma.prescription.updateMany({
    where: { id: prescriptionId, originBranchId: actor.branchId, dispensedQty: 0, isDispensed: false, status: { not: "DISPENSED" } },
    data: { status: "PENDING", isDispensed: false, rejectReason: null },
  });
  if (upd.count !== 1) throw new Error("لا يمكن إعادة فتح وصفة بعد الصرف");
  await logAudit({ userId: actor.userId, action: "UPDATE", tableName: "prescriptions", recordId: prescriptionId, newValue: { status: "PENDING", reopened: true, branchId: actor.branchId } });
  revalidatePath("/pharmacy");
}

// ===== المواد (فهرس مشترك؛ لا كميات) =====
export async function createMedication(fd: FormData) {
  await assertPerm("pharmacy.batch");
  const name = fd.get("name")?.toString().trim();
  if (!name) return;
  await prisma.medication.upsert({ where: { name }, update: {}, create: { name, minQuantity: Number(fd.get("minQuantity") ?? 0), unit: fd.get("unit")?.toString() || null } });
  revalidatePath("/pharmacy");
}

export async function setMinQuantity(medicationId: number, fd: FormData) {
  await assertPerm("pharmacy.batch");
  await prisma.medication.update({ where: { id: medicationId }, data: { minQuantity: Number(fd.get("minQuantity") ?? 0), unit: fd.get("unit")?.toString() || null } });
  revalidatePath("/pharmacy");
}

// ===== الدفعات (دائماً ضمن فرع الصيدلي الفعّال) =====
async function ownBatch(tx: Tx, actor: StockActor, batchId: number) {
  const b = await tx.medicationBatch.findUnique({ where: { id: batchId } });
  if (!b) throw new Error("الدفعة غير موجودة");
  if (b.branchId == null) throw new Error("الدفعة غير مرتبطة بفرع صيدلية (تحتاج مطابقة قبل أي تعديل)");
  if (b.branchId !== actor.branchId) throw new Error("هذه الدفعة خارج نطاق صيدلية فرعك");
  return b;
}

export async function addBatch(medicationId: number, fd: FormData) {
  await assertPerm("pharmacy.batch");
  const actor = await requireStockActor();
  const quantity = Math.max(0, Math.floor(Number(fd.get("quantity") ?? 0)) || 0);
  const exp = fd.get("expiryDate")?.toString();
  const supplierId = fd.get("supplierId") ? Number(fd.get("supplierId")) : null;
  const recv = fd.get("receivedAt")?.toString();
  await prisma.$transaction(async (tx) => {
    const batch = await tx.medicationBatch.create({ data: {
      medicationId, branchId: actor.branchId, quantity, batchNo: fd.get("batchNo")?.toString() || null,
      expiryDate: exp ? new Date(exp) : null, supplierId,
      receivedAt: recv ? new Date(recv) : new Date(), note: fd.get("note")?.toString() || null,
    } });
    if (quantity > 0) await tx.stockMovement.create({ data: { type: "IN", medicationId, batchId: batch.id, quantity, branchId: actor.branchId, actorId: actor.userId, byName: actor.name, reason: "إدخال دفعة" } });
    await recomputeMedicationQuantity(tx, medicationId);
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", tableName: "medication_batches", recordId: String(batch.id), newValue: { branchId: actor.branchId, medicationId, quantity } } });
  });
  revalidatePath("/pharmacy");
}

export async function updateBatch(batchId: number, fd: FormData) {
  await assertPerm("pharmacy.batch");
  const actor = await requireStockActor();
  const exp = fd.get("expiryDate")?.toString();
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const b = await ownBatch(tx, actor, batchId);
    const newQty = Math.max(0, Math.floor(Number(fd.get("quantity") ?? b.quantity)) || 0);
    const upd = await tx.medicationBatch.updateMany({ where: { id: batchId, branchId: actor.branchId, quantity: b.quantity }, data: {
      quantity: newQty, batchNo: fd.get("batchNo")?.toString() || null,
      expiryDate: exp ? new Date(exp) : null,
      supplierId: fd.get("supplierId") ? Number(fd.get("supplierId")) : null,
    } });
    if (upd.count !== 1) throw new StockError(SCOPE_RETRY);
    const delta = newQty - b.quantity;
    if (delta !== 0) await tx.stockMovement.create({ data: { type: "ADJUST", medicationId: b.medicationId, batchId, quantity: Math.abs(delta), branchId: actor.branchId, actorId: actor.userId, byName: actor.name, reason: `${delta > 0 ? "+" : "-"} ${fd.get("reason")?.toString() || "تعديل يدوي"}` } });
    await recomputeMedicationQuantity(tx, b.medicationId);
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "medication_batches", recordId: String(batchId), newValue: { branchId: actor.branchId, from: b.quantity, to: newQty } } });
  }, { isolationLevel: "Serializable" }));
  revalidatePath("/pharmacy");
}

// إتلاف دفعة (منتهية مثلاً) — يصفّر كميتها ويسجّل إتلاف
export async function disposeBatch(batchId: number, fd: FormData) {
  await assertPerm("pharmacy.batch");
  const actor = await requireStockActor();
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const b = await ownBatch(tx, actor, batchId);
    const upd = await tx.medicationBatch.updateMany({ where: { id: batchId, branchId: actor.branchId, quantity: b.quantity }, data: { quantity: 0 } });
    if (upd.count !== 1) throw new StockError(SCOPE_RETRY);
    if (b.quantity > 0) await tx.stockMovement.create({ data: { type: "DISPOSE", medicationId: b.medicationId, batchId, quantity: b.quantity, branchId: actor.branchId, actorId: actor.userId, byName: actor.name, reason: fd.get("reason")?.toString() || "إتلاف دفعة منتهية" } });
    await recomputeMedicationQuantity(tx, b.medicationId);
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "medication_batches", recordId: String(batchId), newValue: { branchId: actor.branchId, disposed: b.quantity } } });
  }, { isolationLevel: "Serializable" }));
  revalidatePath("/pharmacy");
}

export async function deleteBatch(batchId: number) {
  await assertAdminDelete();
  await assertPerm("pharmacy.batch");
  const actor = await requireStockActor();
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const b = await ownBatch(tx, actor, batchId);
    if (b.quantity > 0) await tx.stockMovement.create({ data: { type: "ADJUST", medicationId: b.medicationId, batchId, quantity: b.quantity, branchId: actor.branchId, actorId: actor.userId, byName: actor.name, reason: "- حذف دفعة" } });
    await tx.medicationBatch.update({ where: { id: batchId }, data: { quantity: 0 } }).catch(() => {});
    // movements reference the batch; keep history by deleting only batches without movements, otherwise zero + keep
    const refs = await tx.stockMovement.count({ where: { batchId } });
    if (refs === 0) await tx.medicationBatch.delete({ where: { id: batchId } });
    await recomputeMedicationQuantity(tx, b.medicationId);
    await tx.auditLog.create({ data: { userId: actor.userId, action: "DELETE", tableName: "medication_batches", recordId: String(batchId), newValue: { branchId: actor.branchId } } });
  }, { isolationLevel: "Serializable" }));
  revalidatePath("/pharmacy");
}

// ===== الموردون =====
export async function addSupplier(fd: FormData) {
  await assertPerm("pharmacy.batch");
  const name = fd.get("name")?.toString().trim();
  if (!name) return;
  await prisma.supplier.upsert({ where: { name }, update: { phone: fd.get("phone")?.toString() || null, note: fd.get("note")?.toString() || null }, create: { name, phone: fd.get("phone")?.toString() || null, note: fd.get("note")?.toString() || null } });
  revalidatePath("/pharmacy");
}

export async function deleteSupplier(id: number) {
  await assertAdminDelete();
  await assertPerm("pharmacy.batch");
  try { await prisma.supplier.delete({ where: { id } }); } catch {}
  revalidatePath("/pharmacy");
}
