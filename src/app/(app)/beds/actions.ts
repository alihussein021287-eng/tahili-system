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
  const r = fd.get("roomId")?.toString();
  await prisma.admission.update({ where: { id: admissionId }, data: { roomId: r ? Number(r) : null } });
  await logAudit({ action: "UPDATE", tableName: "admissions", recordId: admissionId, newValue: { roomId: r || null } });
  revalidatePath("/beds"); revalidateTag("lookups", { expire: 0 });
}
