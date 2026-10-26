"use server";
import { requireSession, currentPerms } from "@/lib/access";
import { withSerializableRetry } from "@/lib/serializable-retry";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { canDelete, ROLE_LABELS } from "@/lib/permissions";
import { notifyRole } from "@/lib/notify";
import { logAudit } from "@/lib/audit";
import { saveFile } from "@/lib/storage";
import { assertCenterHallByName } from "@/lib/center-halls";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadPatientTabData } from "@/lib/patient-tab-loader";
import { referralAccessScope } from "@/lib/referral-access";
import { closeOpenHandoffsForPatient } from "@/lib/handoff-service";
import { transitionCareStage, reassignCenterStage, completeCenterStageWork } from "@/lib/care-stage-service";
import { assertPatientActionScope, assertBranchBoundRecordScope } from "@/lib/patient-guard";
import { resolveRegistrationBranch, resolveUpdateBranch } from "@/lib/patient-branch";
import { centerStationByName } from "@/lib/stations";
import { resolvePrescriptionOriginDetailed, resolveCareExecutionBranch, verifyPrescriptionVisit } from "@/lib/pharmacy-scope";
import { currentTherapyActor, lockTherapySession, assertSessionPlanEditable } from "@/lib/therapy-session-lock";

const patientSchema = z.object({
  fullName: z.string().trim().min(3, "الاسم الرباعي مطلوب (3 أحرف على الأقل)"),
  gender: z.enum(["MALE", "FEMALE"], { errorMap: () => ({ message: "الجنس مطلوب" }) }),
  phone: z.string().regex(/^\d{10,11}$/, "رقم الهاتف مطلوب (10 أو 11 رقم)"),
  birthYear: z.number({ invalid_type_error: "التولد مطلوب" }).min(1900).max(new Date().getFullYear(), "سنة التولد غير صحيحة"),
  governorateId: z.number({ invalid_type_error: "المحافظة مطلوبة" }),
  injuryTypeId: z.number({ invalid_type_error: "نوع الإصابة مطلوب" }),
  caseType: z.enum(["WOUNDED", "SICK"], { errorMap: () => ({ message: "نوع الحالة مطلوب" }) }),
  disabilityPct: z.number().min(0).max(100, "نسبة العجز يجب أن تكون بين 0 و100").nullable(),
});

async function uid() {
  const s = await requireSession();
  return (s?.user as any)?.id as string | undefined;
}
async function branchActor(userId: string | undefined) {
  const me = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true, branchId: true, branch: { select: { isActive: true } } } }) : null;
  const perms = await currentPerms();
  return {
    canViewAllBranches: me?.role === "ADMIN" || (me?.role === "MANAGER" && perms.has("centers.central.view")),
    userBranchId: me?.branchId ?? null,
    userBranchActive: !!me?.branch?.isActive,
  };
}
async function guard(key: string) {
  const s = await requireSession();
  await assertPerm(key);
  return s;
}

// Operation permission AND a patient-specific relationship (see assertPatientActionScope).
async function guardPatient(key: string, patientId: string, kind: "record" | "administrative" = "record") {
  const s = await guard(key);
  await assertPatientActionScope(patientId, kind);
  return s;
}

function parsePatient(fd: FormData) {
  const s = (k: string) => (fd.get(k)?.toString().trim() || null);
  const n = (k: string) => { const v = fd.get(k)?.toString().trim(); return v ? Number(v) : null; };
  return {
    fullName: s("fullName") || "", motherName: s("motherName"),
    gender: (s("gender") as any) || null,
    birthDate: s("birthDate") ? new Date(s("birthDate")!) : null,
    birthYear: s("birthDate") ? new Date(s("birthDate")!).getFullYear() : n("birthYear"),
    phone: s("phone"), housing: s("housing"),
    maritalStatus: (s("maritalStatus") as any) || null, education: s("education"), dataEntryBy: s("dataEntryBy"),
    childrenCount: n("childrenCount"), wivesCount: n("wivesCount"),
    kinshipDegree: s("kinshipDegree"), caseType: (s("caseType") as any) || null,
    receivesSalary: fd.get("receivesSalary")?.toString() === "1" ? true : fd.get("receivesSalary")?.toString() === "0" ? false : null,
    rank: s("rank"), disabilityPct: n("disabilityPct"),
    militaryStatus: s("militaryStatus"),
    inMobilization: fd.get("inMobilization")?.toString() === "1" ? true : fd.get("inMobilization")?.toString() === "0" ? false : null,
    injuryCause: s("injuryCause"), mobility: s("mobility"),
    injuryDate: s("injuryDate") ? new Date(s("injuryDate")!) : null,
    mobilityAid: s("mobilityAid"), prosthetic: s("prosthetic"),
    formationText: s("formationText"), referredToCenter: s("referredToCenter"),
    governorateId: n("governorateId"), branchId: n("branchId"), districtId: n("districtId"), injuryTypeId: n("injuryTypeId"), formationId: n("formationId"),
    status: (s("status") as any) || "ACTIVE", notes: s("notes"),
  };
}

async function findDuplicate(data: any, excludeId?: string) {
  if (!data.fullName || !data.phone || !data.birthYear) return null;
  return prisma.patient.findFirst({
    where: {
      archivedAt: null,
      fullName: data.fullName,
      phone: data.phone,
      birthYear: data.birthYear,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, fileNumber: true, fullName: true, phone: true, birthYear: true },
  });
}

function duplicateMessage(dup: { fileNumber: number; fullName: string; phone: string | null; birthYear: number | null }) {
  return `تكرار قوي: يوجد ملف مطابق بنفس الاسم ورقم الهاتف وسنة التولد. لم يتم الحفظ. راجع ملف #${dup.fileNumber} (${dup.fullName}${dup.phone ? ` - ${dup.phone}` : ""}${dup.birthYear ? ` - تولد ${dup.birthYear}` : ""}).`;
}

export async function createPatient(_previousState: { error: string | null }, fd: FormData): Promise<{ error: string | null }> {
  const s = await guard("patients.create");
  const data = parsePatient(fd);
  // Server-side branch invariant: a new patient always gets a valid, authorized, active branch (never NULL).
  const requestedBranchId = (data as any).branchId as number | null;
  const branchDecision = resolveRegistrationBranch(
    await branchActor((s?.user as any)?.id),
    requestedBranchId,
    requestedBranchId != null ? await prisma.branch.findUnique({ where: { id: requestedBranchId }, select: { id: true, isActive: true } }) : null,
  );
  if (!branchDecision.ok) return { error: branchDecision.error ?? "الفرع غير صالح" };
  (data as any).branchId = branchDecision.branchId;
  // مدخل البيانات = المستخدم الحالي حصراً (إجباري تلقائياً)
  (data as any).dataEntryBy = s?.user?.name || (s?.user as any)?.username || "غير معروف";
  const v = patientSchema.safeParse(data);
  // Keep the form mounted when validation fails so staff do not have to re-enter it.
  if (!v.success) return { error: v.error.issues[0]?.message || "بيانات غير صحيحة" };
  const dup = await findDuplicate(data);
  if (dup) return { error: duplicateMessage(dup) };
  const photo = fd.get("photo") as File | null;
  const photoUrl = photo && photo.size > 0 ? `/api/files/${(await saveFile(photo)).key}` : null;
  const p = await prisma.patient.create({ data: { ...data, photoUrl, createdById: (s?.user as any)?.id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "patients", recordId: p.id, newValue: data });
  revalidatePath("/patients");
  if ((await currentPerms()).has("handoff.send")) redirect(`/patients/${p.id}?handoff=1`);
  redirect(`/patients/${p.id}?saved=1`);
}

// Bound as updatePatient.bind(null, id) and driven by useActionState, so it receives (previousState, formData).
// The two-argument form (id, formData) is kept for direct callers.
export async function updatePatient(id: string, stateOrForm: FormData | { error: string | null }, maybeForm?: FormData): Promise<{ error: string | null }> {
  const fd = (maybeForm ?? stateOrForm) as FormData;
  const s = await guardPatient("patients.edit", id, "administrative");
  const before = await prisma.patient.findUnique({ where: { id } });
  const data = parsePatient(fd);
  // نحافظ على مُدخِل البيانات الأصلي
  (data as any).dataEntryBy = before?.dataEntryBy ?? (s?.user?.name || (s?.user as any)?.username || null);
  const requestedUpdateBranch = (data as any).branchId as number | null;
  const updateBranch = resolveUpdateBranch(
    await branchActor((s?.user as any)?.id),
    before?.branchId ?? null,
    requestedUpdateBranch,
    requestedUpdateBranch != null ? await prisma.branch.findUnique({ where: { id: requestedUpdateBranch }, select: { id: true, isActive: true } }) : null,
  );
  if (!updateBranch.ok) redirect(`/patients/${id}/edit?saved=${encodeURIComponent(updateBranch.error ?? "الفرع غير صالح")}`);
  (data as any).branchId = updateBranch.branchId;
  const v = patientSchema.safeParse(data);
  if (!v.success) redirect(`/patients/${id}/edit?saved=${encodeURIComponent(v.error.issues[0]?.message || "بيانات غير صحيحة")}`);
  const dup = await findDuplicate(data, id);
  if (dup) redirect(`/patients/${id}/edit?saved=${encodeURIComponent(duplicateMessage(dup))}`);
  const photo = fd.get("photo") as File | null;
  const photoData = photo && photo.size > 0 ? { photoUrl: `/api/files/${(await saveFile(photo)).key}` } : {};
  await prisma.patient.update({ where: { id }, data: { ...data, ...photoData } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "patients", recordId: id, oldValue: before, newValue: data });
  revalidatePath(`/patients/${id}`);
  redirect(`/patients/${id}?saved=1`);
}

export async function deletePatient(id: string) {
  await assertAdminDelete();
  const s = await requireSession();
  await assertPerm("patients.delete");
  if (!canDelete((s?.user as any)?.role)) throw new Error("لا تملك صلاحية الحذف");
  await prisma.patient.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "patients", recordId: id });
  revalidatePath("/patients");
  redirect("/patients");
}

