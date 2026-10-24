"use server";

import { prisma } from "@/lib/db";
import { withSerializableRetry } from "@/lib/serializable-retry";
import { assertPerm, requireSession } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { boundedSessionDates, expectedTreatmentEnd, positiveInt, recoveryPercent } from "@/lib/therapy-plan-rules";
import { handOverInTransaction } from "@/lib/handoff-service";
import { activeMembershipWhere } from "@/lib/center-membership";

const DAY_MS = 86400000;

function sessionDates(start: Date, weekdays: number[], count: number, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const dates: Date[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  for (let guard = 0; dates.length < count && guard < 500; guard++) {
    if (weekdays.includes(cursor.getDay())) {
      const date = new Date(cursor);
      date.setHours(hours, minutes, 0, 0);
      dates.push(date);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function actor(permission: string) {
  const session = await requireSession();
  await assertPerm(permission);
  return { id: (session.user as any).id as string, role: (session.user as any).role as string, name: session.user?.name || "" };
}

async function assertCenterManager(tx: any, who: { id: string; role: string }, centerId: number) {
  if (who.role === "ADMIN") return;
  const membership = await tx.centerMembership.findFirst({ where: { centerId, userId: who.id, role: "HEAD_THERAPIST", status: "ACTIVE", ...activeMembershipWhere("HEAD_THERAPIST"), center: { active: true } } });
  if (!membership) throw new Error("لا يمكنك إدارة خطط مركز آخر");
}

export async function createPhysicalTherapyPlan(patientId: string, fd: FormData) {
  const who = await actor("therapy.plan.manage");
  const referralRequestId = fd.get("referralRequestId")?.toString() || "";
  const selectedCenterId = Number(fd.get("centerId"));
  const therapistId = fd.get("therapistId")?.toString() || "";
  const specialistDoctorId = fd.get("specialistDoctorId")?.toString() || "";
  const hallId = Number(fd.get("hallId"));
  const plannedSessions = positiveInt(fd.get("plannedSessions"), "عدد الجلسات", 60);
  const treatmentDays = positiveInt(fd.get("treatmentDays"), "عدد أيام العلاج", 365);
  const sessionTime = fd.get("sessionTime")?.toString() || "10:00";
  const startDate = new Date(fd.get("startDate")?.toString() || "");
  const weekdays = fd.getAll("weekdays").map(Number).filter((day) => day >= 0 && day <= 6);
  const reviewMode = fd.get("reviewMode")?.toString();
  const reviewInterval = positiveInt(fd.get("reviewInterval"), "دورية التقييم", 365);
  if (!referralRequestId || !therapistId || !specialistDoctorId || !hallId || !weekdays.length || Number.isNaN(startDate.getTime())) throw new Error("أكمل الإحالة وطبيب الاختصاص والمعالج والقاعة والجدولة");
  const expectedEndDate = expectedTreatmentEnd(startDate, treatmentDays);
  const dates = boundedSessionDates(startDate, expectedEndDate, weekdays, plannedSessions, sessionTime);

  const plan = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const existing = await tx.treatmentPlan.findUnique({ where: { referralRequestId } });
    if (existing) return existing;
    const referral = await tx.referralRequest.findFirst({ where: { id: referralRequestId, patientId, status: "ACCEPTED", destinationScope: "INTERNAL_CENTER" }, include: { destinationCenter: true } });
    if (!referral) throw new Error("الإحالة الداخلية المقبولة غير متاحة");
    const centerId = referral.destinationCenterId;
    if (!centerId) throw new Error("الإحالة غير مرتبطة بمركز داخلي");
    if (Number.isInteger(selectedCenterId) && selectedCenterId > 0 && selectedCenterId !== centerId) throw new Error("الإحالة لا تتبع المركز المختار");
    await assertCenterManager(tx, who, centerId);
    const [therapist, specialistDoctor, hall] = await Promise.all([
      tx.user.findFirst({ where: { id: therapistId, isActive: true, role: "THERAPIST", centerMemberships: { some: { centerId, role: "THERAPIST", status: "ACTIVE" } } } }),
      tx.user.findFirst({ where: { id: specialistDoctorId, isActive: true, role: "DOCTOR" } }),
      tx.therapyHall.findFirst({ where: { id: hallId, active: true } }),
    ]);
    const hallMapping = hall ? await tx.centerResource.findFirst({ where: { centerId, therapyHallId: hallId, type: "HALL", status: "AVAILABLE" } }) : null;
    if (!therapist || !specialistDoctor || !hall || !hallMapping) throw new Error("طبيب الاختصاص أو المعالج أو القاعة غير متاح في هذا المركز");
    const conflict = await tx.appointment.findFirst({ where: { scheduledAt: { in: dates }, status: "SCHEDULED", OR: [{ patientId }, { assignedToId: therapistId }, { session: { is: { hallId } } }] }, include: { patient: { select: { fullName: true } } } });
    if (conflict) throw new Error(`تعارض في الموعد مع ${conflict.patient.fullName}`);
    const created = await tx.treatmentPlan.create({ data: {
      patientId, referralRequestId, title: fd.get("title")?.toString().trim() || "خطة العلاج الطبيعي",
      therapyType: (fd.get("therapyType")?.toString() as any) || "PHYSICAL", goals: fd.get("goals")?.toString().trim() || null,
      plannedSessions, treatmentDays, startDate, expectedEndDate, weekdays: weekdays.sort().join(","), sessionTime,
      hallId, therapistId, centerId, createdById: who.id, specialistDoctorId,
      reviewEverySessions: reviewMode === "SESSIONS" ? reviewInterval : null,
      reviewEveryDays: reviewMode === "DAYS" ? reviewInterval : null,
      notes: fd.get("notes")?.toString().trim() || null,
    } });
    const session = await tx.therapySession.create({ data: {
      patientId, treatmentPlanId: created.id, therapyType: created.therapyType || "PHYSICAL", centerId,
      treatmentPlan: created.title, totalSessions: plannedSessions, actualSessions: 0, startDate, endDate: expectedEndDate,
      weekdays: created.weekdays, sessionTime, hallId, hall: hall.name, therapistId, therapist: therapist.fullName, scheduledById: who.id,
    } });
    await tx.appointment.createMany({ data: dates.map((scheduledAt, index) => ({ patientId, scheduledAt, type: `جلسة علاج طبيعي ${index + 1} من ${dates.length}`, therapyType: created.therapyType, assignedToId: therapistId, assignedTo: therapist.fullName, sessionId: session.id, status: "SCHEDULED", notes: `القاعة: ${hall.name}` })) });
    await tx.auditLog.create({ data: { userId: who.id, action: "CREATE", tableName: "TreatmentPlan", recordId: created.id, newValue: { referralRequestId, therapistId, hallId, plannedSessions, scheduled: dates.length } } });
    // The patient now belongs to the therapist: one handoff, so the file, the list and the care board all agree.
    await handOverInTransaction(tx as any, {
      patientId, actorId: who.id, actorRole: who.role as any, toRole: "THERAPIST", toUserId: therapistId, toCenterId: centerId,
      note: `برنامج علاج طبيعي: ${dates.length} جلسة تبدأ ${dates[0]?.toLocaleDateString("ar-IQ") ?? ""} — راجع «جلساتي اليوم»`,
    });
    return created;
  }, { isolationLevel: "Serializable" }));
  revalidatePath(`/patients/${patientId}`); revalidatePath("/therapy"); revalidatePath("/therapy/today"); revalidatePath("/workload"); revalidatePath("/appointments");
  redirect(`/patients/${patientId}?tab=therapyProgram&therapyPlan=${plan.id}`);
}

export async function updatePhysicalTherapyPlan(planId: string, fd: FormData) {
  const who = await actor("therapy.plan.manage");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TreatmentPlan" WHERE id = ${planId} FOR UPDATE`;
    const plan = await tx.treatmentPlan.findUniqueOrThrow({ where: { id: planId }, include: { sessions: { include: { appointments: true } } } });
    if (!plan.centerId) throw new Error("الخطة القديمة غير مرتبطة بمركز");
    await assertCenterManager(tx, who, plan.centerId);
    if (plan.closedAt || plan.evaluatedAt) await assertPerm("therapy.admin.override");
    const specialistDoctorId = fd.get("specialistDoctorId")?.toString() || "";
    const doctor = await tx.user.findFirst({ where: { id: specialistDoctorId, role: "DOCTOR", isActive: true } });
    if (!doctor) throw new Error("اختر طبيب اختصاص فعالاً");
    const treatmentDays = positiveInt(fd.get("treatmentDays"), "عدد أيام العلاج", 365);
    const startDate = plan.startDate || new Date();
    const expectedEndDate = expectedTreatmentEnd(startDate, treatmentDays);
    if (plan.sessions.some((session: any) => session.appointments.some((appointment: any) => appointment.scheduledAt > expectedEndDate))) throw new Error("توجد مواعيد بعد نهاية المدة الجديدة. عدّل المواعيد أولاً");
    const reviewMode = fd.get("reviewMode")?.toString();
    const reviewInterval = positiveInt(fd.get("reviewInterval"), "دورية التقييم", 365);
    await tx.treatmentPlan.update({ where: { id: planId }, data: { specialistDoctorId, treatmentDays, expectedEndDate, reviewEverySessions: reviewMode === "SESSIONS" ? reviewInterval : null, reviewEveryDays: reviewMode === "DAYS" ? reviewInterval : null } });
    await tx.auditLog.create({ data: { userId: who.id, action: "UPDATE", tableName: "TreatmentPlan", recordId: planId, newValue: { specialistDoctorId, treatmentDays, reviewMode, reviewInterval } } });
  });
  revalidatePath("/therapy");
}

