"use server";

import { prisma } from "@/lib/db";
import { withSerializableRetry } from "@/lib/serializable-retry";
import { centerActor } from "@/lib/center-access";
import { revalidatePath } from "next/cache";
import { allowedServicesForCenterName } from "@/lib/center-workspaces";
import { activeMembershipWhere, centerRoleForUserRole, parseCenterMembership } from "@/lib/center-membership";
import { loadPermissionsFromStore } from "@/lib/permission-store";
import { handOverInTransaction } from "@/lib/handoff-service";

function refresh(centerId: number) {
  revalidatePath("/centers"); revalidatePath(`/centers/${centerId}`); revalidatePath(`/centers/${centerId}/today`); revalidatePath(`/centers/${centerId}/resources`);
  revalidatePath("/therapy-centers"); revalidatePath("/settings");
}

export async function saveCenterMembership(centerId: number, fd: FormData) {
  const actor = await centerActor(centerId, "centers.memberships.manage");
  const userId = fd.get("userId")?.toString() || "";
  const account = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { role: true } });
  const role = account ? centerRoleForUserRole(account.role) : null;
  if (!role) throw new Error("هذا الدور يعمل على مستوى الفرع أو محطة مستقلة ولا يحتاج عضوية مركز علاجي");
  const normalized = new FormData();
  for (const [key, value] of fd.entries()) normalized.set(key, value);
  normalized.set("role", role);
  const { specialty, status, startDate, endDate } = parseCenterMembership(normalized);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } });
    if (!user) throw new Error("المستخدم غير متاح");
    const row = await tx.centerMembership.upsert({ where: { centerId_userId_role: { centerId, userId, role } }, update: { specialty, status, endDate }, create: { centerId, userId, role, specialty, status, startDate, endDate } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "center_memberships", recordId: row.id, newValue: { centerId, userId, role, status: row.status } } });
  }); refresh(centerId);
}

export async function saveCenterResource(centerId: number, fd: FormData) {
  const actor = await centerActor(centerId, "centers.resources.manage");
  await prisma.$transaction(async (tx) => {
    const availability = { status: (fd.get("status")?.toString() as any) || "AVAILABLE", unavailableFrom: fd.get("unavailableFrom") ? new Date(fd.get("unavailableFrom")!.toString()) : null, unavailableTo: fd.get("unavailableTo") ? new Date(fd.get("unavailableTo")!.toString()) : null, maintenanceNote: fd.get("maintenanceNote")?.toString() || null };
    const resource = await tx.centerResource.upsert({ where: { centerId_name: { centerId, name: fd.get("name")?.toString().trim() || "" } }, update: { ...availability, capacity: Math.max(1, Number(fd.get("capacity")) || 1) }, create: { centerId, name: fd.get("name")?.toString().trim() || "", type: fd.get("type")?.toString() as any, serviceType: (fd.get("serviceType")?.toString() as any) || null, capacity: Math.max(1, Number(fd.get("capacity")) || 1), roomId: fd.get("roomId") ? Number(fd.get("roomId")) : null, therapyHallId: fd.get("therapyHallId") ? Number(fd.get("therapyHallId")) : null, ...availability } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "center_resources", recordId: resource.id, newValue: { centerId, type: resource.type, status: resource.status, capacity: resource.capacity } } });
  }); refresh(centerId);
}

export async function setCenterResourceStatus(centerId: number, resourceId: string, status: "AVAILABLE" | "MAINTENANCE" | "OUT_OF_SERVICE") {
  const actor = await centerActor(centerId, "centers.resources.manage");
  await prisma.$transaction(async (tx) => {
    await tx.centerResource.update({ where: { id: resourceId }, data: { status, unavailableFrom: status === "AVAILABLE" ? null : new Date(), unavailableTo: null } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "center_resources", recordId: resourceId, newValue: { centerId, status } } });
  }); refresh(centerId);
}