// ---------- الوحدات الفرعية ----------
export async function addDiagnosis(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.diagnosis", patientId, "record");
  const rec = await prisma.diagnosis.create({ data: {
    patientId, type: (fd.get("type")?.toString() as any) || "PRELIMINARY",
    text: fd.get("text")?.toString() || "", doctor: fd.get("doctor")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "diagnoses", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addReport(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.report", patientId, "record");
  const status = (fd.get("status")?.toString() || "DRAFT") as "DRAFT" | "READY_TO_PRINT";
  await prisma.$transaction(async (tx) => {
    const rec = await tx.medicalReport.create({ data: {
      patientId, content: fd.get("content")?.toString() || "", doctor: fd.get("doctor")?.toString() || s?.user?.name || null,
      doctorId: (s?.user as any)?.id, reportType: (fd.get("reportType")?.toString() as any) || "PRELIMINARY",
      status, readyAt: status === "READY_TO_PRINT" ? new Date() : null,
    }});
    await tx.auditLog.create({ data: { userId: (s?.user as any)?.id, action: "CREATE", tableName: "medical_reports", recordId: rec.id, newValue: { reportType: rec.reportType, status: rec.status } } });
    if (status === "READY_TO_PRINT") await tx.notification.createMany({ data: (["MANAGER", "SECRETARY"] as const).map((targetRole) => ({ targetRole, title: "تقرير طبي جاهز للطباعة", body: "راجع قائمة تقارير المراجع الجاهزة.", link: `/patients/${patientId}?tab=reports` })) });
  });
  revalidatePath(`/patients/${patientId}`);
}

export async function setReportStatus(patientId: string, reportId: string, status: "DRAFT" | "READY_TO_PRINT" | "PRINTED_APPROVED" | "CANCELLED") {
  // Printing never implies approval: approval needs its own permission, patient scope and a READY_TO_PRINT report.
  const s = await guard(status === "PRINTED_APPROVED" ? "reports.medical.approve" : "clinical.report");
  if (status === "PRINTED_APPROVED") await assertBranchBoundRecordScope(patientId); else await assertPatientActionScope(patientId, "record");
  await prisma.$transaction(async (tx) => {
    const before = await tx.medicalReport.findFirstOrThrow({ where: { id: reportId, patientId } });
    if (before.status === "PRINTED_APPROVED" || before.status === "CANCELLED") throw new Error("لا يمكن تعديل التقرير بعد اعتماده أو إلغائه");
    if (status === "PRINTED_APPROVED" && before.status !== "READY_TO_PRINT") throw new Error("لا يُعتمد إلا تقرير جاهز للطباعة");
    const moved = await tx.medicalReport.updateMany({ where: { id: reportId, patientId, status: before.status }, data: { status, readyAt: status === "READY_TO_PRINT" ? new Date() : before.readyAt, printedAt: status === "PRINTED_APPROVED" ? new Date() : null } });
    if (moved.count !== 1) throw new Error("تغيّرت حالة التقرير؛ أعد المحاولة");
    const rec = await tx.medicalReport.findUniqueOrThrow({ where: { id: reportId } });
    await tx.auditLog.create({ data: { userId: (s?.user as any)?.id, action: "UPDATE", tableName: "medical_reports", recordId: reportId, oldValue: { status: before.status }, newValue: { status: rec.status } } });
    if (status === "READY_TO_PRINT") await tx.notification.createMany({ data: (["MANAGER", "SECRETARY"] as const).map((targetRole) => ({ targetRole, title: "تقرير طبي جاهز للطباعة", body: "راجع قائمة تقارير المراجع الجاهزة.", link: `/patients/${patientId}?tab=reports` })) });
  });
  revalidatePath(`/patients/${patientId}`);
}

export async function addSession(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.session", patientId, "record");
  const rec = await prisma.therapySession.create({ data: {
    patientId, therapyType: (fd.get("therapyType")?.toString() as any) || "PHYSICAL",
    centerId: fd.get("centerId") ? Number(fd.get("centerId")) : null,
    treatmentPlan: fd.get("treatmentPlan")?.toString() || null,
    totalSessions: fd.get("totalSessions") ? Number(fd.get("totalSessions")) : null,
    therapist: fd.get("therapist")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "therapy_sessions", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addPrescription(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.prescription", patientId, "record");
  const medicationId = fd.get("medicationId") ? Number(fd.get("medicationId")) : null;
  const qtyStr = fd.get("quantity")?.toString() || null;
  const prescriptionType = (fd.get("prescriptionType")?.toString() || "EXTERNAL") as "INTERNAL" | "EXTERNAL";
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { caseType: true, inMobilization: true, kinshipDegree: true, referralSource: true } });
  const enough = patient.caseType != null && (patient.inMobilization != null || Boolean(patient.kinshipDegree));
  const eligible = patient.caseType === "WOUNDED" && (patient.inMobilization === true || Boolean(patient.kinshipDegree));
  const eligibilityDecision = prescriptionType === "INTERNAL" ? (enough ? (eligible ? "ELIGIBLE" : "NOT_ELIGIBLE") : ((fd.get("eligibilityDecision")?.toString() as any) || "DOCTOR_REVIEW")) : null;
  const eligibilityReason = prescriptionType === "INTERNAL" ? (enough ? (eligible ? "بيانات المراجع الحالية تثبت أهلية الصرف الداخلي" : "بيانات المراجع الحالية لا تثبت فئة الصرف الداخلي") : (fd.get("eligibilityReason")?.toString().trim() || "بيانات الأهلية غير مكتملة، وسُجّل قرار الطبيب")) : null;
  await prisma.$transaction(async (tx) => {
    // Provenance: receiving branch of the patient visit today, else the issuer branch; never the patient home branch.
    // INTERNAL (dispensable) prescriptions need an explicit, verified Visit; the pharmacy origin is that visit's branch.
    // EXTERNAL ones are print-only (no stock effect) and keep the evidence-based origin.
    let visitId: string | null = null;
    let origin: { branchId: number | null; basis: string; detail: string };
    if (prescriptionType === "INTERNAL") {
      const verified = await verifyPrescriptionVisit(tx, patientId, fd.get("visitId")?.toString(), (s?.user as any)?.id);
      visitId = verified.visitId;
      origin = { branchId: verified.branchId, basis: "EXPLICIT_VISIT", detail: "زيارة موثقة" };
    } else origin = await resolvePrescriptionOriginDetailed(tx, patientId, (s?.user as any)?.id);
    const originBranchId = origin.branchId;
    const rec = await tx.prescription.create({ data: {
      originBranchId, visitId,
      patientId, materialName: fd.get("materialName")?.toString() || null, medicationId,
      usage: fd.get("usage")?.toString() || null, doctor: fd.get("doctor")?.toString() || s?.user?.name || null,
      quantity: qtyStr, duration: fd.get("duration")?.toString() || null, prescriptionType,
      eligibilityDecision, eligibilityReason, eligibilityRecordedAt: prescriptionType === "INTERNAL" ? new Date() : null,
      createdById: (s?.user as any)?.id,
    }});
    await tx.auditLog.create({ data: { userId: (s?.user as any)?.id, action: "CREATE", tableName: "prescriptions", recordId: rec.id, newValue: { prescriptionType, eligibilityDecision, originBranchId, visitId, originBasis: origin.basis } } });
    if (originBranchId == null && (s?.user as any)?.id) {
      // Fail closed but never silent: tell the issuer exactly why the prescription has no pharmacy yet.
      await tx.notification.create({ data: { targetUserId: (s?.user as any).id, title: "وصفة بلا صيدلية منشأ", body: `${origin.detail}. لا تُصرف الوصفة حتى تُسند صيدلية المنشأ بإجراء المطابقة.`, link: `/patients/${patientId}` } });
    }
    if (prescriptionType === "INTERNAL") {
      // notify only the pharmacists of the originating branch (a branch-less origin notifies nobody: it needs reconciliation)
      const pharmacists = originBranchId == null ? [] : await tx.user.findMany({ where: { role: "PHARMACIST", isActive: true, branchId: originBranchId }, select: { id: true } });
      if (pharmacists.length) await tx.notification.createMany({ data: pharmacists.map((u) => ({ targetUserId: u.id, title: "وصفة داخلية جديدة", body: "وصفة جديدة بانتظار إجراء الصيدلية.", link: "/pharmacy" })) });
    } else await tx.notification.create({ data: { targetRole: "MANAGER", title: "وصفة خارجية جاهزة للطباعة", body: "وصفة خارجية جديدة بانتظار إدارة الطباعة.", link: `/pharmacy/rx/${rec.id}` } });
  });
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/pharmacy");
}

export async function addAdmission(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.admission", patientId, "record");
  const admissionDate = new Date(fd.get("admissionDate")?.toString() || Date.now());
  const durationDays = fd.get("durationDays") ? Number(fd.get("durationDays")) : null;
  const expectedDischargeDate = durationDays ? new Date(admissionDate.getTime() + durationDays * 86400000) : null;
  const bedId = fd.get("bedId") ? Number(fd.get("bedId")) : null;
  await prisma.$transaction(async (tx) => {
    if (bedId) {
      const overlap = await tx.admission.findFirst({ where: { bedId, admissionDate: { lte: expectedDischargeDate || new Date("9999-12-31") }, OR: [{ dischargeDate: null }, { dischargeDate: { gt: admissionDate } }] }, select: { id: true } });
      if (overlap) throw new Error("السرير مشغول خلال الفترة المحددة");
    }
    const rec = await tx.admission.create({ data: {
      patientId, admissionDate, centerId: fd.get("centerId") ? Number(fd.get("centerId")) : null,
      roomId: fd.get("roomId") ? Number(fd.get("roomId")) : null, bedId, durationDays, expectedDischargeDate,
      recommendingDoctor: fd.get("recommendingDoctor")?.toString() || s?.user?.name || null,
      admissionReason: fd.get("admissionReason")?.toString() || null, notes: fd.get("notes")?.toString() || null,
    }});
    if (bedId) await tx.bed.update({ where: { id: bedId }, data: { occupied: true } });
    await tx.auditLog.create({ data: { userId: (s?.user as any)?.id, action: "CREATE", tableName: "admissions", recordId: rec.id, newValue: { centerId: rec.centerId, roomId: rec.roomId, bedId: rec.bedId, durationDays } } });
    await tx.notification.create({ data: { targetRole: "MANAGER", title: "تسجيل رقود جديد", body: "سُجل قرار رقود جديد ويحتاج متابعة التخصيص.", link: "/beds" } });
  });
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/beds");
}

export async function addTreatmentPlan(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.plan", patientId, "record");
  const title = fd.get("title")?.toString().trim();
  if (!title) redirect(`/patients/${patientId}?saved=${encodeURIComponent("أدخل عنوان الخطة")}`);
  const rec = await prisma.treatmentPlan.create({ data: {
    patientId, title: title!,
    goals: fd.get("goals")?.toString() || null,
    plannedSessions: fd.get("plannedSessions") ? Number(fd.get("plannedSessions")) : null,
    startDate: fd.get("startDate") ? new Date(fd.get("startDate")!.toString()) : null,
    notes: fd.get("notes")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "patients", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}
export async function setTreatmentPlanStatus(patientId: string, id: string, status: any) {
  const s = await guardPatient("clinical.plan", patientId, "record");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TreatmentPlan" WHERE id = ${id} FOR UPDATE`;
    const before = await tx.treatmentPlan.findUniqueOrThrow({ where: { id } });
    if (before.patientId !== patientId) throw new Error("الخطة لا تتبع المراجع");
    if (before.closedAt || before.evaluatedAt) await assertPerm("therapy.admin.override");
    await tx.treatmentPlan.update({ where: { id }, data: { status } });
    await tx.auditLog.create({ data: { userId: (s?.user as any)?.id, action: "UPDATE", tableName: "TreatmentPlan", recordId: id, oldValue: { status: before.status }, newValue: { status, administrativeOverride: Boolean(before.closedAt || before.evaluatedAt) } } });
  });
  revalidatePath(`/patients/${patientId}`);
}
export async function deleteTreatmentPlan(patientId: string, id: string) {
  await assertAdminDelete();
  const s = await guardPatient("clinical.plan", patientId, "record");
  await prisma.treatmentPlan.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "patients", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addVitalSign(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.metrics", patientId, "record");
  const num = (k: string) => { const v = fd.get(k)?.toString().trim(); return v ? Number(v) : null; };
  const rec = await prisma.vitalSign.create({ data: {
    patientId,
    date: fd.get("date") ? new Date(fd.get("date")!.toString()) : new Date(),
    systolic: num("systolic"), diastolic: num("diastolic"), pulse: num("pulse"),
    temp: num("temp"), spo2: num("spo2"), respRate: num("respRate"), glucose: num("glucose"), weight: num("weight"),
    notes: fd.get("notes")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "patients", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function deleteVitalSign(patientId: string, id: string) {
  await assertAdminDelete();
  const s = await guardPatient("clinical.metrics", patientId, "record");
  await prisma.vitalSign.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "patients", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addProgressMetric(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.metrics", patientId, "record");
  const label = fd.get("label")?.toString().trim();
  const value = fd.get("value")?.toString();
  if (!label || value === undefined || value === "") redirect(`/patients/${patientId}?saved=${encodeURIComponent("أدخل اسم المقياس والقيمة")}`);
  const rec = await prisma.progressMetric.create({ data: {
    patientId, label: label!, value: Number(value),
    date: fd.get("date") ? new Date(fd.get("date")!.toString()) : new Date(),
    notes: fd.get("notes")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "patients", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}
export async function deleteProgressMetric(patientId: string, id: string) {
  await assertAdminDelete();
  const s = await guardPatient("clinical.metrics", patientId, "record");
  await prisma.progressMetric.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "patients", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function importPatients(fd: FormData) {
  const s = await guard("patients.import");
  let text = fd.get("data")?.toString() || "";

  // دعم رفع ملف (CSV) إضافةً للّصق
  const file = fd.get("file") as File | null;
  if (file && typeof file === "object" && file.size > 0) {
    const nm = (file.name || "").toLowerCase();
    if (nm.endsWith(".xlsx") || nm.endsWith(".xls")) {
      redirect(`/patients/import?err=${encodeURIComponent("ملف Excel لا يُقرأ مباشرة. افتحه بـ Excel ← حفظ باسم ← CSV UTF-8 ← ثم ارفع ملف الـ CSV.")}`);
    }
    text = await file.text();
  }

  const parsed = parsePatientImportText(text);
  if (!parsed.rows.length) {
    redirect(`/patients/import?err=${encodeURIComponent("لا توجد سجلات صالحة للقراءة. استخدم CSV UTF-8 أو الصق بيانات من Excel.")}`);
  }

  const keys = parsed.rows
    .filter((r) => r.fullName && r.phone && r.birthYear)
    .map((r) => ({ fullName: r.fullName, phone: r.phone!, birthYear: r.birthYear! }));
  const existing = keys.length
    ? await prisma.patient.findMany({
        where: { archivedAt: null, OR: keys },
        select: { fileNumber: true, fullName: true, phone: true, birthYear: true },
      })
    : [];
  const existingKeys = new Map(existing.map((p) => [importKey(p), p]));
  const seen = new Set<string>();
  const createRows: typeof parsed.rows = [];
  const errors = [...parsed.errors];

  for (const row of parsed.rows) {
    const key = importKey(row);
    if (key) {
      if (seen.has(key)) {
        errors.push({ line: row.line, message: "تكرار داخل الملف بنفس الاسم + الهاتف + سنة التولد" });
        continue;
      }
      seen.add(key);
      const dup = existingKeys.get(key);
      if (dup) {
        errors.push({ line: row.line, message: `تكرار قوي مع ملف موجود #${dup.fileNumber}` });
        continue;
      }
    }
    createRows.push(row);
  }

  // Same invariant as single registration: rows always land in the importer's own ACTIVE branch; an importer without one
  // (ADMIN / central) must use the Data Center, where the branch is chosen explicitly. Never NULL, never guessed.
  const importDecision = resolveRegistrationBranch(await branchActor((s?.user as any)?.id), null, null);
  if (!importDecision.ok || importDecision.branchId == null) {
    redirect(`/patients/import?err=${encodeURIComponent(`${importDecision.error ?? "الفرع غير صالح"} — للاستيراد بدون فرع شخصي استخدم مركز البيانات واختر الفرع.`)}`);
  }
  const importBranchId = importDecision.branchId as number;

  if (createRows.length > 0) {
    await prisma.patient.createMany({
      data: createRows.map((r) => ({
        fullName: r.fullName,
        phone: r.phone,
        motherName: r.motherName,
        birthYear: r.birthYear,
        housing: r.housing,
        notes: r.notes,
        branchId: importBranchId,
        createdById: (s?.user as any)?.id,
        dataEntryBy: s?.user?.name || (s?.user as any)?.username || null,
      })),
    });
  }

  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "patients", recordId: `import:${createRows.length}`, newValue: { valid: parsed.rows.length, errors: errors.length, branchId: importBranchId } });
  const msg = `تم حفظ ${createRows.length} من ${parsed.rows.length} سجل قابل للقراءة. الأخطاء/المكرر: ${errors.length}`;
  const sample = errors.slice(0, 12).map((e) => `سطر ${e.line}: ${e.message}`).join(" | ");
  redirect(`/patients/import?result=${encodeURIComponent(msg)}${sample ? `&details=${encodeURIComponent(sample)}` : ""}`);
}

type ImportRow = {
  line: number;
  fullName: string;
  phone: string | null;
  motherName: string | null;
  birthYear: number | null;
  housing: string | null;
  notes: string | null;
};

function importKey(row: { fullName?: string | null; phone?: string | null; birthYear?: number | null }) {
  if (!row.fullName || !row.phone || !row.birthYear) return "";
  return `${row.fullName.trim().replace(/\s+/g, " ")}|${row.phone.trim()}|${row.birthYear}`;
}

function parseCsvLine(line: string, delim: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delim && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parsePatientImportText(raw: string): { rows: ImportRow[]; errors: { line: number; message: string }[] } {
  const text = raw.replace(/^\uFEFF/, "").replace(/^sep=.\r?\n/i, "");
  const lines = text.split(/\r?\n/).map((l, i) => ({ text: l.trim(), line: i + 1 })).filter((l) => l.text);
  const sample = lines[0]?.text || "";
  const delim = sample.includes("\t") ? "\t" : (sample.split(";").length > sample.split(",").length ? ";" : ",");
  const rows: ImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const first = lines[0]?.text ? parseCsvLine(lines[0].text, delim).join(" ") : "";
  const hasHeader = /الاسم|full.?name|phone|الهاتف|birth|التولد/i.test(first);

  for (const item of lines.slice(hasHeader ? 1 : 0)) {
    const cols = parseCsvLine(item.text, delim);
    const fullName = (cols[0] || "").trim().replace(/\s+/g, " ");
    const phone = (cols[1] || "").trim() || null;
    const motherName = (cols[2] || "").trim() || null;
    const yearRaw = (cols[3] || "").trim();
    const birthYear = yearRaw ? Number(yearRaw) : null;
    const housing = (cols[4] || "").trim() || null;
    const notes = (cols[5] || "").trim() || null;
    if (!fullName || fullName.length < 3) {
      errors.push({ line: item.line, message: "الاسم الرباعي مطلوب" });
      continue;
    }
    if (phone && !/^\d{10,11}$/.test(phone)) {
      errors.push({ line: item.line, message: "رقم الهاتف يجب أن يكون 10 أو 11 رقم" });
      continue;
    }
    if (birthYear && (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear())) {
      errors.push({ line: item.line, message: "سنة التولد غير صحيحة" });
      continue;
    }
    rows.push({ line: item.line, fullName, phone, motherName, birthYear, housing, notes });
  }
  return { rows, errors };
}

export async function archivePatient(id: string) {
  const s = await guardPatient("patients.archive", id, "administrative");
  const actorId = (s?.user as any)?.id as string;
  await prisma.$transaction(async (tx) => {
    await tx.patient.update({ where: { id }, data: { archivedAt: new Date() } });
    await closeOpenHandoffsForPatient(tx, id, actorId, "ARCHIVED");
    await tx.auditLog.create({ data: { userId: actorId, action: "UPDATE", tableName: "patients", recordId: id, newValue: { archived: true } } });
  });
  revalidatePath("/my-work");
  redirect("/patients?archived=1");
}
export async function restorePatient(id: string) {
  const s = await guardPatient("patients.archive", id, "administrative");
  await prisma.patient.update({ where: { id }, data: { archivedAt: null } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "patients", recordId: id });
  redirect(`/patients/${id}`);
}

export async function updateAdmissionDuration(patientId: string, admissionId: string, fd: FormData) {
  const s = await guardPatient("clinical.admission", patientId, "record");
  const d = fd.get("durationDays")?.toString();
  const before = await prisma.admission.findUniqueOrThrow({ where: { id: admissionId } });
  const durationDays = d ? Number(d) : null;
  await prisma.admission.update({ where: { id: admissionId }, data: { durationDays, expectedDischargeDate: durationDays ? new Date(before.admissionDate.getTime() + durationDays * 86400000) : null } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "admissions", recordId: admissionId });
  revalidatePath(`/patients/${patientId}`);
}

export async function dischargeAdmission(patientId: string, admissionId: string, fd?: FormData) {
  const s = await guardPatient("clinical.admission", patientId, "record");
  const dd = fd?.get("dischargeDate")?.toString();
  await prisma.$transaction(async (tx) => {
    const before = await tx.admission.findUniqueOrThrow({ where: { id: admissionId } });
    if (before.patientId !== patientId) throw new Error("ملف المراجع غير متاح");
    // Only a stay that is still open can be discharged: a second call on an old admission must not
    // free a bed someone else now uses, or close handoffs other staff hold.
    const moved = await tx.admission.updateMany({ where: { id: admissionId, patientId, status: "ADMITTED" }, data: { status: "DISCHARGED", dischargeDate: dd ? new Date(dd) : new Date() } });
    if (!moved.count) throw new Error("هذا الرقود مُخرَّج مسبقاً");
    if (before.bedId) await tx.bed.update({ where: { id: before.bedId }, data: { occupied: false } });
    await closeOpenHandoffsForPatient(tx, patientId, (s?.user as any)?.id, "DISCHARGED");
    await tx.auditLog.create({ data: { userId: (s?.user as any)?.id, action: "UPDATE", tableName: "admissions", recordId: admissionId, oldValue: { status: before.status }, newValue: { status: "DISCHARGED" } } });
  });
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/my-work");
  revalidatePath("/beds");
}

export async function addCorrespondence(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.report", patientId, "record");
  const rec = await prisma.correspondence.create({ data: {
    patientId, direction: (fd.get("direction")?.toString() as any) || "INCOMING",
    bookNo: fd.get("bookNo")?.toString() || null, subject: fd.get("subject")?.toString() || null,
    body: fd.get("body")?.toString() || null,
    fromParty: fd.get("fromParty")?.toString() || null, toParty: fd.get("toParty")?.toString() || null,
    bookDate: fd.get("bookDate") ? new Date(fd.get("bookDate")!.toString()) : null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "correspondence", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addRelative(patientId: string, fd: FormData) {
  const s = await guardPatient("patients.edit", patientId, "administrative");
  const rec = await prisma.relative.create({ data: {
    patientId, name: fd.get("name")?.toString() || null, job: fd.get("job")?.toString() || null,
    workplace: fd.get("workplace")?.toString() || null, socialStatus: fd.get("socialStatus")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "relatives", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

// تقييم الجروح مع رفع صورة
export async function addWound(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.wound", patientId, "record");
  const wound = await prisma.woundAssessment.create({ data: {
    patientId, woundType: fd.get("woundType")?.toString() || null,
    exudate: fd.get("exudate")?.toString() || null,
    redness: fd.get("redness") === "on", swelling: fd.get("swelling") === "on",
    odor: fd.get("odor") === "on", warmth: fd.get("warmth") === "on",
    nextPlan: fd.get("nextPlan")?.toString() || null,
  }});
  const photo = fd.get("photo") as File | null;
  if (photo && photo.size > 0) {
    const { key, name } = await saveFile(photo);
    await prisma.attachment.create({ data: {
      patientId, woundId: wound.id, fileName: name, fileUrl: `/api/files/${key}`, type: "WOUND",
    }});
  }
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "wound_assessments", recordId: wound.id });
  revalidatePath(`/patients/${patientId}`);
}

// رفع مرفق عام (وثيقة/صورة)
export async function addAttachment(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.report", patientId, "record");
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return;
  const { key, name } = await saveFile(file);
  const displayName = fd.get("displayName")?.toString().trim();
  const rec = await prisma.attachment.create({ data: {
    patientId, fileName: displayName || name, fileUrl: `/api/files/${key}`,
    type: (fd.get("type")?.toString() as any) || "DOCUMENT",
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "attachments", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function generatePortalToken(patientId: string) {
  await guardPatient("patients.portal", patientId, "administrative");
  const token = randomBytes(32).toString("hex");
  await prisma.patient.update({ where: { id: patientId }, data: { accessToken: token } });
  revalidatePath(`/patients/${patientId}`);
}

export async function revokePortalToken(patientId: string) {
  await guardPatient("patients.portal", patientId, "administrative");
  await prisma.patient.update({ where: { id: patientId }, data: { accessToken: null } });
  revalidatePath(`/patients/${patientId}`);
}

// حذف السجلات السريرية (لتصحيح الأخطاء)
export async function deleteDiagnosis(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guardPatient("clinical.diagnosis", patientId, "record"); await prisma.diagnosis.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "diagnoses", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteReport(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guardPatient("clinical.report", patientId, "record"); const report = await prisma.medicalReport.findUniqueOrThrow({ where: { id } }); if (report.status === "PRINTED_APPROVED") throw new Error("لا يمكن حذف تقرير مطبوع ومعتمد"); await prisma.medicalReport.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "medical_reports", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteSession(patientId: string, id: string) {
  await assertAdminDelete();
  const s = await guardPatient("clinical.session", patientId, "record");
  await prisma.$transaction(async (tx) => {
    const { session } = await lockTherapySession(tx, id, patientId);
    const who = await currentTherapyActor(tx, s.user as { id: string; role: string; authVersion: number }, "clinical.session", patientId);
    if (who.role !== "ADMIN") throw new Error("الحذف صلاحية حصرية لمدير النظام");
    assertSessionPlanEditable(session.plan, who.permissions);
    await tx.therapySession.delete({ where: { id } });
    await tx.auditLog.create({ data: { userId: who.id, action: "DELETE", tableName: "therapy_sessions", recordId: id } });
  }, { isolationLevel: "ReadCommitted" });
  revalidatePath(`/patients/${patientId}`);
}
export async function deletePrescription(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guardPatient("clinical.prescription", patientId, "record"); const rx = await prisma.prescription.findUniqueOrThrow({ where: { id } }); if (rx.isDispensed || rx.status === "DISPENSED") throw new Error("لا يمكن حذف وصفة بعد الصرف"); await prisma.prescription.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "prescriptions", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteAdmission(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guardPatient("clinical.admission", patientId, "record"); await prisma.$transaction(async (tx) => { const admission = await tx.admission.findUniqueOrThrow({ where: { id } }); await tx.admission.delete({ where: { id } }); if (admission.bedId) await tx.bed.update({ where: { id: admission.bedId }, data: { occupied: false } }); await tx.auditLog.create({ data: { userId: (s?.user as any)?.id, action: "DELETE", tableName: "admissions", recordId: id } }); }); revalidatePath(`/patients/${patientId}`); revalidatePath("/beds"); }
export async function deleteWound(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guardPatient("clinical.wound", patientId, "record"); await prisma.woundAssessment.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "wound_assessments", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteCorrespondence(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guardPatient("clinical.report", patientId, "record"); await prisma.correspondence.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "correspondence", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteRelative(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guardPatient("patients.edit", patientId, "administrative"); await prisma.relative.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "relatives", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteAttachment(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guardPatient("clinical.report", patientId, "record"); await prisma.attachment.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "attachments", recordId: id }); revalidatePath(`/patients/${patientId}`); }

// ===== تحميل بيانات التبويب عند الطلب (لتخفيف تحميل صفحة المريض) =====
export async function getPatientTabData(patientId: string, tab: string) {
  await assertPatientActionScope(patientId, "record");
  return loadPatientTabData(patientId, tab, {
    session: requireSession,
    patientsView: () => assertPerm("patients.view"),
    perms: currentPerms,
    prisma,
    referralScope: async ({ userId, role, permissions }) => (
      await referralAccessScope(prisma, { userId, role: role as any, permissions })
    ).where,
    memberships: async (userId) => (
      await prisma.centerMembership.findMany({
        where: { userId, status: "ACTIVE" },
        select: { centerId: true },
      })
    ).map((row) => row.centerId),
  });
}

// ===== التداوي والتضميد =====
// خصم FEFO من دفعات الفرع المنفِّذ الموثّق فقط (مخزون مستقل لكل فرع). فرع المسجِّل الفعّال ما لم يناقضه دليل موقع الخدمة
// (زيارة اليوم في فرع آخر). عند التعذّر يُحفظ سجل الرعاية دون لمس أي مخزون ويُبلَّغ المسجِّل بالسبب؛ لا تخمين ولا تحويل بين الفروع.
async function deductStockFEFO(recordId: string, medicationId: number, qty: number, who: { id?: string; name?: string | null }, patientId: string, patientName: string | null) {
  if (!qty || qty <= 0 || !who.id) return;
  const resolution = await resolveCareExecutionBranch(prisma, patientId, who.id);
  const tell = (title: string, body: string) => prisma.notification.create({ data: { targetUserId: who.id!, title, body, link: `/patients/${patientId}` } }).catch(() => undefined);
  if (resolution.branchId == null) {
    await logAudit({ userId: who.id, action: "UPDATE", tableName: "dressing_records", recordId, newValue: { stock: "NOT_DEDUCTED", basis: resolution.basis, medicationId, quantity: qty } });
    await tell("لم يُخصم استهلاك الرعاية من المخزون", resolution.detail);
    return;
  }
  const branchId = resolution.branchId;
  try {
    const outcome = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      let remaining = qty;
      const batches = await tx.medicationBatch.findMany({
        where: { branchId, medicationId, quantity: { gt: 0 }, OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }] },
        orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      });
      for (const b of batches) {
        if (remaining <= 0) break;
        const take = Math.min(b.quantity, remaining);
        const done = await tx.medicationBatch.updateMany({ where: { id: b.id, branchId, quantity: { gte: take } }, data: { quantity: { decrement: take } } });
        if (done.count !== 1) throw new Error("تغيّر المخزون؛ أعد المحاولة");
        await tx.stockMovement.create({ data: {
          type: "DISPENSE", medicationId, batchId: b.id, quantity: take, branchId, actorId: who.id,
          byName: who.name ?? null, patientId, patientName, reason: `تداوي/تضميد [dressing:${recordId}]`,
        } });
        remaining -= take;
      }
      const agg = await tx.medicationBatch.aggregate({ where: { medicationId }, _sum: { quantity: true } });
      await tx.medication.update({ where: { id: medicationId }, data: { quantity: Math.max(0, agg._sum.quantity ?? 0) } });
      await tx.auditLog.create({ data: { userId: who.id, action: "UPDATE", tableName: "dressing_records", recordId, newValue: { stock: remaining > 0 ? "PARTIAL" : "DEDUCTED", branchId, basis: resolution.basis, medicationId, requested: qty, deducted: qty - remaining } } });
      return remaining;
    }, { isolationLevel: "Serializable" }));
    if (outcome > 0) await tell("رصيد صيدلية الفرع لا يكفي لاستهلاك الرعاية", `خُصم ما توفّر من الصلاحية فقط وبقي ${outcome} وحدة دون خصم؛ راجع مخزون صيدلية فرعك.`);
  } catch {
    await logAudit({ userId: who.id, action: "UPDATE", tableName: "dressing_records", recordId, newValue: { stock: "DEDUCTION_FAILED", branchId, medicationId, quantity: qty } });
    await tell("تعذّر خصم استهلاك الرعاية من المخزون", "حُفظ سجل الرعاية ولم يتغيّر المخزون؛ أعد التسجيل اليدوي للاستهلاك عبر الصيدلية.");
  }
}

export async function addCareRecord(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.care", patientId, "record");
  const medicationId = fd.get("medicationId") ? Number(fd.get("medicationId")) : null;
  const quantity = fd.get("quantity") ? Number(fd.get("quantity")) : null;
  const dateStr = fd.get("date")?.toString();
  const rec = await prisma.dressingRecord.create({ data: {
    patientId,
    date: dateStr ? new Date(dateStr) : new Date(),
    period: (fd.get("period")?.toString() as any) || "MORNING",
    kind: (fd.get("kind")?.toString() as any) || "DRESS",
    medicationId,
    materialName: fd.get("materialName")?.toString() || null,
    quantity,
    site: fd.get("site")?.toString() || null,
    woundState: fd.get("woundState")?.toString() || null,
    performedBy: fd.get("performedBy")?.toString() || null,
    notes: fd.get("notes")?.toString() || null,
  }});
  // خصم من المخزون إذا اختار مادة من القائمة وكمية رقمية
  if (medicationId && quantity && quantity > 0) {
    const pt = await prisma.patient.findUnique({ where: { id: patientId }, select: { fullName: true } });
    await deductStockFEFO(rec.id, medicationId, quantity, { id: (s?.user as any)?.id, name: (s?.user?.name as string) ?? null }, patientId, pt?.fullName ?? null);
  }
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "dressing_records", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function deleteCareRecord(patientId: string, id: string) {
  await assertAdminDelete();
  const s = await guardPatient("clinical.care", patientId, "record");
  await prisma.dressingRecord.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "dressing_records", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

// ---------- مسار المتابعة (سلسلة المحطّات) ----------
const DEFAULT_PATHWAY: { station: string; role: string | null }[] = [
  { station: "الاستقبال", role: "RECEPTION" },
  { station: "طبيب/تشخيص", role: "DOCTOR" },
  { station: "علاج طبيعي", role: "THERAPIST" },
  { station: "صيدلية", role: "PHARMACIST" },
  { station: "أجهزة/أطراف", role: "PROSTHETICS" },
  { station: "تضميد/جروح", role: "DRESSING" },
  { station: "مالية", role: "ACCOUNTANT" },
  { station: "المتابعة", role: "DOCTOR" },
];

export async function startPathway(patientId: string) {
  const s = await guardPatient("journey.manage", patientId, "record");
  const count = await prisma.careStage.count({ where: { patientId } });
  if (count > 0) redirect(`/patients/${patientId}?saved=${encodeURIComponent("المسار موجود مسبقاً")}`);
  await prisma.careStage.createMany({ data: DEFAULT_PATHWAY.map((st, i) => ({ patientId, station: st.station, responsibleRole: st.role as any, responsibilityScope: "SERVICE" as const, requiresPhysicianConfirmation: st.role === "RECEPTION" || st.role === "ACCOUNTANT" ? false : null, sequence: i, createdById: (s?.user as any)?.id })) });
  await logAudit({ action: "CREATE", tableName: "care_stages", recordId: patientId, newValue: { pathway: "default" } });
  revalidatePath(`/patients/${patientId}`);
}

export async function addStage(patientId: string, fd: FormData) {
  const s = await guardPatient("journey.manage", patientId, "record");
  const station = fd.get("station")?.toString().trim();
  if (!station) redirect(`/patients/${patientId}?saved=${encodeURIComponent("اسم المحطة مطلوب")}`);
  const max = await prisma.careStage.aggregate({ where: { patientId }, _max: { sequence: true } });
  const catalogStation = centerStationByName(station);
  const chosenRole = (fd.get("responsibleRole")?.toString() as any) || null;
  // Only a catalog station with its own catalog role has a known service owner; free text stays unclassified (fail closed).
  const knownService = !!catalogStation && catalogStation.role === chosenRole;
  const t = await prisma.careStage.create({ data: { patientId, station: station!, responsibleRole: chosenRole, ...(knownService ? { responsibilityScope: "SERVICE" as const } : {}), note: fd.get("note")?.toString() || null, sequence: (max._max.sequence ?? -1) + 1, createdById: (s?.user as any)?.id } });
  await logAudit({ action: "CREATE", tableName: "care_stages", recordId: t.id });
  revalidatePath(`/patients/${patientId}`);
}

async function stageTransition(patientId: string, id: string, to: "CONFIRMED" | "WAITING" | "IN_PROGRESS" | "SKIPPED", expectedOperationalCompletionId?: string) {
  const s = await guard("journey.confirm");
  const user = s.user as { id: string; role: any; name?: string | null };
  let message = "";
  try {
    await withSerializableRetry(() => prisma.$transaction(
      (tx) => transitionCareStage(tx, { userId: user.id, role: user.role, name: user.name ?? null }, { patientId, stageId: id, to, expectedOperationalCompletionId }),
      { isolationLevel: "Serializable" },
    ));
  } catch (error) {
    message = error instanceof Error ? error.message : "تعذّر تنفيذ الإجراء";
  }
  revalidatePath(`/patients/${patientId}`);
  if (message) redirect(`/patients/${patientId}?saved=${encodeURIComponent(message)}`);
}

// إعادة إسناد محطة مركز بواسطة مدير ضمن نطاق مركزه فقط؛ لا تمنح المدير صلاحية التأكيد
export async function reassignStageAction(patientId: string, stageId: string, fd: FormData) {
  const s = await requireSession();
  const user = s.user as { id: string; role: any };
  const newAssigneeId = fd.get("newAssigneeId")?.toString() || "";
  const expected = fd.get("expectedAssigneeId")?.toString() || null;
  const reason = fd.get("reason")?.toString() || "";
  let message = "";
  try {
    await withSerializableRetry(() => prisma.$transaction(
      (tx) => reassignCenterStage(tx, { userId: user.id, role: user.role }, { patientId, stageId, newAssigneeId, expectedAssigneeId: expected, reason }),
      { isolationLevel: "Serializable" },
    ));
  } catch (error) {
    message = error instanceof Error ? error.message : "تعذّرت إعادة الإسناد";
  }
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/my-work");
  if (message) redirect(`/patients/${patientId}?saved=${encodeURIComponent(message)}`);
}

// تأكيد المحطة السريرية صريح من صاحب الدور؛ لا يتأكد تلقائياً من التسليم أو الطابور أو الموعد
export async function confirmStage(patientId: string, id: string, expectedOperationalCompletionId?: string) {
  await stageTransition(patientId, id, "CONFIRMED", typeof expectedOperationalCompletionId === "string" ? expectedOperationalCompletionId : undefined);
}

export async function completeStageWorkAction(patientId: string, stageId: string, expectedUpdatedAt: string) {
  const s = await guard("journey.confirm");
  const user = s.user as { id: string; role: any; name?: string | null };
  await withSerializableRetry(() => prisma.$transaction(tx => completeCenterStageWork(tx,
    { userId: user.id, role: user.role, name: user.name ?? null }, { patientId, stageId, expectedUpdatedAt }), { isolationLevel: "Serializable" }));
  revalidatePath(`/patients/${patientId}`); revalidatePath("/my-work"); revalidatePath("/notifications");
}

export async function setStageStatus(patientId: string, id: string, status: string) {
  if (!["WAITING", "IN_PROGRESS", "SKIPPED", "CONFIRMED"].includes(status)) throw new Error("حالة المحطة غير صالحة");
  await stageTransition(patientId, id, status as "CONFIRMED" | "WAITING" | "IN_PROGRESS" | "SKIPPED");
}

export async function deleteStage(patientId: string, id: string) {
  await assertAdminDelete();
  await guardPatient("journey.manage", patientId, "record");
  await prisma.careStage.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "care_stages", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

// ---------- الإجراءات الرسمية ----------
export async function addOfficialDoc(patientId: string, fd: FormData) {
  const s = await guardPatient("officialdocs.manage", patientId, "administrative");
  const number = fd.get("number")?.toString().trim();
  const subject = fd.get("subject")?.toString().trim();
  const docDate = fd.get("docDate")?.toString();
  if (!number || !subject || !docDate) redirect(`/patients/${patientId}?saved=${encodeURIComponent("الرقم والموضوع والتاريخ مطلوبة")}`);
  const file = fd.get("attachment") as File | null;
  const attachmentUrl = file && file.size > 0 ? `/api/files/${(await saveFile(file)).key}` : null;
  const d = await prisma.officialDocument.create({
    data: {
      patientId,
      docType: (fd.get("docType")?.toString() as any) || "LETTER",
      direction: (fd.get("direction")?.toString() as any) || "INCOMING",
      number: number!, subject: subject!, docDate: new Date(docDate!),
      entity: fd.get("entity")?.toString() || null,
      body: fd.get("body")?.toString() || null,
      attachmentUrl, createdById: (s?.user as any)?.id,
    },
  });
  await logAudit({ action: "CREATE", tableName: "official_documents", recordId: d.id, newValue: { number, subject } });
  revalidatePath(`/patients/${patientId}`);
}

export async function deleteOfficialDoc(patientId: string, id: string) {
  await assertAdminDelete();
  await guardPatient("officialdocs.manage", patientId, "record");
  const linked = await prisma.referralRequest.findUnique({ where: { officialDocumentId: id }, select: { id: true } });
  if (linked) throw new Error("لا يمكن حذف كتاب إرسال مرتبط بطلب إحالة");
  await prisma.officialDocument.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "official_documents", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

// ---------- تعديل السجلات النصية (بدل الحذف) ----------
export async function updateDiagnosis(patientId: string, id: string, fd: FormData) {
  const s = await guardPatient("clinical.diagnosis", patientId, "record");
  await prisma.diagnosis.update({ where: { id }, data: {
    type: (fd.get("type")?.toString() as any) || "PRELIMINARY",
    text: fd.get("text")?.toString() || "",
    doctor: fd.get("doctor")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "diagnoses", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function updateSessionRecord(patientId: string, id: string, fd: FormData) {
  const s = await guardPatient("clinical.session", patientId, "record");
  await prisma.$transaction(async (tx) => {
    const { session: before, readVersion } = await lockTherapySession(tx, id, patientId);
    const who = await currentTherapyActor(tx, s.user as { id: string; role: string; authVersion: number }, "clinical.session", patientId);
    assertSessionPlanEditable(before.plan, who.permissions);
    if (before.updatedAt.getTime() !== readVersion.getTime()) throw new Error("تغير سجل الجلسة؛ حدّث الصفحة قبل التعديل");
    await tx.therapySession.update({ where: { id }, data: {
    treatmentPlan: fd.get("treatmentPlan")?.toString() || null,
    totalSessions: fd.get("totalSessions") ? Number(fd.get("totalSessions")) : null,
    actualSessions: fd.get("actualSessions") ? Number(fd.get("actualSessions")) : 0,
    therapist: fd.get("therapist")?.toString() || null,
    hall: fd.get("hall")?.toString() || null,
    notes: fd.get("notes")?.toString() || null,
    }});
    await tx.auditLog.create({ data: { userId: who.id, actorUsername: who.username, actorName: who.fullName, action: "UPDATE", tableName: "therapy_sessions", recordId: id, newValue: { administrativeOverride: before.plan?.status === "COMPLETED" || Boolean(before.plan?.evaluatedAt && before.plan.finalDecision === "END") } } });
  }, { isolationLevel: "ReadCommitted" });
  revalidatePath(`/patients/${patientId}`);
}

export async function addTherapySessionLog(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.session", patientId, "record");
  const requestedSessionId = fd.get("sessionId")?.toString() || null;
  const appointmentId = fd.get("appointmentId")?.toString() || null;
  const n = (key: string) => {
    const raw = fd.get(key)?.toString().trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(10, Math.round(value))) : null;
  };
  await prisma.$transaction(async (tx) => {
    const appointment = appointmentId ? await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId }, select: { patientId: true, sessionId: true } }) : null;
    if (appointment && (appointment.patientId !== patientId || (requestedSessionId && appointment.sessionId !== requestedSessionId))) throw new Error("ارتباط الموعد والجلسة غير متطابق");
    // An appointment-only form cannot conceal its authoritative session / plan.
    const linkedSessionId = requestedSessionId || appointment?.sessionId || null;
    const locked = linkedSessionId ? await lockTherapySession(tx, linkedSessionId, patientId) : null;
    if (appointmentId) {
      await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} FOR UPDATE`;
      const current = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId }, select: { patientId: true, sessionId: true } });
      if (current.patientId !== patientId || current.sessionId !== appointment?.sessionId) throw new Error("تغير ارتباط الموعد؛ حدّث الصفحة");
    }
    const who = await currentTherapyActor(tx, s.user as { id: string; role: string; authVersion: number }, "clinical.session", patientId);
    assertSessionPlanEditable(locked?.session.plan || null, who.permissions);
    const rec = await tx.therapySessionLog.create({
    data: {
      patientId,
      sessionId: linkedSessionId,
      appointmentId,
      therapist: fd.get("therapist")?.toString().trim() || who.fullName || null,
      performedAt: fd.get("performedAt")?.toString() ? new Date(fd.get("performedAt")!.toString()) : new Date(),
      exercises: fd.get("exercises")?.toString().trim() || null,
      response: fd.get("response")?.toString().trim() || null,
      painBefore: n("painBefore"),
      painAfter: n("painAfter"),
      notes: fd.get("notes")?.toString().trim() || null,
      nextRecommendation: fd.get("nextRecommendation")?.toString().trim() || null,
      createdById: who.id,
    },
    });
    await tx.auditLog.create({ data: { userId: who.id, action: "CREATE", tableName: "therapy_session_logs", recordId: rec.id } });
  }, { isolationLevel: "ReadCommitted" });
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/workload");
}

export async function updateCorrespondence(patientId: string, id: string, fd: FormData) {
  const s = await guardPatient("clinical.report", patientId, "record");
  await prisma.correspondence.update({ where: { id }, data: {
    subject: fd.get("subject")?.toString() || "",
    body: fd.get("body")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "correspondence", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function updateOfficialDocText(patientId: string, id: string, fd: FormData) {
  const s = await guardPatient("officialdocs.manage", patientId, "record");
  const linked = await prisma.referralRequest.findUnique({ where: { officialDocumentId: id }, select: { id: true } });
  if (linked) throw new Error("لا يمكن تعديل كتاب إرسال مرتبط من الملف العام");
  await prisma.officialDocument.update({ where: { id }, data: {
    subject: fd.get("subject")?.toString() || "",
    body: fd.get("body")?.toString() || null,
    entity: fd.get("entity")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "official_documents", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

// ---------- الإجازات المرضية للمراجعين ----------
export async function addSickLeave(patientId: string, fd: FormData) {
  const s = await guardPatient("sickleave.manage", patientId, "record");
  const start = fd.get("startDate")?.toString();
  const end = fd.get("endDate")?.toString();
  const diagnosisText = fd.get("diagnosisText")?.toString().trim();
  if (!start || !end || !diagnosisText) redirect(`/patients/${patientId}?saved=${encodeURIComponent("المدة والتشخيص مطلوبة")}`);
  const sd = new Date(start!), ed = new Date(end!);
  const days = Math.max(1, Math.round((+ed - +sd) / 86400000) + 1);
  if (ed < sd) redirect(`/patients/${patientId}?saved=${encodeURIComponent("تاريخ النهاية قبل البداية")}`);
  const needsManagerApproval = fd.getAll("needsManagerApproval").map((v) => v.toString()).includes("1");
  const l = await prisma.sickLeave.create({ data: {
    patientId, number: fd.get("number")?.toString() || null,
    startDate: sd, endDate: ed, days,
    diagnosisText: diagnosisText!, doctorName: fd.get("doctorName")?.toString() || s?.user?.name || null,
    notes: fd.get("notes")?.toString() || null, createdById: (s?.user as any)?.id,
    committee1: fd.get("committee1")?.toString().trim() || null,
    committee2: fd.get("committee2")?.toString().trim() || null,
    committee3: fd.get("committee3")?.toString().trim() || null,
    needsManagerApproval,
    officialNumber: fd.get("officialNumber")?.toString().trim() || null,
    officialDate: fd.get("officialDate") ? new Date(fd.get("officialDate")!.toString()) : null,
    sendBookNumber: fd.get("sendBookNumber")?.toString().trim() || null,
    sendBookDate: fd.get("sendBookDate")?.toString().trim() || null,
    sendBookFrom: fd.get("sendBookFrom")?.toString().trim() || null,
    directorate: fd.get("directorate")?.toString().trim() || null,
    doctorSpecialty: fd.get("doctorSpecialty")?.toString().trim() || null,
  }});
  await logAudit({ action: "CREATE", tableName: "sick_leaves", recordId: l.id, newValue: { days } });
  revalidatePath(`/patients/${patientId}`);
}

export async function deleteSickLeave(patientId: string, id: string) {
  await assertAdminDelete();
  await prisma.sickLeave.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "sick_leaves", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

// مصادقة عضو من لجنة الإجازة المرضية (member: 1 | 2 | 3)
export async function approveSickLeaveCommittee(patientId: string, id: string, member: number) {
  const s = await guardPatient("clinical.metrics", patientId, "record"); // الأطباء/المعالجون واللجنة الطبية
  const now = new Date();
  const uid = (s?.user as any)?.id;
  const data: any = {};
  if (member === 1) { data.approved1At = now; data.approved1ById = uid; }
  else if (member === 2) { data.approved2At = now; data.approved2ById = uid; }
  else if (member === 3) { data.approved3At = now; data.approved3ById = uid; }
  else throw new Error("عضو لجنة غير صحيح");
  await prisma.sickLeave.update({ where: { id }, data });
  await logAudit({ userId: uid, action: "UPDATE", tableName: "sick_leaves", recordId: id, newValue: { committeeApproval: member } });
  revalidatePath(`/patients/${patientId}`);
}

// تراجع عضو لجنة عن مصادقته
export async function unapproveSickLeaveCommittee(patientId: string, id: string, member: number) {
  const s = await guardPatient("clinical.metrics", patientId, "record");
  const data: any = {};
  if (member === 1) { data.approved1At = null; data.approved1ById = null; }
  else if (member === 2) { data.approved2At = null; data.approved2ById = null; }
  else if (member === 3) { data.approved3At = null; data.approved3ById = null; }
  await prisma.sickLeave.update({ where: { id }, data });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "sick_leaves", recordId: id, newValue: { committeeUnapprove: member } });
  revalidatePath(`/patients/${patientId}`);
}

export async function approveSickLeave(patientId: string, id: string, fd: FormData) {
  const s = await guardPatient("reports.approve", patientId, "record");
  const leave = await prisma.sickLeave.findUnique({ where: { id } });
  if (!leave || leave.patientId !== patientId) throw new Error("الإجازة غير موجودة");
  const committee = [
    { name: leave.committee1, at: leave.approved1At },
    { name: leave.committee2, at: leave.approved2At },
    { name: leave.committee3, at: leave.approved3At },
  ].filter((m) => m.name);
  if (committee.length > 0 && committee.some((m) => !m.at)) throw new Error("لا يمكن اعتماد المدير قبل اكتمال مصادقة اللجنة");
  await prisma.reportApproval.upsert({
    where: { kind_refKey: { kind: "sick-leave", refKey: id } },
    update: { approvedBy: s?.user?.name ?? "—", approvedById: (s?.user as any)?.id, title: fd.get("title")?.toString() || null, approvedAt: new Date() },
    create: { kind: "sick-leave", refKey: id, approvedBy: s?.user?.name ?? "—", approvedById: (s?.user as any)?.id, title: fd.get("title")?.toString() || null },
  });
  await logAudit({ action: "UPDATE", tableName: "report_approvals", recordId: `sick-leave:${id}` });
  revalidatePath(`/patients/${patientId}`);
}

export async function unapproveSickLeave(patientId: string, id: string) {
  await guardPatient("reports.approve", patientId, "record");
  await prisma.reportApproval.deleteMany({ where: { kind: "sick-leave", refKey: id } });
  revalidatePath(`/patients/${patientId}`);
}

// موعد الفحص القادم (رئيس المعالجين/الطبيب)
export async function setNextCheckup(patientId: string, fd: FormData) {
  const s = await guardPatient("appointments.edit", patientId, "record");
  const v = fd.get("nextCheckupAt")?.toString();
  await prisma.patient.update({ where: { id: patientId }, data: { nextCheckupAt: v ? new Date(v) : null } });
  // ينشئ موعداً فعلياً بجدول المواعيد ليظهر للجميع (نوع: فحص)
  if (v) {
    const at = new Date(v + "T09:00:00");
    const dayStart = new Date(v + "T00:00:00");
    const dayEnd = new Date(v + "T23:59:59");
    const existing = await prisma.appointment.findFirst({ where: { patientId, type: "فحص", scheduledAt: { gte: dayStart, lte: dayEnd } } });
    if (!existing) {
      await prisma.appointment.create({ data: { patientId, scheduledAt: at, type: "فحص", assignedTo: s?.user?.name ?? null, status: "SCHEDULED", notes: "موعد الفحص القادم" } });
    }
  }
  await logAudit({ action: "UPDATE", tableName: "patients", recordId: patientId, newValue: { nextCheckupAt: v || null } });
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/appointments");
}

// إحالة المريض إلى المركز المختص (رئيس المعالجين) — من تبويب التشخيص
export async function referToCenter(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.diagnosis", patientId, "record");
  const station = fd.get("station")?.toString().trim() || "إحالة للمركز المختص";
  const note = fd.get("note")?.toString() || null;
  const max = await prisma.careStage.aggregate({ where: { patientId }, _max: { sequence: true } });
  const referredStage = await prisma.careStage.create({
    data: { patientId, station, responsibleRole: "HEAD_THERAPIST", note, sequence: (max._max.sequence ?? -1) + 1, createdById: (s?.user as any)?.id },
  });
  const pt = await prisma.patient.findUnique({ where: { id: patientId }, select: { fullName: true } });
  await notifyRole("HEAD_THERAPIST", `إحالة جديدة: ${station}`, { body: pt?.fullName ?? "", link: `/patients/${patientId}`, careStageId: referredStage.id });
  await logAudit({ action: "CREATE", tableName: "care_stages", recordId: patientId, newValue: { referral: station } });
  revalidatePath(`/patients/${patientId}`);
}


// ═══ تقييم الطبيب المقيم (قبل التشخيص): علامات حيوية + إحالة لاختصاص ═══
export async function addResidentReview(patientId: string, fd: FormData) {
  const s = await guardPatient("clinical.metrics", patientId, "record");
  const num = (k: string) => { const v = fd.get(k)?.toString().trim(); return v ? Number(v) : null; };
  const referralNeeded = fd.get("referralNeeded")?.toString() === "1";
  const rec = await prisma.residentReview.create({
    data: {
      patientId,
      date: fd.get("date") ? new Date(fd.get("date")!.toString()) : new Date(),
      residentDoctor: fd.get("residentDoctor")?.toString().trim() || null,
      systolic: num("systolic"), diastolic: num("diastolic"), pulse: num("pulse"),
      temp: num("temp"), spo2: num("spo2"), respRate: num("respRate"),
      glucose: num("glucose"), weight: num("weight"),
      referralNeeded,
      specialtyType: referralNeeded ? (fd.get("specialtyType")?.toString().trim() || null) : null,
      referralReason: referralNeeded ? (fd.get("referralReason")?.toString().trim() || null) : null,
      referralNotes: referralNeeded ? (fd.get("referralNotes")?.toString().trim() || null) : null,
      generalNotes: fd.get("generalNotes")?.toString().trim() || null,
    },
  });
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "resident_reviews", recordId: rec.id });
  // إشعار الطبيب الاختصاص عند الحاجة لإحالة
  if (referralNeeded) {
    const pt = await prisma.patient.findUnique({ where: { id: patientId }, select: { fullName: true } });
    await notifyRole("DOCTOR", `إحالة من الطبيب المقيم: ${fd.get("specialtyType")?.toString() || "اختصاص"}`, { body: pt?.fullName ?? "", link: `/patients/${patientId}` });
  }
  revalidatePath(`/patients/${patientId}`);
}

export async function deleteResidentReview(patientId: string, id: string) {
  await assertAdminDelete();
  const s = await guardPatient("clinical.metrics", patientId, "record");
  await prisma.residentReview.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "resident_reviews", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}


// ═══════════ جدولة الجلسات العلاجية (رئيس المعالجين + الأدمن) ═══════════

// حارس خاص: رئيس المعالجين أو الأدمن فقط
async function guardScheduler() {
  const s = await requireSession();
  const role = (s?.user as any)?.role;
  if (role !== "HEAD_THERAPIST" && role !== "ADMIN") throw new Error("غير مصرّح — الجدولة لرئيس المعالجين أو الأدمن فقط");
  return s;
}

// توزيع تواريخ الجلسات على أيام الأسبوع المحددة، ابتداءً من startDate
// weekdays: أرقام أيام (0=الأحد .. 6=السبت)، count: عدد الجلسات
function distributeSessionDates(startDate: Date, weekdays: number[], count: number, time: string): Date[] {
  const dates: Date[] = [];
  if (!weekdays.length || count < 1) return dates;
  const [hh, mm] = (time || "10:00").split(":").map((x) => parseInt(x, 10) || 0);
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  let guard = 0;
  while (dates.length < count && guard < 400) { // حماية من حلقة لا نهائية
    if (weekdays.includes(cursor.getDay())) {
      const d = new Date(cursor);
      d.setHours(hh, mm, 0, 0);
      dates.push(d);
    }
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }
  return dates;
}

export async function scheduleSessions(patientId: string, fd: FormData) {
  await assertPatientActionScope(patientId, "record");
  const ses = await guardScheduler();
  const therapyType = (fd.get("therapyType")?.toString() as any) || "PHYSICAL";
  const centerIdRaw = Number(fd.get("centerId"));
  const centerId = Number.isInteger(centerIdRaw) && centerIdRaw > 0 ? centerIdRaw : null;
  let hall = fd.get("hall")?.toString().trim() || null;
  const therapist = fd.get("therapist")?.toString().trim() || null;
  const treatmentPlan = fd.get("treatmentPlan")?.toString().trim() || null;
  const totalSessions = fd.get("totalSessions") ? Math.max(1, Math.min(60, Number(fd.get("totalSessions")))) : 1;
  const sessionTime = fd.get("sessionTime")?.toString().trim() || "10:00";
  const startRaw = fd.get("startDate")?.toString();
  // أيام الأسبوع المختارة (checkbox values: 0..6)
  const weekdays = fd.getAll("weekdays").map((v) => parseInt(v.toString(), 10)).filter((n) => n >= 0 && n <= 6);

  if (!weekdays.length) { redirect(`/patients/${patientId}?saved=${encodeURIComponent("اختر يوماً واحداً على الأقل للمراجعة")}`); }
  if (Number.isNaN(Date.parse(startRaw || ""))) { redirect(`/patients/${patientId}?saved=${encodeURIComponent("تاريخ البداية غير صحيح")}`); }
  if (!centerId) { redirect(`/patients/${patientId}?saved=${encodeURIComponent("اختر المركز قبل القاعة")}`); }
  const activeCenter = await prisma.center.findUnique({ where: { id: centerId }, select: { active: true } });
  if (!activeCenter?.active) { redirect(`/patients/${patientId}?saved=${encodeURIComponent("المركز غير صالح")}`); }
  if ((ses.user as any)?.role !== "ADMIN") {
    const membership = await prisma.centerMembership.findFirst({ where: { centerId, userId: (ses.user as any)?.id, role: "HEAD_THERAPIST", status: "ACTIVE" } });
    if (!membership) redirect(`/patients/${patientId}?saved=${encodeURIComponent("لا يمكنك جدولة مركز خارج عضويتك")}`);
  }
  const hallResource = await assertCenterHallByName(prisma, centerId, hall).catch((error) => {
    redirect(`/patients/${patientId}?saved=${encodeURIComponent(error instanceof Error ? error.message : "الفرع/القاعة لا يتبع المركز المختار")}`);
  });
  hall = hallResource.therapyHall.name;

  const startDate = new Date(startRaw!);
  const dates = distributeSessionDates(startDate, weekdays, totalSessions, sessionTime);
  const csvDays = weekdays.sort((a, b) => a - b).join(",");
  const conflictOr: any[] = [];
  if (therapist) conflictOr.push({ assignedTo: therapist });
  if (hall) {
    conflictOr.push({ hallId: hallResource.therapyHall.id });
    conflictOr.push({ session: { is: { hallId: hallResource.therapyHall.id } } });
    conflictOr.push({ notes: { contains: `القاعة: ${hall}` } });
  }
  if (dates.length && conflictOr.length) {
    const conflicts = await prisma.appointment.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { in: dates },
        OR: conflictOr,
      },
      include: { patient: { select: { fullName: true, fileNumber: true } }, session: { select: { hall: true, hallId: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 5,
    });
    if (conflicts.length) {
      const first = conflicts[0];
      const reason = first.assignedTo === therapist ? `المعالج ${therapist}` : `القاعة ${hall}`;
      redirect(`/patients/${patientId}?saved=${encodeURIComponent(`تعارض جدولة: ${reason} لديه موعد بنفس وقت الجلسة (${first.patient.fullName} #${first.patient.fileNumber}). لم يتم إنشاء الجدولة.`)}`);
    }
  }

  // إنشاء الجلسة العلاجية بالجدولة (لا نمسّ أي جلسة سابقة)
  const session = await prisma.therapySession.create({
    data: {
      patientId, therapyType, centerId, hallId: hallResource.therapyHall.id, hall, therapist, treatmentPlan,
      totalSessions, sessionTime, weekdays: csvDays,
      startDate: dates[0] ?? startDate,
      endDate: dates[dates.length - 1] ?? null,
      scheduledById: (ses?.user as any)?.id,
    },
  });

  // إنشاء موعد لكل جلسة (مرتبط بالجلسة) — لا حذف لأي موعد قائم
  if (dates.length) {
    await prisma.appointment.createMany({
      data: dates.map((d) => ({
        patientId, scheduledAt: d, type: "جلسة علاجية", therapyType,
        assignedTo: therapist, sessionId: session.id, centerId, hallId: hallResource.therapyHall.id, status: "SCHEDULED" as any,
        notes: hall ? `القاعة: ${hall}` : null,
      })),
    });
  }

  await logAudit({ userId: (ses?.user as any)?.id, action: "CREATE", tableName: "therapy_sessions", recordId: session.id, newValue: { scheduled: dates.length, weekdays: csvDays, hall } });
  revalidatePath(`/patients/${patientId}`); revalidatePath("/appointments");
  redirect(`/patients/${patientId}?saved=${encodeURIComponent(`تمت جدولة ${dates.length} جلسة وإضافتها للمواعيد`)}`);
}

// ═══ إدارة قاعات العلاج (رئيس المعالجين + الأدمن) ═══
export async function addTherapyHall(fd: FormData) {
  await guardScheduler();
  const name = fd.get("name")?.toString().trim();
  if (name) await prisma.therapyHall.create({ data: { name } }).catch(() => {});
  revalidatePath("/patients", "layout");
}
export async function setTherapyHallActive(id: number, active: boolean) {
  await guardScheduler();
  await prisma.therapyHall.update({ where: { id }, data: { active } });
  revalidatePath("/patients", "layout");
}
