"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { assertPerm, currentPerms, requireSession } from "@/lib/access";
import { saveFile } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function actor(permission: string) {
  const session = await requireSession(); await assertPerm(permission);
  return { id: (session.user as any).id as string, name: session.user?.name || "", permissions: await currentPerms() };
}
const orderNo = () => `PO-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
const receiptNo = () => `GRN-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;

function refresh(id?: string) {
  revalidatePath("/pharmacy/purchases"); revalidatePath("/pharmacy/purchases/reports"); revalidatePath("/pharmacy/stock"); revalidatePath("/inventory"); revalidatePath("/pharmacy");
  if (id) revalidatePath(`/pharmacy/purchases/${id}`);
}

export async function createPurchaseOrder(fd: FormData) {
  const who = await actor("pharmacy.purchase.create");
  const attachment = fd.get("attachment") as File | null;
  const saved = attachment && attachment.size > 0 ? await saveFile(attachment) : null;
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({ data: { orderNo: orderNo(), supplierId: Number(fd.get("supplierId")), expectedDeliveryDate: fd.get("expectedDeliveryDate") ? new Date(fd.get("expectedDeliveryDate")!.toString()) : null, notes: fd.get("notes")?.toString() || null, createdById: who.id } });
    if (saved) await tx.purchaseOrderAttachment.create({ data: { purchaseOrderId: created.id, fileName: saved.name, fileUrl: `/api/files/${saved.key}` } });
    await tx.auditLog.create({ data: { userId: who.id, action: "CREATE", tableName: "purchase_orders", recordId: created.id, newValue: { orderNo: created.orderNo, supplierId: created.supplierId, status: created.status } } });
    return created;
  });
  redirect(`/pharmacy/purchases/${order.id}`);
}

export async function addPurchaseItem(orderId: string, fd: FormData) {
  const who = await actor("pharmacy.purchase.create");
  await prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== "DRAFT") throw new Error("يمكن تعديل بنود المسودة فقط");
    const item = await tx.purchaseOrderItem.create({ data: { purchaseOrderId: orderId, medicationId: fd.get("medicationId") ? Number(fd.get("medicationId")) : null, materialName: fd.get("materialName")?.toString() || null, unit: fd.get("unit")?.toString() || "وحدة", orderedQuantity: Math.max(1, Number(fd.get("orderedQuantity")) || 1), unitPrice: who.permissions.has("pharmacy.purchase.prices") && fd.get("unitPrice") ? fd.get("unitPrice")!.toString() : null, batchNo: fd.get("batchNo")?.toString() || null, expiryDate: fd.get("expiryDate") ? new Date(fd.get("expiryDate")!.toString()) : null } });
    await tx.auditLog.create({ data: { userId: who.id, action: "CREATE", tableName: "purchase_order_items", recordId: item.id, newValue: { purchaseOrderId: orderId, medicationId: item.medicationId, orderedQuantity: item.orderedQuantity } } });
  }); refresh(orderId);
}

export async function transitionPurchaseOrder(orderId: string, status: "PENDING_APPROVAL" | "APPROVED" | "ORDERED" | "CANCELLED", fd: FormData) {
  const permission = status === "APPROVED" ? "pharmacy.purchase.approve" : "pharmacy.purchase.create";
  const who = await actor(permission);
  await prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (["FULLY_RECEIVED","CANCELLED"].includes(order.status)) throw new Error("لا يمكن تعديل أمر مكتمل أو ملغى");
    const allowed: Record<string,string[]> = { DRAFT:["PENDING_APPROVAL","CANCELLED"], PENDING_APPROVAL:["APPROVED","CANCELLED"], APPROVED:["ORDERED","CANCELLED"], ORDERED:["CANCELLED"] };
    if (!allowed[order.status]?.includes(status)) throw new Error("انتقال حالة غير صالح");
    if (status === "PENDING_APPROVAL" && order.items.length === 0) throw new Error("أضف بنداً واحداً على الأقل");
    const updated = await tx.purchaseOrder.update({ where: { id: orderId }, data: { status, approvedById: status === "APPROVED" ? who.id : order.approvedById, approvedAt: status === "APPROVED" ? new Date() : order.approvedAt, cancellationReason: status === "CANCELLED" ? fd.get("reason")?.toString() || "ملغى إدارياً" : null } });
    await tx.auditLog.create({ data: { userId: who.id, action: "UPDATE", tableName: "purchase_orders", recordId: orderId, oldValue: { status: order.status }, newValue: { status } } });
    if (status === "PENDING_APPROVAL") await tx.notification.create({ data: { targetRole: "MANAGER", title: "أمر شراء ينتظر الاعتماد", body: "يوجد أمر شراء يحتاج مراجعة.", link: `/pharmacy/purchases/${orderId}` } });
    if (status === "APPROVED") await tx.notification.create({ data: { targetUserId: order.createdById, title: "اعتمد أمر الشراء", body: "يمكن متابعة الطلب مع المورد.", link: `/pharmacy/purchases/${orderId}` } });
    return updated;
  }); refresh(orderId);
}