export async function createCenterProgram(centerId: number, fd: FormData) {
  const actor = await centerActor(centerId, "centers.programs.manage");
  const referralRequestId = fd.get("referralRequestId")?.toString() || "";
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { role: true, isActive: true } });
    if (!user?.isActive) throw new Error("غير مصرح");
    const permissions = await loadPermissionsFromStore(actor.userId, user.role, {
      findRolePermissions: (role) => tx.rolePermission.findMany({ where: { role } }),
      findUserPermissions: (userId) => tx.userPermission.findMany({ where: { userId } }),
    });
    if (!permissions.has("centers.programs.manage")) throw new Error("غير مصرح");
    if (!permissions.has("centers.central.view")) {
      const membership = await tx.centerMembership.findFirst({ where: {
        centerId, userId: actor.userId,
        ...activeMembershipWhere(centerRoleForUserRole(user.role) ?? undefined),
        center: { active: true },
      }, select: { id: true } });
      if (!membership) throw new Error("غير مصرح");
    }
    const current = await tx.centerProgram.findUnique({ where: { referralRequestId } });
    if (current) return current;
    const referral = await tx.referralRequest.findFirst({ where: { id: referralRequestId, destinationCenterId: centerId, destinationScope: "INTERNAL_CENTER", status: { in: ["READY", "ACCEPTED"] } } });
    if (!referral) throw new Error("الإحالة الداخلية غير متاحة لهذا المركز");
    const center = await tx.center.findUniqueOrThrow({ where: { id: centerId } });
    const requestedService = fd.get("serviceType")?.toString() || "";
    if (!allowedServicesForCenterName(center.name).includes(requestedService as any)) throw new Error("الخدمة لا تتبع هذا المركز");
    const assignedToId = fd.get("assignedToId")?.toString() || null;
    if (assignedToId) {
      const member = await tx.centerMembership.findFirst({ where: { centerId, userId: assignedToId, status: "ACTIVE", role: { in: ["THERAPIST", "DEVICE_OPERATOR", "HEAD_THERAPIST"] } } });
      if (!member) throw new Error("المسؤول ليس عضواً فعالاً في المركز");
    }
    const program = await tx.centerProgram.create({ data: { centerId, patientId: referral.patientId, referralRequestId, serviceType: fd.get("serviceType")?.toString() as any, track: fd.get("track")?.toString() || null, mode: (fd.get("mode")?.toString() as any) || "INDIVIDUAL", assignedToId, goals: fd.get("goals")?.toString() || null, protocol: fd.get("protocol")?.toString() || null, plannedSessions: Number(fd.get("plannedSessions")) || null, startDate: fd.get("startDate") ? new Date(fd.get("startDate")!.toString()) : null, expectedEndDate: fd.get("expectedEndDate") ? new Date(fd.get("expectedEndDate")!.toString()) : null, initialSummary: fd.get("initialSummary")?.toString() || null, status: "ACTIVE" } });
    if (referral.status !== "ACCEPTED") await tx.referralRequest.update({ where: { id: referral.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedById: actor.userId } });
    await tx.centerAssessment.create({ data: { programId: program.id, patientId: program.patientId, kind: "INITIAL", functionalCapacity: fd.get("functionalCapacity")?.toString() || null, summary: fd.get("initialSummary")?.toString() || null, sensitiveNotes: program.serviceType === "PSYCHOLOGICAL" && actor.permissions.has("centers.psych.sensitive") ? fd.get("sensitiveNotes")?.toString() || null : null, createdById: actor.userId } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", tableName: "center_programs", recordId: program.id, newValue: { centerId, serviceType: program.serviceType, assignedToId, referralRequestId } } });
    if (assignedToId) {
      // Same as the physical therapy programme: the patient is now with the assigned therapist.
      const me = await tx.user.findUnique({ where: { id: actor.userId }, select: { role: true } });
      const assignee = await tx.user.findUnique({ where: { id: assignedToId }, select: { role: true } });
      await handOverInTransaction(tx as any, { patientId: program.patientId, actorId: actor.userId, actorRole: me?.role ?? "ADMIN", toRole: assignee?.role ?? "THERAPIST", toUserId: assignedToId, toCenterId: centerId, note: `برنامج ${center.name}: راجع البرنامج والجلسات المسندة` });
    }
    return program;
  }, { isolationLevel: "Serializable" })); refresh(centerId);
}