export async function addPeriodicTherapyEvaluation(planId: string, fd: FormData) {
  const who = await actor("therapy.plan.manage");
  const percent = recoveryPercent(fd.get("recoveryPercent"));
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TreatmentPlan" WHERE id = ${planId} FOR UPDATE`;
    const plan = await tx.treatmentPlan.findUniqueOrThrow({ where: { id: planId } });
    if (!plan.centerId) throw new Error("الخطة غير مرتبطة بمركز");
    await assertCenterManager(tx, who, plan.centerId);
    if (plan.evaluatedAt && plan.finalDecision === "END") await assertPerm("therapy.admin.override");
    await tx.therapyPeriodicEvaluation.create({ data: { treatmentPlanId: planId, currentCondition: fd.get("currentCondition")?.toString().trim() || "", achievedProgress: fd.get("achievedProgress")?.toString().trim() || "", obstacles: fd.get("obstacles")?.toString().trim() || null, recommendations: fd.get("recommendations")?.toString().trim() || null, decision: fd.get("decision")?.toString() || "CONTINUE", recoveryPercent: percent, evaluatedAt: fd.get("evaluatedAt") ? new Date(fd.get("evaluatedAt")!.toString()) : new Date(), evaluatedById: who.id } });
    await tx.auditLog.create({ data: { userId: who.id, action: "CREATE", tableName: "therapy_periodic_evaluations", recordId: planId, newValue: { recoveryPercent: percent } } });
  });
  revalidatePath("/therapy");
}

