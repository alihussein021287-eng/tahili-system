"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

export async function addRoom(fd: FormData) {
  await assertPerm("beds.manage");
  const name = fd.get("name")?.toString().trim();
  const capacity = Number(fd.get("capacity")) || 1;
  if (name) { const r = await prisma.room.create({ data: { name, capacity, notes: fd.get("notes")?.toString() || null } }).catch(() => null); if (r) await logAudit({ action: "CREATE", tableName: "rooms", recordId: String(r.id) }); }
  revalidatePath("/beds"); revalidateTag("lookups", { expire: 0 });
}
export async function addBed(roomId: number, fd: FormData) {
  await assertPerm("beds.manage");
  const label = fd.get("label")?.toString().trim();
  if (!label) return;
  const bed = await prisma.bed.create({ data: { roomId, label } });
  await logAudit({ action: "CREATE", tableName: "beds", recordId: String(bed.id), newValue: { roomId, label } });
  revalidatePath("/beds"); revalidateTag("lookups", { expire: 0 });
}
export async function updateRoom(id: number, fd: FormData) {
  await assertPerm("beds.manage");
  await prisma.room.update({ where: { id }, data: { capacity: Math.max(1, Number(fd.get("capacity")) || 1) } });
  await logAudit({ action: "UPDATE", tableName: "rooms", recordId: String(id) });
  revalidatePath("/beds"); revalidateTag("lookups", { expire: 0 });
}
export async function deleteRoom(id: number) {
  await assertAdminDelete();
  await assertPerm("beds.manage");
  try { await prisma.room.delete({ where: { id } }); }
  catch { redirect("/beds?saved=" + encodeURIComponent("لا يمكن حذف غرفة مرتبطة برقود")); }
  await logAudit({ action: "DELETE", tableName: "rooms", recordId: String(id) });
  revalidatePath("/beds"); revalidateTag("lookups", { expire: 0 });
}
export async function assignBed(admissionId: string, fd: FormData) {
  await assertPerm("beds.assign");
  const bedId = Number(fd.get("bedId"));
  await prisma.$transaction(async (tx) => {
    const admission = await tx.admission.findUniqueOrThrow({ where: { id: admissionId } });
    const bed = await tx.bed.findUniqueOrThrow({ where: { id: bedId } });
    const overlap = await tx.admission.findFirst({ where: { id: { not: admissionId }, bedId, admissionDate: { lte: admission.expectedDischargeDate || new Date("9999-12-31") }, OR: [{ dischargeDate: null }, { dischargeDate: { gte: admission.admissionDate } }] } });
    if (overlap) throw new Error("السرير مشغول خلال فترة الرقود");
    if (admission.bedId) await tx.bed.update({ where: { id: admission.bedId }, data: { occupied: false } });
    await tx.admission.update({ where: { id: admissionId }, data: { roomId: bed.roomId, bedId } });
    await tx.bed.update({ where: { id: bedId }, data: { occupied: true } });
    await tx.auditLog.create({ data: { action: "UPDATE", tableName: "admissions", recordId: admissionId, newValue: { roomId: bed.roomId, bedId } } });
  });
  revalidatePath("/beds"); revalidateTag("lookups", { expire: 0 });
}