export async function scheduleCenterSession(centerId: number, programId: string, fd: FormData) {
  const actor = await centerActor(centerId, "centers.programs.manage");
  const scheduledAt = new Date(fd.get("scheduledAt")?.toString() || "");
  const duration = Math.max(15, Math.min(240, Number(fd.get("durationMinutes")) || 60));
  const endsAt = new Date(scheduledAt.getTime() + duration * 60000);
  const resourceId = fd.get("resourceId")?.toString() || null;
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const program = await tx.centerProgram.findFirst({ where: { id: programId, centerId, status: "ACTIVE" }, include: { assignedTo: true } });
    if (!program || Number.isNaN(scheduledAt.getTime())) throw new Error("البرنامج أو الموعد غير صالح");
    const overlap = { scheduledAt: { lt: endsAt }, endsAt: { gt: scheduledAt }, status: { in: ["SCHEDULED", "ATTENDED"] as any } };
    const personConflict = await tx.centerSession.findFirst({
      where: {
        ...overlap,
        OR: [{ patientId: program.patientId }, ...(program.assignedToId ? [{ assignedToId: program.assignedToId }] : [])],
      },
    });
    if (personConflict) throw new Error("تعارض المراجع أو المسؤول في هذا الوقت");
    const appointmentConflict = await tx.appointment.findFirst({ where: { status: "SCHEDULED", scheduledAt: { gte: scheduledAt, lt: endsAt }, OR: [{ patientId: program.patientId }, ...(program.assignedToId ? [{ assignedToId: program.assignedToId }] : [])] } });
    if (appointmentConflict) throw new Error("يوجد موعد آخر للمراجع أو المسؤول خلال هذه الفترة");
    if (resourceId) {
      const resource = await tx.centerResource.findFirst({ where: { id: resourceId, centerId } });
      if (!resource || resource.status !== "AVAILABLE" || (resource.unavailableFrom && resource.unavailableFrom < endsAt && (!resource.unavailableTo || resource.unavailableTo > scheduledAt))) throw new Error("المورد غير متاح");
      const equivalents = await tx.centerResource.findMany({ where: { centerId, OR: [{ id: resourceId }, ...(resource.roomId ? [{ roomId: resource.roomId }] : []), ...(resource.therapyHallId ? [{ therapyHallId: resource.therapyHallId }] : [])] }, select: { id: true } });
      const used = await tx.centerSession.count({ where: { ...overlap, resourceId: { in: equivalents.map((item) => item.id) } } });
      if (used >= resource.capacity) throw new Error("اكتملت سعة المورد في هذا الوقت");
    }
    const appointment = await tx.appointment.create({ data: { patientId: program.patientId, scheduledAt, type: "جلسة مركز تخصصي", assignedToId: program.assignedToId, assignedTo: program.assignedTo?.fullName, status: "SCHEDULED" } });
    const session = await tx.centerSession.create({ data: { centerId, programId, patientId: program.patientId, assignedToId: program.assignedToId, resourceId, appointmentId: appointment.id, scheduledAt, endsAt, mode: program.mode } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", tableName: "center_sessions", recordId: session.id, newValue: { centerId, programId, assignedToId: program.assignedToId, resourceId, scheduledAt, duration } } });
  }, { isolationLevel: "Serializable" })); refresh(centerId); revalidatePath("/appointments");
}

const SCHEDULE_REFUSALS = ["تعارض المراجع", "يوجد موعد آخر", "المورد غير متاح", "اكتملت سعة المورد", "البرنامج أو الموعد غير صالح"];