export async function recordTherapyAppointment(appointmentId: string, fd: FormData) {
  const who = await actor("therapy.session.record");
  const completed = fd.get("status")?.toString() === "COMPLETED";
  const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { session: { include: { plan: true } } } });
    if (!appointment?.session || appointment.assignedToId !== who.id) throw new Error("المعالج المسند فقط يستطيع تسجيل الجلسة");
    if (appointment.session.centerId && who.role !== "ADMIN") {
      const member = await tx.centerMembership.findFirst({ where: { centerId: appointment.session.centerId, userId: who.id, role: "THERAPIST", status: "ACTIVE" } });
      if (!member) throw new Error("لا يمكنك تسجيل جلسة خارج مركز عضويتك");
    }
    if (appointment.session.plan?.status === "COMPLETED") throw new Error("الخطة مغلقة");
    const existing = await tx.therapySessionLog.findFirst({ where: { appointmentId }, orderBy: { createdAt: "desc" } });
    if (appointment.status === "COMPLETED" && existing?.status === "COMPLETED") return { patientId: appointment.patientId, repeated: true };
    const data = {
      patientId: appointment.patientId, sessionId: appointment.sessionId, appointmentId, therapist: who.name, createdById: who.id,
      attended: fd.get("attended") === "1", exercises: fd.get("exercises")?.toString().trim() || null,
      response: fd.get("response")?.toString().trim() || null, progress: fd.get("progress")?.toString().trim() || null,
      notes: fd.get("notes")?.toString().trim() || null, status: (fd.get("status")?.toString() as any) || "ATTENDED",
      completedAt: completed ? new Date() : null,
    };
    if (existing) await tx.therapySessionLog.update({ where: { id: existing.id }, data });
    else await tx.therapySessionLog.create({ data });
    if (completed && appointment.status !== "COMPLETED") {
      await tx.appointment.update({ where: { id: appointmentId }, data: { status: "COMPLETED" } });
      const session = await tx.therapySession.update({ where: { id: appointment.sessionId! }, data: { actualSessions: { increment: 1 } } });
      if (session.treatmentPlanId && session.actualSessions >= (session.totalSessions || Number.MAX_SAFE_INTEGER)) await tx.treatmentPlan.update({ where: { id: session.treatmentPlanId }, data: { status: "COMPLETED", closedAt: new Date() } });
    } else if (data.status === "NO_SHOW") {
      await tx.appointment.update({ where: { id: appointmentId }, data: { status: "NOSHOW" } });
    } else if (data.status === "CANCELLED") {
      await tx.appointment.update({ where: { id: appointmentId }, data: { status: "CANCELLED" } });
    }
    await tx.auditLog.create({ data: { userId: who.id, action: "UPDATE", tableName: "therapy_session_logs", recordId: existing?.id || appointmentId, newValue: { appointmentId, status: data.status, attended: data.attended } } });
    return { patientId: appointment.patientId, repeated: false };
  }, { isolationLevel: "Serializable" }));
  revalidatePath("/therapy/today"); revalidatePath("/appointments"); revalidatePath(`/patients/${result.patientId}`); revalidatePath("/workload");
}