export async function receivePurchaseItem(orderId: string, itemId: string, fd: FormData) {
  const who = await actor("pharmacy.purchase.receive");
  const idempotencyKey = fd.get("idempotencyKey")?.toString() || "";
  const accepted = Math.max(0, Number(fd.get("acceptedQuantity")) || 0);
  const rejected = Math.max(0, Number(fd.get("rejectedQuantity")) || 0);
  const damaged = Math.max(0, Number(fd.get("damagedQuantity")) || 0);
  if (!idempotencyKey || accepted + rejected + damaged <= 0) throw new Error("أدخل كميات الاستلام");
  await prisma.$transaction(async (tx) => {
    if (await tx.purchaseReceipt.findUnique({ where: { idempotencyKey } })) return;
    const item = await tx.purchaseOrderItem.findFirst({ where: { id: itemId, purchaseOrderId: orderId }, include: { purchaseOrder: true, medication: true } });
    if (!item || !["APPROVED","ORDERED","PARTIALLY_RECEIVED"].includes(item.purchaseOrder.status)) throw new Error("الأمر غير متاح للاستلام");
    const remaining = Math.max(0, item.orderedQuantity - item.receivedQuantity);
    const over = accepted > remaining;
    const overrideReason = fd.get("overrideReason")?.toString().trim() || null;
    if (over && (!who.permissions.has("pharmacy.purchase.override") || !overrideReason)) throw new Error("الكمية المقبولة تتجاوز المتبقي");
    if (accepted > 0 && !item.medicationId) throw new Error("اربط البند بمادة مخزنية قبل قبول الكمية");
    const receipt = await tx.purchaseReceipt.create({ data: { purchaseOrderId: orderId, receiptNo: receiptNo(), idempotencyKey, createdById: who.id, notes: fd.get("notes")?.toString() || null, overrideReason } });
    await tx.purchaseReceiptItem.create({ data: { receiptId: receipt.id, purchaseItemId: itemId, acceptedQuantity: accepted, rejectedQuantity: rejected, damagedQuantity: damaged, batchNo: fd.get("batchNo")?.toString() || item.batchNo, expiryDate: fd.get("expiryDate") ? new Date(fd.get("expiryDate")!.toString()) : item.expiryDate, rejectionReason: fd.get("rejectionReason")?.toString() || null } });
    let batchId: number | null = null;
    if (accepted > 0 && item.medicationId) {
      const batch = await tx.medicationBatch.create({ data: { medicationId: item.medicationId, supplierId: item.purchaseOrder.supplierId, batchNo: fd.get("batchNo")?.toString() || item.batchNo, quantity: accepted, expiryDate: fd.get("expiryDate") ? new Date(fd.get("expiryDate")!.toString()) : item.expiryDate, purchaseOrderId: orderId, purchaseItemId: itemId, purchaseReceiptId: receipt.id, note: "استلام أمر شراء" } });
      batchId = batch.id;
      await tx.stockMovement.create({ data: { type: "IN", medicationId: item.medicationId, batchId, quantity: accepted, reason: "استلام أمر شراء", byName: who.name, purchaseReceiptId: receipt.id } });
      const total = await tx.medicationBatch.aggregate({ where: { medicationId: item.medicationId }, _sum: { quantity: true } });
      await tx.medication.update({ where: { id: item.medicationId }, data: { quantity: Math.max(0, total._sum.quantity || 0) } });
    }
    await tx.purchaseOrderItem.update({ where: { id: itemId }, data: { receivedQuantity: { increment: accepted }, rejectedQuantity: { increment: rejected }, damagedQuantity: { increment: damaged } } });
    const rows = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: orderId }, select: { orderedQuantity: true, receivedQuantity: true, id: true } });
    const full = rows.every((row) => row.receivedQuantity >= row.orderedQuantity);
    const status = full ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED";
    await tx.purchaseOrder.update({ where: { id: orderId }, data: { status } });
    await tx.auditLog.create({ data: { userId: who.id, action: "CREATE", tableName: "purchase_receipts", recordId: receipt.id, newValue: { purchaseOrderId: orderId, itemId, accepted, rejected, damaged, batchId, overReceived: over } } });
    await tx.notification.create({ data: { targetUserId: item.purchaseOrder.createdById, title: full ? "اكتمل استلام أمر الشراء" : "استلام جزئي يحتاج متابعة", body: full ? "اكتمل الاستلام وتحديث المخزون." : "سُجل استلام جزئي وبقيت كميات للمتابعة.", link: `/pharmacy/purchases/${orderId}` } });
  }, { isolationLevel: "Serializable" }); refresh(orderId);
}
