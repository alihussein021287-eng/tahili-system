"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function addToQueue(fd: FormData) {
  await assertPerm("queue.manage");
  const patientId = fd.get("patientId")?.toString();
  if (!patientId) redirect("/queue?saved=" + encodeURIComponent("اختر المريض"));
  const created = await prisma.queueEntry.create({ data: { patientId: patientId!, hall: fd.get("hall")?.toString() || null, note: fd.get("note")?.toString() || null } });
  await logAudit({ action: "CREATE", tableName: "queue_entries", recordId: created.id });
  revalidatePath("/queue");
}
export async function setQueueStatus(id: string, status: any) {
  await assertPerm("queue.manage");
  await prisma.queueEntry.update({ where: { id }, data: { status, ...(status === "CALLED" ? { calledAt: new Date() } : {}) } });
  await logAudit({ action: "UPDATE", tableName: "queue_entries", recordId: id, newValue: { status } });
  revalidatePath("/queue");
}
export async function removeQueue(id: string) {
  await assertAdminDelete();
  await assertPerm("queue.manage");
  await prisma.queueEntry.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "queue_entries", recordId: id });
  revalidatePath("/queue");
}
export async function clearDoneQueue() {
  await assertAdminDelete();
  await assertPerm("queue.manage");
  await prisma.queueEntry.deleteMany({ where: { status: "DONE" } });
  revalidatePath("/queue");
}
