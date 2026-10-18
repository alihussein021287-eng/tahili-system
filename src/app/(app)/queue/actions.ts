"use server";
import { prisma } from "@/lib/db";
import { withSerializableRetry } from "@/lib/serializable-retry";
import { logAudit } from "@/lib/audit";
import { assertPerm, assertAdminDelete, currentPerms, requireSession } from "@/lib/access";
import { assertQueueScope, isQueueStatus, transitionQueueEntry } from "@/lib/queue-transitions";
import { assertCenterHallByName } from "@/lib/center-halls";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function addToQueue(fd: FormData) {
  await assertPerm("queue.manage");
  const patientId = fd.get("patientId")?.toString();
  if (!patientId) redirect("/queue?saved=" + encodeURIComponent("اختر المريض"));
  const centerIdRaw = Number(fd.get("centerId"));
  const centerId = Number.isInteger(centerIdRaw) && centerIdRaw > 0 ? centerIdRaw : null;
  if (!centerId) throw new Error("اختر المركز");
  if (!(await prisma.center.count({ where: { id: centerId, active: true } }))) throw new Error("المركز غير صالح");
  const hallResource = await assertCenterHallByName(prisma, centerId, fd.get("hall")?.toString());
  const session = await requireSession();
  const actorId = (session.user as { id: string }).id;
  const actorRole = (session.user as { role: any }).role;
  const me = await prisma.user.findUnique({ where: { id: actorId }, select: { branchId: true, branch: { select: { isActive: true } } } });
  const patientRow = await prisma.patient.findUnique({ where: { id: patientId! }, select: { branchId: true } });
  if (!patientRow) throw new Error("المراجع غير موجود");
  const ownBranch = me?.branchId != null && me.branch?.isActive === true ? me.branchId : null;
  if (actorRole !== "ADMIN" && (ownBranch == null || (patientRow.branchId != null && patientRow.branchId !== ownBranch))) throw new Error("غير مصرح");
  const created = await prisma.queueEntry.create({ data: { patientId: patientId!, centerId, hall: hallResource.therapyHall.name, note: fd.get("note")?.toString() || null, branchId: patientRow.branchId ?? ownBranch } });
  await logAudit({ action: "CREATE", tableName: "queue_entries", recordId: created.id });
  revalidatePath("/queue");
}

export async function assignQueueHall(fd: FormData) {
  await assertPerm("queue.manage");
  const id = fd.get("queueEntryId")?.toString();
  if (!id) throw new Error("مدخل الطابور غير صالح");

  const entry = await prisma.queueEntry.findUnique({
    where: { id },
    select: { id: true, centerId: true, hall: true, status: true, branchId: true, patient: { select: { branchId: true } } },
  });
  if (!entry || entry.status !== "WAITING" || entry.hall) {
    throw new Error("لا يمكن تعيين قاعة لهذا المدخل");
  }
  {
    const session = await requireSession();
    await assertQueueScope(prisma, { userId: (session.user as { id: string }).id, role: (session.user as { role: any }).role, permissions: await currentPerms() }, entry);
  }

  const submittedCenterId = Number(fd.get("centerId"));
  const centerId = entry.centerId ?? (Number.isInteger(submittedCenterId) && submittedCenterId > 0 ? submittedCenterId : null);
  if (!centerId) throw new Error("اختر المركز أولاً");
  if (entry.centerId && submittedCenterId && submittedCenterId !== entry.centerId) {
    throw new Error("لا يمكن تغيير مركز مدخل الطابور");
  }

  const hallResource = await assertCenterHallByName(prisma, centerId, fd.get("hall")?.toString());
  const updated = await prisma.queueEntry.updateMany({
    where: { id, status: "WAITING", hall: null },
    data: { centerId, hall: hallResource.therapyHall.name },
  });
  if (updated.count !== 1) throw new Error("تغير مدخل الطابور، حدّث الصفحة وحاول مجدداً");

  await logAudit({ action: "UPDATE", tableName: "queue_entries", recordId: id, newValue: { centerId, hall: hallResource.therapyHall.name } });
  revalidatePath("/queue");
  revalidatePath("/patients-care");
}
export async function setQueueStatus(id: string, status: unknown) {
  await assertPerm("queue.manage");
  if (!isQueueStatus(status)) throw new Error("حالة الطابور غير صالحة");
  const session = await requireSession();
  const actor = { userId: (session.user as { id: string }).id, role: (session.user as { role: any }).role, permissions: await currentPerms() };
  await withSerializableRetry(() => prisma.$transaction((tx) => transitionQueueEntry(tx, actor, id, status), { isolationLevel: "Serializable" }));
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
