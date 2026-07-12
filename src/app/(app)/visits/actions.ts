"use server";
import { prisma } from "@/lib/db";
import { assertPerm, requireSession } from "@/lib/access";
import { notifyRoleInTransaction } from "@/lib/notify";
import { centerStationByName } from "@/lib/stations";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";

const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_SESSION"] as const;
const ACTIVE_STAGE_STATUSES = ["WAITING", "IN_PROGRESS"] as const;
const MAX_TRANSACTION_ATTEMPTS = 3;

function withSaved(url: string, message: string) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}saved=${encodeURIComponent(message)}`;
}

export async function recordVisit(fd: FormData) {
  return receptionCheckIn(fd);
}

async function runSerializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code !== "P2034") throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw new Error("تعذّر تسجيل الحضور بسبب تعارض متزامن. حاول مرة أخرى.", { cause: error });
      }
    }
  }
  throw new Error("تعذّر تسجيل الحضور بسبب تعارض متزامن. حاول مرة أخرى.");
}

export async function receptionCheckIn(fd: FormData) {
  await assertPerm("visits.manage");
  const session = await requireSession();
  const patientId = fd.get("patientId")?.toString();
  const returnTo = fd.get("returnTo")?.toString() || "/visits";
  if (!patientId) redirect(withSaved(returnTo, "اختر المراجع"));

  const sendQueue = fd.get("sendQueue") === "1";
  if (sendQueue) await assertPerm("queue.manage");

  const destinationValue = fd.get("destination")?.toString().trim() || "";
  const destination = destinationValue ? centerStationByName(destinationValue) : null;
  if (destinationValue && !destination) {
    redirect(withSaved(returnTo, "الوجهة التالية غير معتمدة"));
  }

  const now = new Date();
  const startToday = new Date(now.toDateString());
  const endToday = new Date(startToday.getTime() + 86400000);
  const noteText = fd.get("notes")?.toString().trim();
  const hall = fd.get("hall")?.toString().trim() || null;
  const queueNote = fd.get("queueNote")?.toString().trim() || noteText || null;

  const userId = (session.user as { id?: string })?.id;
  let result: { existingVisit: boolean; queued: boolean; stageCreated: boolean };
  try {
    result = await runSerializable(async (tx) => {
      const patient = await tx.patient.findUnique({
        where: { id: patientId },
        select: { id: true, fullName: true, fileNumber: true, archivedAt: true },
      });
      if (!patient) throw new Error("المراجع غير موجود");
      if (patient.archivedAt) throw new Error("لا يمكن تسجيل زيارة لمراجع مؤرشف");

      const existingVisit = await tx.visit.findFirst({
        where: { patientId, visitDate: { gte: startToday, lt: endToday } },
        orderBy: { visitDate: "desc" },
      });
      const visit = existingVisit ?? await tx.visit.create({
        data: {
          patientId,
          sequenceNo: (await tx.visit.count({ where: { patientId } })) + 1,
          notes: noteText || "تسجيل حضور من الاستقبال",
        },
      });
      if (!existingVisit) {
        await tx.auditLog.create({ data: { userId, action: "CREATE", tableName: "visits", recordId: visit.id } });
      }

      let queued = false;
      if (sendQueue) {
        const existingQueue = await tx.queueEntry.findFirst({
          where: {
            patientId,
            createdAt: { gte: startToday, lt: endToday },
            status: { in: [...ACTIVE_QUEUE_STATUSES] },
          },
          select: { id: true },
        });
        if (!existingQueue) {
          const createdQueue = await tx.queueEntry.create({ data: { patientId, hall, note: queueNote } });
          await tx.auditLog.create({ data: { userId, action: "CREATE", tableName: "queue_entries", recordId: createdQueue.id } });
          queued = true;
        }
      }

      let stageCreated = false;
      if (destination) {
        const existingStage = await tx.careStage.findFirst({
          where: {
            patientId,
            station: { in: [destination.name, ...(destination.aliases ?? [])] },
            OR: [
              { status: { in: [...ACTIVE_STAGE_STATUSES] } },
              { createdAt: { gte: startToday, lt: endToday } },
            ],
          },
          select: { id: true },
        });
        if (!existingStage) {
          const max = await tx.careStage.aggregate({ where: { patientId }, _max: { sequence: true } });
          const stage = await tx.careStage.create({
            data: {
              patientId,
              station: destination.name,
              responsibleRole: destination.role,
              sequence: (max._max.sequence ?? -1) + 1,
              note: "تحويل بعد تسجيل الحضور",
              createdById: userId,
            },
          });
          stageCreated = true;
          await tx.auditLog.create({
            data: {
              userId,
              action: "CREATE",
              tableName: "care_stages",
              recordId: stage.id,
              newValue: { source: "reception-check-in", destination: destination.name },
            },
          });
          await notifyRoleInTransaction(
            tx,
            destination.role,
            `مراجع محوّل إلى ${destination.name}`,
            {
              body: `${patient.fullName} (#${patient.fileNumber})، الوجهة: ${destination.name}`,
              link: `/patients/${patient.id}`,
            },
          );
        }
      }

      return { existingVisit: Boolean(existingVisit), queued, stageCreated };
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "المراجع غير موجود" || error.message === "لا يمكن تسجيل زيارة لمراجع مؤرشف")) {
      redirect(withSaved(returnTo, error.message));
    }
    throw error;
  }

  revalidatePath("/visits");
  revalidatePath("/search");
  revalidatePath("/queue");
  revalidatePath("/care-board");
  revalidatePath("/notifications");
  revalidatePath("/");
  const parts = [result.existingVisit ? "زيارة اليوم مسجلة مسبقاً" : "تم تسجيل زيارة اليوم"];
  if (sendQueue) parts.push(result.queued ? "تم الإرسال للطابور" : "المراجع موجود بالفعل في طابور اليوم");
  if (destination) parts.push(result.stageCreated ? `تم التحويل إلى ${destination.name}` : `التحويل إلى ${destination.name} مسجل مسبقاً`);
  redirect(withSaved(returnTo, parts.join("، ")));
}