/** Same invariants as scheduleCenterSession; a refusal is returned as an actionable message instead of the error page. */
export async function scheduleCenterSessionWithFeedback(centerId: number, programId: string, _prev: { ok: boolean; message: string } | null, fd: FormData) {
  try {
    await scheduleCenterSession(centerId, programId, fd);
    return { ok: true, message: "تمت جدولة الجلسة" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if ((error as { code?: unknown } | null)?.code === "P2034") return { ok: false, message: "الخادم مشغول حالياً؛ لم تُحفظ الجلسة. أعد المحاولة." };
    const known = SCHEDULE_REFUSALS.find((reason) => message.includes(reason));
    if (known) return { ok: false, message: `${message}. اختر وقتاً أو مورداً آخر ثم أعد المحاولة.` };
    throw error;
  }
}

export async function recordCenterSession(centerId: number, sessionId: string, fd: FormData) {
  const actor = await centerActor(centerId, "centers.sessions.record");
  const status = fd.get("status")?.toString() as any;
  await prisma.$transaction(async (tx) => {
    const current = await tx.centerSession.findFirst({ where: { id: sessionId, centerId }, include: { program: true } });
    if (!current || current.assignedToId !== actor.userId) throw new Error("المسؤول المسند فقط يستطيع تسجيل الجلسة");
    if (current.program.status === "COMPLETED") throw new Error("البرنامج مغلق");
    if (current.status === "COMPLETED" && status === "COMPLETED") return;
    await tx.centerSession.update({ where: { id: sessionId }, data: { attended: fd.get("attended") === "1", procedure: fd.get("procedure")?.toString() || null, result: fd.get("result")?.toString() || null, progress: fd.get("progress")?.toString() || null, notes: fd.get("notes")?.toString() || null, sensitiveNotes: current.program.serviceType === "PSYCHOLOGICAL" && actor.permissions.has("centers.psych.sensitive") ? fd.get("sensitiveNotes")?.toString() || null : undefined, status, completedAt: status === "COMPLETED" ? new Date() : null } });
    if (current.appointmentId) await tx.appointment.update({ where: { id: current.appointmentId }, data: { status: status === "COMPLETED" ? "COMPLETED" : status === "NO_SHOW" ? "NOSHOW" : status === "CANCELLED" ? "CANCELLED" : "SCHEDULED" } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "center_sessions", recordId: sessionId, newValue: { status, attended: fd.get("attended") === "1" } } });
  }); refresh(centerId); revalidatePath("/appointments");
}

export async function finalizeCenterProgram(centerId: number, programId: string, fd: FormData) {
  const actor = await centerActor(centerId, "centers.programs.finalize");
  const returnToConsultancy = fd.get("returnToConsultancy") === "1";
  await prisma.$transaction(async (tx) => {
    const program = await tx.centerProgram.findFirst({ where: { id: programId, centerId } });
    if (!program || program.status === "COMPLETED") throw new Error("البرنامج مغلق أو غير موجود");
    const pendingSessions = await tx.centerSession.count({ where: { programId, status: { in: ["SCHEDULED", "ATTENDED"] } } });
    if (pendingSessions > 0) throw new Error("أكمل أو ألغِ الجلسات المعلقة قبل إغلاق البرنامج");
    await tx.centerAssessment.create({ data: { programId, patientId: program.patientId, kind: "FINAL", summary: fd.get("finalSummary")?.toString() || null, improvementLevel: fd.get("improvementLevel")?.toString() || null, recommendation: fd.get("recommendation")?.toString() || null, sensitiveNotes: program.serviceType === "PSYCHOLOGICAL" && actor.permissions.has("centers.psych.sensitive") ? fd.get("sensitiveNotes")?.toString() || null : null, createdById: actor.userId } });
    await tx.centerProgram.update({ where: { id: programId }, data: { status: "COMPLETED", finalSummary: fd.get("finalSummary")?.toString() || null, improvementLevel: fd.get("improvementLevel")?.toString() || null, recommendation: fd.get("recommendation")?.toString() || null, returnToConsultancy, closedAt: new Date() } });
    if (returnToConsultancy) {
      // Hand the patient back to the doctor who reviewed (or wrote) the referral, so "now with" shows the doctor.
      const referral = program.referralRequestId ? await tx.referralRequest.findUnique({ where: { id: program.referralRequestId }, select: { assignedReviewer: { select: { id: true, role: true, isActive: true } }, createdBy: { select: { id: true, role: true, isActive: true } } } }) : null;
      const doctor = [referral?.assignedReviewer, referral?.createdBy].find((user) => user?.isActive && user.role === "DOCTOR");
      const center = await tx.center.findUnique({ where: { id: centerId }, select: { name: true } });
      const note = `انتهى برنامج ${center?.name ?? "المركز"} — متابعة عند الطبيب`;
      if (doctor) {
        const me = await tx.user.findUnique({ where: { id: actor.userId }, select: { role: true } });
        await handOverInTransaction(tx as any, { patientId: program.patientId, actorId: actor.userId, actorRole: me?.role ?? "ADMIN", toRole: "DOCTOR", toUserId: doctor.id, note });
      } else {
        await tx.notification.create({ data: { targetRole: "DOCTOR", title: "برنامج مركز مكتمل", body: `${note}. لا يوجد طبيب محدد بالإحالة، استلمه من «تسليم المراجعين».`, link: `/patients/${program.patientId}` } });
      }
    }
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "center_programs", recordId: programId, newValue: { status: "COMPLETED", returnToConsultancy } } });
  }); refresh(centerId);
}