export async function finalizeTherapyPlan(planId: string, fd: FormData) {
  const who = await actor("therapy.plan.finalize");
  const finalRecoveryPercent = recoveryPercent(fd.get("finalRecoveryPercent"));
  const decision = fd.get("finalDecision")?.toString() as "EXTEND" | "END";
  if (decision !== "END" && decision !== "EXTEND") throw new Error("قرار التقييم النهائي غير صالح");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TreatmentPlan" WHERE id = ${planId} FOR UPDATE`;
    const plan = await tx.treatmentPlan.findUniqueOrThrow({ where: { id: planId }, include: { patient: true, therapist: true, hall: true, sessions: true } });
    if (plan.centerId) await assertCenterManager(tx, who, plan.centerId);
    if (plan.status !== "COMPLETED") throw new Error("يُفتح التقييم النهائي بعد اكتمال البرنامج");
    // Session completion also sets closedAt. First evaluation and a completed extension
    // remain valid; only an already ended final evaluation needs the existing override.
    if (plan.evaluatedAt && plan.finalDecision !== "EXTEND") await assertPerm("therapy.admin.override");
    const program = plan.sessions[0];
    if (!program) throw new Error("الخطة غير مرتبطة ببرنامج جلسات");
    if (program.actualSessions! < program.totalSessions! && decision === "END") throw new Error("لا يمكن إنهاء البرنامج قبل إكمال الجلسات المخططة");
    const nextAppointment = await tx.appointment.findFirst({ where: { patientId: plan.patientId, scheduledAt: { gt: new Date() }, type: { contains: "فحص" } }, orderBy: { scheduledAt: "asc" } });
    let extendedEnd = plan.expectedEndDate;
    let extendedCount = 0;
    if (decision === "EXTEND") {
      extendedCount = Math.max(1, Math.min(30, Number(fd.get("extensionSessions")) || 1));
      const weekdays = (plan.weekdays || "").split(",").map(Number).filter((day) => day >= 0 && day <= 6);
      const extensionStart = new Date((plan.expectedEndDate || new Date()).getTime() + DAY_MS);
      const dates = sessionDates(extensionStart, weekdays, extendedCount, plan.sessionTime || "10:00");
      const conflict = await tx.appointment.findFirst({ where: { scheduledAt: { in: dates }, status: "SCHEDULED", OR: [{ patientId: plan.patientId }, { assignedToId: plan.therapistId }, { session: { is: { hallId: plan.hallId } } }] } });
      if (conflict) throw new Error("تعارض في جدولة جلسات التمديد");
      await tx.appointment.createMany({ data: dates.map((scheduledAt, index) => ({ patientId: plan.patientId, scheduledAt, type: `جلسة علاج طبيعي ${(program.totalSessions || 0) + index + 1} من ${(program.totalSessions || 0) + dates.length} (تمديد)`, therapyType: plan.therapyType, assignedToId: plan.therapistId, assignedTo: plan.therapist?.fullName, sessionId: program.id, status: "SCHEDULED", notes: plan.hall ? `القاعة: ${plan.hall.name}` : null })) });
      extendedEnd = dates.at(-1) || extendedEnd;
      await tx.therapySession.update({ where: { id: program.id }, data: { totalSessions: { increment: extendedCount }, endDate: extendedEnd } });
    }
    await tx.treatmentPlan.update({ where: { id: planId }, data: {
      beforeCondition: fd.get("beforeCondition")?.toString().trim(), afterCondition: fd.get("afterCondition")?.toString().trim(),
      improvementLevel: fd.get("improvementLevel")?.toString().trim(), achievedGoals: fd.get("achievedGoals")?.toString().trim(),
      finalRecoveryPercent,
      finalRecommendation: fd.get("finalRecommendation")?.toString().trim(), finalDecision: decision, evaluatedAt: new Date(), evaluatedById: who.id,
      status: decision === "END" ? "COMPLETED" : "ACTIVE", closedAt: decision === "END" ? new Date() : null, followUpAppointmentId: nextAppointment?.id,
      plannedSessions: decision === "EXTEND" ? { increment: extendedCount } : undefined, expectedEndDate: extendedEnd,
    } });
    if (decision === "END") {
      // Back to the specialist who owns the case, as a handoff (not the old station list).
      if (plan.specialistDoctorId) {
        await handOverInTransaction(tx as any, {
          patientId: plan.patientId, actorId: who.id, actorRole: who.role as any, toRole: "DOCTOR", toUserId: plan.specialistDoctorId, toCenterId: null,
          note: nextAppointment ? `انتهى برنامج العلاج الطبيعي — متابعة بموعد ${nextAppointment.scheduledAt.toLocaleDateString("ar-IQ")}` : "انتهى برنامج العلاج الطبيعي — للمتابعة",
        });
      } else {
        await tx.notification.create({ data: { targetRole: "DOCTOR", title: "تقييم علاج طبيعي نهائي", body: "انتهى البرنامج ويحتاج متابعة طبيب الاختصاص.", link: `/patients/${plan.patientId}` } });
      }
    }
    await tx.auditLog.create({ data: { userId: who.id, action: "UPDATE", tableName: "TreatmentPlan", recordId: planId, newValue: { evaluated: true, finalDecision: decision, extensionSessions: extendedCount, followUpAppointmentId: nextAppointment?.id } } });
  });
  revalidatePath("/therapy"); revalidatePath(`/therapy/plans/${planId}/final`);
}

