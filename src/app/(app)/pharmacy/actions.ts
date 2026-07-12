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
  const rx = await prisma.prescription.findUnique({ where: { id: prescriptionId }, include: { patient: { select: { fullName: true } } } });
  if (!rx || rx.isDispensed) return;

  let want = Number(fd.get("qty") ?? 0);
  if (!want || want <= 0) want = rxCount(rx);
  const targetTotal = Math.max(rxCount(rx), want);
  const remainingNeed = Math.max(0, targetTotal - (rx.dispensedQty ?? 0));
  want = Math.min(want, remainingNeed || want);

  let dispensedNow = 0;
  if (rx.medicationId && want > 0) {
    let remaining = want;
    const batches = await prisma.medicationBatch.findMany({
      where: { medicationId: rx.medicationId, quantity: { gt: 0 } },
      orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    });
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity, remaining);
      await prisma.medicationBatch.update({ where: { id: b.id }, data: { quantity: b.quantity - take } });
      await logMovement({ type: "DISPENSE", medicationId: rx.medicationId, batchId: b.id, quantity: take, byName: who.name, patientId: rx.patientId, patientName: rx.patient?.fullName ?? null, prescriptionId: rx.id });
      remaining -= take;
      dispensedNow += take;
    }
    await recomputeMedicationQuantity(rx.medicationId);
  }

  const totalDispensed = (rx.dispensedQty ?? 0) + dispensedNow;
  const isFull = rx.medicationId ? (targetTotal > 0 && totalDispensed >= targetTotal) : !partial;
  await prisma.prescription.update({ where: { id: prescriptionId }, data: {
    dispensedQty: totalDispensed,
    isDispensed: isFull,
    status: isFull ? "DISPENSED" : (dispensedNow > 0 || partial ? "PARTIAL" : "PENDING"),
    dispensedAt: dispensedNow > 0 ? new Date() : rx.dispensedAt,
    dispensedBy: dispensedNow > 0 ? who.name : rx.dispensedBy,
  }});
  await logAudit({ userId: who.id, action: "UPDATE", tableName: "prescriptions", recordId: prescriptionId, newValue: { status: isFull ? "DISPENSED" : "PARTIAL", qty: dispensedNow, requested: want, targetTotal } });
  revalidatePath("/pharmacy");
  if (rx.patientId) revalidatePath(`/patients/${rx.patientId}`);
}

// رفض وصفة مع سبب
export async function rejectPrescription(prescriptionId: string, fd: FormData) {
  await assertPerm("pharmacy.dispense");
  const who = await pharmacistInfo();
  await prisma.prescription.update({ where: { id: prescriptionId }, data: {
    status: "REJECTED", isDispensed: false, rejectReason: fd.get("reason")?.toString() || "غير محدّد",
  }});
  await logAudit({ userId: who.id, action: "UPDATE", tableName: "prescriptions", recordId: prescriptionId, newValue: { status: "REJECTED" } });
  revalidatePath("/pharmacy");
}

// إعادة وصفة للقائمة (تراجع عن رفض/تجهيز)
export async function reopenPrescription(prescriptionId: string) {
  await assertPerm("pharmacy.dispense");
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
