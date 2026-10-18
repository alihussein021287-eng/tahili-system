"use server";
import { prisma } from "@/lib/db";
import { assertPerm, requireSession } from "@/lib/access";
import { notifyRoleInTransaction } from "@/lib/notify";
import { centerStationByName } from "@/lib/stations";
import { assertCenterHallByName } from "@/lib/center-halls";
import { MAX_FAILED_PER_PATIENT, MAX_FAILED_PER_USER, VERIFICATION_FIELDS, VERIFICATION_METHOD, VERIFICATION_WINDOW_MS, verifyDocumentDetails } from "@/lib/identity-verification";
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
  const queueCenterIdRaw = Number(fd.get("centerId"));
  const queueCenterId = Number.isInteger(queueCenterIdRaw) && queueCenterIdRaw > 0 ? queueCenterIdRaw : null;
  let hall = fd.get("hall")?.toString().trim() || null;
  const queueNote = fd.get("queueNote")?.toString().trim() || noteText || null;

  if (sendQueue) {
    if (!queueCenterId) redirect(withSaved(returnTo, "اختر المركز قبل الإرسال للطابور"));
    try {
      const hallResource = await assertCenterHallByName(prisma, queueCenterId, hall);
      hall = hallResource.therapyHall.name;
    } catch (error) {
      redirect(withSaved(returnTo, error instanceof Error ? error.message : "الفرع/القاعة لا يتبع المركز المختار"));
    }
  }

  const userId = (session.user as { id?: string })?.id;
  // Receiving branch and, for a patient outside the receptionist's own branch, the physical-document attestation.
  const [pt, me] = await Promise.all([
    prisma.patient.findUnique({ where: { id: patientId }, select: { branchId: true, birthDate: true, motherName: true, archivedAt: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, branchId: true, isActive: true, branch: { select: { isActive: true } } } }),
  ]);
  if (!pt || !me?.isActive) redirect(withSaved(returnTo, "المراجع غير موجود"));
  const ownBranch = me!.branchId != null && me!.branch?.isActive === true ? me!.branchId : null;
  const central = me!.role === "ADMIN";
  if (!central && ownBranch == null) redirect(withSaved(returnTo, "حسابك غير مرتبط بفرع فعّال؛ لا يمكن تسجيل الحضور"));
  const crossBranch = !central && pt!.branchId !== ownBranch;
  const receivingBranchId = central ? (ownBranch ?? pt!.branchId) : ownBranch;
  if (crossBranch) {
    const windowStart = new Date(Date.now() - VERIFICATION_WINDOW_MS);
    const [perPatient, perUser] = await Promise.all([
      prisma.auditLog.count({ where: { userId, tableName: "identity_verification", recordId: patientId, createdAt: { gte: windowStart } } }),
      prisma.auditLog.count({ where: { userId, tableName: "identity_verification", createdAt: { gte: windowStart } } }),
    ]);
    if (perPatient >= MAX_FAILED_PER_PATIENT || perUser >= MAX_FAILED_PER_USER) {
      redirect(withSaved(returnTo, "محاولات تحقق كثيرة؛ حاول لاحقاً أو راجع المسؤول"));
    }
    const attested = fd.get("documentAttested")?.toString() === "1";
    const outcome = attested
      ? verifyDocumentDetails(
        { birthDate: pt!.birthDate, motherName: pt!.motherName },
        { birthDate: fd.get("documentBirthDate")?.toString() ?? "", motherName: fd.get("documentMotherName")?.toString() ?? "" },
      )
      : "MISSING_INPUT";
    if (outcome === "INSUFFICIENT_RECORD") {
      redirect(withSaved(returnTo, "بيانات تسجيل هذا المراجع لا تكفي للتحقق من هويته في فرع آخر؛ يُرجى مراجعة فرعه الأصلي"));
    }
    if (outcome !== "OK") {
      // Only a real mismatch is recorded (no entered values) and counted for throttling; nothing else is written.
      if (outcome === "MISMATCH") {
        await prisma.auditLog.create({ data: { userId, action: "UPDATE", tableName: "identity_verification", recordId: patientId, newValue: { result: "FAILED" } } });
      }
      redirect(withSaved(returnTo, "تعذّر التحقق من الهوية؛ تأكد من الوثيقة الأصلية والبيانات المدخلة"));
    }
  }
  // Queue enrollment needs a receiving branch; the visit itself is unaffected.
  const queueBranchId: number | null = receivingBranchId;
  const queueSkipped = sendQueue && queueBranchId == null;
  let result: { existingVisit: boolean; queued: boolean; stageCreated: boolean };
  try {
    result = await runSerializable(async (tx) => {
      const patient = await tx.patient.findUnique({
        where: { id: patientId },
        select: { id: true, fullName: true, fileNumber: true, archivedAt: true },
      });
      if (!patient) throw new Error("المراجع غير موجود");
      if (patient.archivedAt) throw new Error("لا يمكن تسجيل زيارة لمراجع مؤرشف");

      // Same-day reuse is per receiving branch; historical visits without a branch only count for the patient's own branch.
      const existingVisit = await tx.visit.findFirst({
        where: {
          patientId, visitDate: { gte: startToday, lt: endToday },
          OR: [{ branchId: receivingBranchId }, ...(receivingBranchId === pt!.branchId ? [{ branchId: null }] : [])],
        },
        orderBy: { visitDate: "desc" },
      });
      const visit = existingVisit ?? await tx.visit.create({
        data: {
          patientId,
          sequenceNo: (await tx.visit.count({ where: { patientId } })) + 1,
          notes: noteText || "تسجيل حضور من الاستقبال",
          branchId: receivingBranchId,
          ...(crossBranch ? { verifiedById: userId, verifiedAt: new Date(), verificationMethod: VERIFICATION_METHOD } : {}),
        },
      });
      if (!existingVisit) {
        await tx.auditLog.create({ data: { userId, action: "CREATE", tableName: "visits", recordId: visit.id,
          newValue: crossBranch ? { crossBranch: true, receivingBranchId, homeBranchId: pt!.branchId, method: VERIFICATION_METHOD, fields: VERIFICATION_FIELDS } : undefined } });
      }

      let queued = false;
      if (sendQueue && !queueSkipped) {
        const existingQueue = await tx.queueEntry.findFirst({
          where: {
            patientId,
            createdAt: { gte: startToday, lt: endToday },
            status: { in: [...ACTIVE_QUEUE_STATUSES] },
            OR: [{ branchId: queueBranchId }, ...(queueBranchId === pt!.branchId ? [{ branchId: null }] : [])],
          },
          select: { id: true },
        });
        if (!existingQueue) {
          const createdQueue = await tx.queueEntry.create({ data: { patientId, centerId: queueCenterId, hall, note: queueNote, branchId: queueBranchId } });
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
              responsibilityScope: "SERVICE", // catalog station: role-based, not tied to one center
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
              careStageId: stage.id,
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
  if (crossBranch) parts.push("تم تسجيل الحضور بعد التحقق من الوثيقة الأصلية");
  if (sendQueue) parts.push(queueSkipped ? "لم يُرسل للطابور: المراجع خارج نطاق فرعك" : result.queued ? "تم الإرسال للطابور" : "المراجع موجود بالفعل في طابور اليوم");
  if (destination) parts.push(result.stageCreated ? `تم التحويل إلى ${destination.name}` : `التحويل إلى ${destination.name} مسجل مسبقاً`);
  redirect(withSaved(returnTo, parts.join("، ")));
}
