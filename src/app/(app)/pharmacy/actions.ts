"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

// يعيد حساب كمية الدواء = مجموع دفعاته (مصدر الحقيقة)
async function recomputeMedicationQuantity(medicationId: number) {
  const agg = await prisma.medicationBatch.aggregate({ where: { medicationId }, _sum: { quantity: true } });
  await prisma.medication.update({ where: { id: medicationId }, data: { quantity: Math.max(0, agg._sum.quantity ?? 0) } });
}

async function pharmacistInfo() {
  const s = await requireSession();
  return { id: (s?.user as any)?.id as string | undefined, name: (s?.user?.name as string | undefined) ?? null };
}

function rxCount(rx: { count: number | null; quantity: string | null }) {
  if (rx.count && rx.count > 0) return rx.count;
  const m = (rx.quantity || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// تسجيل حركة مخزون
async function logMovement(d: {
  type: "IN" | "DISPENSE" | "DISPOSE" | "ADJUST"; medicationId: number; quantity: number;
  batchId?: number | null; reason?: string | null; byName?: string | null;
  patientId?: string | null; patientName?: string | null; prescriptionId?: string | null;
}) {
  try {
    await prisma.stockMovement.create({ data: {
      type: d.type, medicationId: d.medicationId, quantity: Math.abs(d.quantity),
      batchId: d.batchId ?? null, reason: d.reason ?? null, byName: d.byName ?? null,
      patientId: d.patientId ?? null, patientName: d.patientName ?? null, prescriptionId: d.prescriptionId ?? null,
    }});
  } catch {}
}

// ===== تجهيز وصفة (كمية يدوية) — خصم FEFO + تسجيل حركة لكل دفعة =====
export async function dispensePrescription(prescriptionId: string, fd: FormData) {
  await assertPerm("pharmacy.dispense");
  const who = await pharmacistInfo();
  const partial = fd.get("partial")?.toString() === "1";
  if (partial) await assertPerm("pharmacy.dispense.partial");
  const result = await prisma.$transaction(async (tx) => {
    const rx = await tx.prescription.findUnique({ where: { id: prescriptionId }, include: { patient: { select: { fullName: true } } } });
    if (!rx || rx.isDispensed || rx.status === "DISPENSED") return { patientId: rx?.patientId, repeated: true };
    if (rx.prescriptionType !== "INTERNAL" || rx.eligibilityDecision !== "ELIGIBLE") throw new Error("الوصفة ليست وصفة داخلية مؤهلة للصرف");
    if (!rx.medicationId) throw new Error("اربط الوصفة بمادة مخزنية قبل الصرف");
    const targetTotal = rxCount(rx);
    const remainingNeed = Math.max(0, targetTotal - rx.dispensedQty);
    if (remainingNeed <= 0) return { patientId: rx.patientId, repeated: true };
    const requested = Math.max(1, Number(fd.get("qty")) || remainingNeed);
    const want = partial ? Math.min(requested, remainingNeed) : remainingNeed;
    const now = new Date();
    const batches = await tx.medicationBatch.findMany({ where: { medicationId: rx.medicationId, quantity: { gt: 0 }, OR: [{ expiryDate: null }, { expiryDate: { gt: now } }] }, orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { id: "asc" }] });
    const available = batches.reduce((sum, batch) => sum + batch.quantity, 0);
    if (available < want) throw new Error(partial ? "الكمية المطلوبة غير متوفرة" : "المخزون غير كافٍ للصرف الكامل");
    let left = want;
    for (const batch of batches) {
      if (left <= 0) break;
      const take = Math.min(batch.quantity, left);
      await tx.medicationBatch.update({ where: { id: batch.id }, data: { quantity: { decrement: take } } });
      await tx.stockMovement.create({ data: { type: "DISPENSE", medicationId: rx.medicationId, batchId: batch.id, quantity: take, byName: who.name, patientId: rx.patientId, patientName: rx.patient.fullName, prescriptionId: rx.id } });
      left -= take;
    }
    const totalDispensed = rx.dispensedQty + want;
    const isFull = totalDispensed >= targetTotal;
    await tx.prescription.update({ where: { id: prescriptionId }, data: { dispensedQty: totalDispensed, isDispensed: isFull, status: isFull ? "DISPENSED" : "PARTIAL", dispensedAt: new Date(), dispensedBy: who.name } });
    const stock = await tx.medicationBatch.aggregate({ where: { medicationId: rx.medicationId }, _sum: { quantity: true } });
    const medication = await tx.medication.update({ where: { id: rx.medicationId }, data: { quantity: Math.max(0, stock._sum.quantity || 0) } });
    await tx.auditLog.create({ data: { userId: who.id, action: "UPDATE", tableName: "prescriptions", recordId: prescriptionId, newValue: { status: isFull ? "DISPENSED" : "PARTIAL", dispensedNow: want, remaining: Math.max(0, targetTotal - totalDispensed) } } });
    if (medication.quantity <= medication.minQuantity) await tx.notification.create({ data: { targetRole: "PHARMACIST", title: medication.quantity <= 0 ? "نفاد مادة مخزنية" : "انخفاض مادة مخزنية", body: "راجع شاشة المخزون لإعادة التزويد.", link: "/pharmacy/stock" } });
    return { patientId: rx.patientId, repeated: false };
  }, { isolationLevel: "Serializable" });
  revalidatePath("/pharmacy");
  if (result.patientId) revalidatePath(`/patients/${result.patientId}`);
}

// رفض وصفة مع سبب
export async function rejectPrescription(prescriptionId: string, fd: FormData) {
  await assertPerm("pharmacy.dispense");
  const who = await pharmacistInfo();
  const current = await prisma.prescription.findUniqueOrThrow({ where: { id: prescriptionId } });
  if (current.dispensedQty > 0 || current.isDispensed) throw new Error("لا يمكن رفض وصفة بدأ صرفها");
  await prisma.prescription.update({ where: { id: prescriptionId }, data: {
    status: "REJECTED", isDispensed: false, rejectReason: fd.get("reason")?.toString() || "غير محدّد",
  }});
  await logAudit({ userId: who.id, action: "UPDATE", tableName: "prescriptions", recordId: prescriptionId, newValue: { status: "REJECTED" } });
  revalidatePath("/pharmacy");
}

// إعادة وصفة للقائمة (تراجع عن رفض/تجهيز)
export async function reopenPrescription(prescriptionId: string) {
  await assertPerm("pharmacy.dispense");
  const current = await prisma.prescription.findUniqueOrThrow({ where: { id: prescriptionId } });
  if (current.dispensedQty > 0 || current.isDispensed || current.status === "DISPENSED") throw new Error("لا يمكن إعادة فتح وصفة بعد الصرف");
  await prisma.prescription.update({ where: { id: prescriptionId }, data: { status: "PENDING", isDispensed: false, rejectReason: null } });
  revalidatePath("/pharmacy");
}

// ===== المواد =====
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

// ===== الدفعات =====
export async function addBatch(medicationId: number, fd: FormData) {
  await assertPerm("pharmacy.batch");
  const who = await pharmacistInfo();
  const quantity = Math.max(0, Number(fd.get("quantity") ?? 0));
  const exp = fd.get("expiryDate")?.toString();
  const supplierId = fd.get("supplierId") ? Number(fd.get("supplierId")) : null;
  const recv = fd.get("receivedAt")?.toString();
  const batch = await prisma.medicationBatch.create({ data: {
    medicationId, quantity, batchNo: fd.get("batchNo")?.toString() || null,
    expiryDate: exp ? new Date(exp) : null, supplierId,
    receivedAt: recv ? new Date(recv) : new Date(), note: fd.get("note")?.toString() || null,
  }});
  if (quantity > 0) await logMovement({ type: "IN", medicationId, batchId: batch.id, quantity, byName: who.name, reason: "إدخال دفعة" });
  await recomputeMedicationQuantity(medicationId);
  revalidatePath("/pharmacy");
}

export async function updateBatch(batchId: number, fd: FormData) {
  await assertPerm("pharmacy.batch");
  const who = await pharmacistInfo();
  const b = await prisma.medicationBatch.findUnique({ where: { id: batchId } });
  if (!b) return;
  const newQty = Math.max(0, Number(fd.get("quantity") ?? b.quantity));
  const exp = fd.get("expiryDate")?.toString();
  await prisma.medicationBatch.update({ where: { id: batchId }, data: {
    quantity: newQty, batchNo: fd.get("batchNo")?.toString() || null,
    expiryDate: exp ? new Date(exp) : null,
    supplierId: fd.get("supplierId") ? Number(fd.get("supplierId")) : null,
  }});
  const delta = newQty - b.quantity;
  if (delta !== 0) await logMovement({ type: "ADJUST", medicationId: b.medicationId, batchId, quantity: delta, byName: who.name, reason: fd.get("reason")?.toString() || "تعديل يدوي" });
  await recomputeMedicationQuantity(b.medicationId);
  revalidatePath("/pharmacy");
}

// إتلاف دفعة (منتهية مثلاً) — يصفّر كميتها ويسجّل إتلاف
export async function disposeBatch(batchId: number, fd: FormData) {
  await assertPerm("pharmacy.batch");
  const who = await pharmacistInfo();
  const b = await prisma.medicationBatch.findUnique({ where: { id: batchId } });
  if (!b) return;
  if (b.quantity > 0) await logMovement({ type: "DISPOSE", medicationId: b.medicationId, batchId, quantity: b.quantity, byName: who.name, reason: fd.get("reason")?.toString() || "إتلاف دفعة منتهية" });
  await prisma.medicationBatch.update({ where: { id: batchId }, data: { quantity: 0 } });
  await recomputeMedicationQuantity(b.medicationId);
  revalidatePath("/pharmacy");
}

export async function deleteBatch(batchId: number) {
  await assertAdminDelete();
  await assertPerm("pharmacy.batch");
  const who = await pharmacistInfo();
  const b = await prisma.medicationBatch.findUnique({ where: { id: batchId } });
  if (!b) return;
  if (b.quantity > 0) await logMovement({ type: "ADJUST", medicationId: b.medicationId, batchId, quantity: -b.quantity, byName: who.name, reason: "حذف دفعة" });
  await prisma.medicationBatch.delete({ where: { id: batchId } });
  await recomputeMedicationQuantity(b.medicationId);
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
