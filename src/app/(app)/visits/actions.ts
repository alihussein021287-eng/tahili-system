"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPerm } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_SESSION"] as const;

function withSaved(url: string, message: string) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}saved=${encodeURIComponent(message)}`;
}

export async function recordVisit(fd: FormData) {
  await assertPerm("visits.manage");
  const patientId = fd.get("patientId")?.toString();
  if (!patientId) redirect("/visits?saved=" + encodeURIComponent("اختر المراجع"));
  const notes = fd.get("notes")?.toString().trim() || null;
  const sequenceNo = (await prisma.visit.count({ where: { patientId: patientId! } })) + 1;
  const created = await prisma.visit.create({ data: { patientId: patientId!, sequenceNo, notes } });
  await logAudit({ action: "CREATE", tableName: "visits", recordId: created.id });
  revalidatePath("/visits");
}

export async function receptionCheckIn(fd: FormData) {
  await assertPerm("visits.manage");
  const patientId = fd.get("patientId")?.toString();
  const returnTo = fd.get("returnTo")?.toString() || "/visits";
  if (!patientId) redirect(withSaved(returnTo, "اختر المراجع"));

  const sendQueue = fd.get("sendQueue") === "1";
  if (sendQueue) await assertPerm("queue.manage");

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, fullName: true, status: true, archivedAt: true },
  });
  if (!patient) redirect(withSaved(returnTo, "المراجع غير موجود"));
  if (patient.archivedAt) redirect(withSaved(returnTo, "لا يمكن تسجيل زيارة لمراجع مؤرشف"));

  const now = new Date();
  const startToday = new Date(now.toDateString());
  const endToday = new Date(startToday.getTime() + 86400000);
  const noteText = fd.get("notes")?.toString().trim();
  const hall = fd.get("hall")?.toString().trim() || null;
  const queueNote = fd.get("queueNote")?.toString().trim() || noteText || null;

  const existingVisit = await prisma.visit.findFirst({
    where: { patientId, visitDate: { gte: startToday, lt: endToday } },
    orderBy: { visitDate: "desc" },
  });
  const visit = existingVisit ?? await prisma.visit.create({
    data: {
      patientId,
      sequenceNo: (await prisma.visit.count({ where: { patientId } })) + 1,
      notes: noteText || "تسجيل حضور من الاستقبال",
    },
  });
  if (!existingVisit) await logAudit({ action: "CREATE", tableName: "visits", recordId: visit.id });

  let queued = false;
  if (sendQueue) {
    const existingQueue = await prisma.queueEntry.findFirst({
      where: {
        patientId,
        createdAt: { gte: startToday, lt: endToday },
        status: { in: [...ACTIVE_QUEUE_STATUSES] },
      },
      select: { id: true },
    });
    if (!existingQueue) {
      const createdQueue = await prisma.queueEntry.create({ data: { patientId, hall, note: queueNote } });
      await logAudit({ action: "CREATE", tableName: "queue_entries", recordId: createdQueue.id });
      queued = true;
    }
  }

  revalidatePath("/visits");
  revalidatePath("/search");
  revalidatePath("/queue");
  revalidatePath("/");
  const parts = [existingVisit ? "زيارة اليوم مسجلة مسبقاً" : "تم تسجيل زيارة اليوم"];
  if (sendQueue) parts.push(queued ? "تم الإرسال للطابور" : "المراجع موجود بالفعل في طابور اليوم");
  redirect(withSaved(returnTo, parts.join("، ")));
}