/**
 * Move one therapy session to another day or time. The assigned therapist can move their own
 * session; the head therapist of the centre can move any. Same clash rules as scheduling.
 */
export async function rescheduleTherapyAppointment(appointmentId: string, fd: FormData) {
  const session = await requireSession();
  const who = { id: (session.user as any).id as string, role: (session.user as any).role as string, name: session.user?.name || "" };
  const when = new Date(fd.get("scheduledAt")?.toString() || "");
  if (Number.isNaN(when.getTime())) throw new Error("حدد اليوم والوقت الجديد");
  if (when.getTime() < Date.now() - 60_000) throw new Error("الموعد الجديد لازم يكون بالمستقبل");
  const reason = fd.get("reason")?.toString().trim() || null;
  const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { session: { include: { plan: true } } } });
    if (!appointment?.session) throw new Error("الموعد غير مرتبط ببرنامج علاج");
    if (!["SCHEDULED", "NOSHOW"].includes(appointment.status)) throw new Error("يُنقل الموعد المجدول أو الغياب فقط");
    if (appointment.session.plan?.status === "COMPLETED") throw new Error("الخطة مغلقة");
    const ownTherapist = appointment.assignedToId === who.id;
    if (ownTherapist) await assertPerm("therapy.session.record");
    else {
      await assertPerm("therapy.schedule.reschedule");
      if (appointment.session.centerId) await assertCenterManager(tx, who, appointment.session.centerId);
    }
    const clash = await tx.appointment.findFirst({ where: {
      id: { not: appointmentId }, scheduledAt: when, status: "SCHEDULED",
      OR: [{ patientId: appointment.patientId }, ...(appointment.assignedToId ? [{ assignedToId: appointment.assignedToId }] : []), ...(appointment.session.hallId ? [{ session: { is: { hallId: appointment.session.hallId } } }] : [])],
    }, include: { patient: { select: { fullName: true } } } });
    if (clash) throw new Error(`تعارض بنفس الوقت مع ${clash.patient.fullName}`);
    const before = appointment.scheduledAt;
    await tx.appointment.update({ where: { id: appointmentId }, data: { scheduledAt: when, status: "SCHEDULED" } });
    await tx.auditLog.create({ data: { userId: who.id, action: "UPDATE", tableName: "appointments", recordId: appointmentId, oldValue: { scheduledAt: before, status: appointment.status }, newValue: { scheduledAt: when, status: "SCHEDULED", reason } } });
    if (!ownTherapist && appointment.assignedToId) {
      await tx.notification.create({ data: { targetUserId: appointment.assignedToId, title: "نُقل موعد جلسة", body: `${appointment.type ?? "جلسة"}: ${when.toLocaleString("ar-IQ")}`, link: "/therapy/today" } });
    }
    return appointment.patientId;
  }, { isolationLevel: "Serializable" }));
  revalidatePath("/therapy/today"); revalidatePath("/appointments"); revalidatePath(`/patients/${result}`); revalidatePath("/therapy");
}
