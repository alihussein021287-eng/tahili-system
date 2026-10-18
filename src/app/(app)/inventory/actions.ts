"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPerm } from "@/lib/access";
import { revalidatePath, revalidateTag } from "next/cache";

// Independent branch pharmacies: quantities exist only as branch-owned batches changed through the pharmacy actions
// (receiving, adjustment with reason, disposal, dispensing). A free-form quantity edit of the shared catalog is refused.
export async function adjustStock(_id: number, _delta: number) {
  await assertPerm("inventory.manage");
  throw new Error("تعديل الكميات يتم من شاشة مخزون صيدلية الفرع (دفعات وحركات)، لا من الفهرس المشترك");
}

export async function setStockSettings(id: number, fd: FormData) {
  await assertPerm("inventory.manage");
  await prisma.medication.update({ where: { id }, data: {
    minQuantity: Number(fd.get("minQuantity") ?? 0),
    unit: fd.get("unit")?.toString() || null,
  }});
  await logAudit({ action: "UPDATE", tableName: "medications", recordId: String(id) });
  revalidatePath("/inventory");
}

export async function createMedication(fd: FormData) {
  await assertPerm("inventory.manage");
  const name = fd.get("name")?.toString().trim();
  if (!name) return;
  const created = await prisma.medication.upsert({
    where: { name }, update: {},
    create: { name, quantity: 0, minQuantity: Number(fd.get("minQuantity") ?? 0), unit: fd.get("unit")?.toString() || null },
  });
  await logAudit({ action: "CREATE", tableName: "medications", recordId: String(created.id) });
  revalidatePath("/inventory"); revalidateTag("lookups", { expire: 0 });
}
