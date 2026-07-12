"use server";

import { prisma } from "@/lib/db";
import { centerActor } from "@/lib/center-access";
import { revalidatePath } from "next/cache";
import { allowedServicesForCenterName } from "@/lib/center-workspaces";

function refresh(centerId: number) {
  revalidatePath("/centers"); revalidatePath(`/centers/${centerId}`); revalidatePath(`/centers/${centerId}/today`); revalidatePath(`/centers/${centerId}/resources`);
}

export async function saveCenterMembership(centerId: number, fd: FormData) {
  const actor = await centerActor(centerId, "centers.memberships.manage");
  const userId = fd.get("userId")?.toString() || "";
  const role = fd.get("role")?.toString() as any;
  await prisma.$transaction(async (tx) => {
    const row = await tx.centerMembership.upsert({ where: { centerId_userId_role: { centerId, userId, role } }, update: { specialty: fd.get("specialty")?.toString() || null, status: (fd.get("status")?.toString() as any) || "ACTIVE", endDate: fd.get("endDate") ? new Date(fd.get("endDate")!.toString()) : null }, create: { centerId, userId, role, specialty: fd.get("specialty")?.toString() || null, startDate: fd.get("startDate") ? new Date(fd.get("startDate")!.toString()) : new Date(), endDate: fd.get("endDate") ? new Date(fd.get("endDate")!.toString()) : null } });
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
  await prisma.$transaction(async (tx) => {
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
    if (assignedToId) await tx.notification.create({ data: { targetUserId: assignedToId, title: "برنامج مركز جديد", body: "راجع برنامج المراجع والجلسات المسندة.", link: "/centers" } });
    return program;
  }, { isolationLevel: "Serializable" }); refresh(centerId);
}

export async function scheduleCenterSession(centerId: number, programId: string, fd: FormData) {
  const actor = await centerActor(centerId, "centers.programs.manage");
  const scheduledAt = new Date(fd.get("scheduledAt")?.toString() || "");
  const duration = Math.max(15, Math.min(240, Number(fd.get("durationMinutes")) || 60));
  const endsAt = new Date(scheduledAt.getTime() + duration * 60000);
  const resourceId = fd.get("resourceId")?.toString() || null;
  await prisma.$transaction(async (tx) => {
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
  }, { isolationLevel: "Serializable" }); refresh(centerId); revalidatePath("/appointments");
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
      const last = await tx.careStage.aggregate({ where: { patientId: program.patientId }, _max: { sequence: true } });
      await tx.careStage.create({ data: { patientId: program.patientId, station: "الاستشارية", responsibleRole: "DOCTOR", sequence: (last._max.sequence ?? -1) + 1, note: "متابعة بعد انتهاء برنامج المركز", createdById: actor.userId } });
      await tx.notification.create({ data: { targetRole: "DOCTOR", title: "برنامج مركز مكتمل", body: "أعيد المراجع إلى محطة الاستشارية للمتابعة.", link: `/patients/${program.patientId}` } });
    }
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "center_programs", recordId: programId, newValue: { status: "COMPLETED", returnToConsultancy } } });
  }); refresh(centerId);
}
