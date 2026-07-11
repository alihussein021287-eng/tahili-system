"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPerm } from "@/lib/access";
import { revalidatePath, revalidateTag } from "next/cache";

export async function adjustStock(id: number, delta: number) {
  await assertPerm("inventory.manage");
  const med = await prisma.medication.findUnique({ where: { id } });
  if (!med) return;
  const q = Math.max(0, med.quantity + delta);
  await prisma.medication.update({ where: { id }, data: { quantity: q } });
  await logAudit({ action: "UPDATE", tableName: "medications", recordId: String(id), newValue: { quantity: q, delta } });
  revalidatePath("/inventory");
}

export async function setStockSettings(id: number, fd: FormData) {
  await assertPerm("inventory.manage");
  await prisma.medication.update({ where: { id }, data: {
    quantity: Number(fd.get("quantity") ?? 0),
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
    create: { name, quantity: Number(fd.get("quantity") ?? 0), minQuantity: Number(fd.get("minQuantity") ?? 0), unit: fd.get("unit")?.toString() || null },
  });
  await logAudit({ action: "CREATE", tableName: "medications", recordId: String(created.id) });
  revalidatePath("/inventory"); revalidateTag("lookups", { expire: 0 });
}
