"use server";
import { requireSession } from "@/lib/access";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { canDelete, ROLE_LABELS } from "@/lib/permissions";
import { notifyRole } from "@/lib/notify";
import { logAudit } from "@/lib/audit";
import { saveFile } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

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
async function guard(key: string) {
  const s = await requireSession();
  await assertPerm(key);
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
    formationText: s("formationText"), referralSource: s("referralSource"),
    referralBookNo: s("referralBookNo"), referredToCenter: s("referredToCenter"),
    referralBookDate: s("referralBookDate") ? new Date(s("referralBookDate")!) : null,
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

export async function createPatient(fd: FormData) {
  const s = await guard("patients.create");
  const data = parsePatient(fd);
  // مدخل البيانات = المستخدم الحالي حصراً (إجباري تلقائياً)
  (data as any).dataEntryBy = s?.user?.name || (s?.user as any)?.username || "غير معروف";
  const v = patientSchema.safeParse(data);
  if (!v.success) redirect(`/patients/new?saved=${encodeURIComponent(v.error.issues[0]?.message || "بيانات غير صحيحة")}`);
  const dup = await findDuplicate(data);
  if (dup) redirect(`/patients/new?saved=${encodeURIComponent(duplicateMessage(dup))}`);
  const photo = fd.get("photo") as File | null;
  const photoUrl = photo && photo.size > 0 ? `/api/files/${(await saveFile(photo)).key}` : null;
  const p = await prisma.patient.create({ data: { ...data, photoUrl, createdById: (s?.user as any)?.id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "patients", recordId: p.id, newValue: data });
  revalidatePath("/patients");
  redirect(`/patients/${p.id}?saved=1`);
}

export async function updatePatient(id: string, fd: FormData) {
  const s = await guard("patients.edit");
  const before = await prisma.patient.findUnique({ where: { id } });
  const data = parsePatient(fd);
  // نحافظ على مُدخِل البيانات الأصلي
  (data as any).dataEntryBy = before?.dataEntryBy ?? (s?.user?.name || (s?.user as any)?.username || null);
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
  const s = await guard("clinical.diagnosis");
  const rec = await prisma.diagnosis.create({ data: {
    patientId, type: (fd.get("type")?.toString() as any) || "PRELIMINARY",
    text: fd.get("text")?.toString() || "", doctor: fd.get("doctor")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "diagnoses", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addReport(patientId: string, fd: FormData) {
  const s = await guard("clinical.report");
  const rec = await prisma.medicalReport.create({ data: {
    patientId, content: fd.get("content")?.toString() || "", doctor: fd.get("doctor")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "medical_reports", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addSession(patientId: string, fd: FormData) {
  const s = await guard("clinical.session");
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
  const s = await guard("clinical.prescription");
  const medicationId = fd.get("medicationId") ? Number(fd.get("medicationId")) : null;
  const qtyStr = fd.get("quantity")?.toString() || null;
  const rec = await prisma.prescription.create({ data: {
    patientId, materialName: fd.get("materialName")?.toString() || null,
    medicationId,
    usage: fd.get("usage")?.toString() || null, doctor: fd.get("doctor")?.toString() || null,
    quantity: qtyStr, duration: fd.get("duration")?.toString() || null,
  }});
  // الخصم من المخزون لم يعد هنا — يتم عند تجهيز الصيدلي (FEFO) في قسم الصيدلية
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "prescriptions", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/pharmacy");
}

export async function addAdmission(patientId: string, fd: FormData) {
  const s = await guard("clinical.admission");
  const rec = await prisma.admission.create({ data: {
    patientId, admissionDate: new Date(fd.get("admissionDate")?.toString() || Date.now()),
    centerId: fd.get("centerId") ? Number(fd.get("centerId")) : null,
    roomId: fd.get("roomId") ? Number(fd.get("roomId")) : null,
    durationDays: fd.get("durationDays") ? Number(fd.get("durationDays")) : null,
    notes: fd.get("notes")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "admissions", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addTreatmentPlan(patientId: string, fd: FormData) {
  const s = await guard("clinical.plan");
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
  const s = await guard("clinical.plan");
  await prisma.treatmentPlan.update({ where: { id }, data: { status } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "patients", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}
export async function deleteTreatmentPlan(patientId: string, id: string) {
  await assertAdminDelete();
  const s = await guard("clinical.plan");
  await prisma.treatmentPlan.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "patients", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addVitalSign(patientId: string, fd: FormData) {
  const s = await guard("clinical.metrics");
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
  const s = await guard("clinical.metrics");
  await prisma.vitalSign.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "patients", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addProgressMetric(patientId: string, fd: FormData) {
  const s = await guard("clinical.metrics");
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
  const s = await guard("clinical.metrics");
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

  if (createRows.length > 0) {
    await prisma.patient.createMany({
      data: createRows.map((r) => ({
        fullName: r.fullName,
        phone: r.phone,
        motherName: r.motherName,
        birthYear: r.birthYear,
        housing: r.housing,
        notes: r.notes,
        createdById: (s?.user as any)?.id,
        dataEntryBy: s?.user?.name || (s?.user as any)?.username || null,
      })),
    });
  }

  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "patients", recordId: `import:${createRows.length}`, newValue: { valid: parsed.rows.length, errors: errors.length } });
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
  const s = await guard("patients.archive");
  await prisma.patient.update({ where: { id }, data: { archivedAt: new Date() } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "patients", recordId: id });
  redirect("/patients?archived=1");
}
export async function restorePatient(id: string) {
  const s = await guard("patients.archive");
  await prisma.patient.update({ where: { id }, data: { archivedAt: null } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "patients", recordId: id });
  redirect(`/patients/${id}`);
}

export async function updateAdmissionDuration(patientId: string, admissionId: string, fd: FormData) {
  const s = await guard("clinical.admission");
  const d = fd.get("durationDays")?.toString();
  await prisma.admission.update({ where: { id: admissionId }, data: { durationDays: d ? Number(d) : null } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "admissions", recordId: admissionId });
  revalidatePath(`/patients/${patientId}`);
}

export async function dischargeAdmission(patientId: string, admissionId: string, fd?: FormData) {
  await guard("clinical.admission");
  const dd = fd?.get("dischargeDate")?.toString();
  await prisma.admission.update({ where: { id: admissionId }, data: { status: "DISCHARGED", dischargeDate: dd ? new Date(dd) : new Date() } });
  revalidatePath(`/patients/${patientId}`);
}

export async function addCorrespondence(patientId: string, fd: FormData) {
  const s = await guard("clinical.report");
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
  const s = await guard("patients.edit");
  const rec = await prisma.relative.create({ data: {
    patientId, name: fd.get("name")?.toString() || null, job: fd.get("job")?.toString() || null,
    workplace: fd.get("workplace")?.toString() || null, socialStatus: fd.get("socialStatus")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "relatives", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

// تقييم الجروح مع رفع صورة
export async function addWound(patientId: string, fd: FormData) {
  const s = await guard("clinical.wound");
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
  const s = await guard("clinical.report");
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
  await guard("patients.portal");
  const token = randomBytes(32).toString("hex");
  await prisma.patient.update({ where: { id: patientId }, data: { accessToken: token } });
  revalidatePath(`/patients/${patientId}`);
}

export async function revokePortalToken(patientId: string) {
  await guard("patients.portal");
  await prisma.patient.update({ where: { id: patientId }, data: { accessToken: null } });
  revalidatePath(`/patients/${patientId}`);
}

// حذف السجلات السريرية (لتصحيح الأخطاء)
export async function deleteDiagnosis(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guard("clinical.diagnosis"); await prisma.diagnosis.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "diagnoses", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteReport(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guard("clinical.report"); await prisma.medicalReport.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "medical_reports", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteSession(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guard("clinical.session"); await prisma.therapySession.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "therapy_sessions", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deletePrescription(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guard("clinical.prescription"); await prisma.prescription.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "prescriptions", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteAdmission(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guard("clinical.admission"); await prisma.admission.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "admissions", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteWound(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guard("clinical.wound"); await prisma.woundAssessment.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "wound_assessments", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteCorrespondence(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guard("clinical.report"); await prisma.correspondence.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "correspondence", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteRelative(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guard("patients.edit"); await prisma.relative.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "relatives", recordId: id }); revalidatePath(`/patients/${patientId}`); }
export async function deleteAttachment(patientId: string, id: string) {
  await assertAdminDelete(); const s = await guard("clinical.report"); await prisma.attachment.delete({ where: { id } }); await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "attachments", recordId: id }); revalidatePath(`/patients/${patientId}`); }

// ===== تحميل بيانات التبويب عند الطلب (لتخفيف تحميل صفحة المريض) =====
export async function getPatientTabData(patientId: string, tab: string) {
  await assertPerm("patients.view");
  switch (tab) {
    case "files":
      return prisma.attachment.findMany({ where: { patientId }, orderBy: { uploadedAt: "desc" } });
    case "metrics":
      return prisma.progressMetric.findMany({ where: { patientId }, orderBy: { date: "asc" } });
    case "vitals":
      return prisma.vitalSign.findMany({ where: { patientId }, orderBy: { date: "asc" } });
    case "resident":
      return prisma.residentReview.findMany({ where: { patientId }, orderBy: { date: "desc" } });
    case "referrals":
      return prisma.referralRequest.findMany({ where: { patientId }, include: { destinationCenter: { select: { name: true } }, assignedReviewer: { select: { fullName: true } } }, orderBy: { createdAt: "desc" } });
    case "plan":
      return prisma.treatmentPlan.findMany({ where: { patientId }, orderBy: { createdAt: "desc" } });
    case "rel":
      return prisma.relative.findMany({ where: { patientId } });
    case "activity":
      return prisma.auditLog.findMany({ where: { tableName: "patients", recordId: patientId }, include: { user: true }, orderBy: { createdAt: "desc" }, take: 80 });
    case "care":
      return prisma.dressingRecord.findMany({ where: { patientId }, orderBy: { date: "desc" } });
    default:
      return [];
  }
}

// ===== التداوي والتضميد =====
// خصم FEFO من دفعات المخزون عند استهلاك مادة
async function deductStockFEFO(medicationId: number, qty: number, who: { id?: string; name?: string | null }, patientId: string, patientName: string | null) {
  if (!qty || qty <= 0) return;
  let remaining = qty;
  const batches = await prisma.medicationBatch.findMany({
    where: { medicationId, quantity: { gt: 0 } },
    orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  });
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    await prisma.medicationBatch.update({ where: { id: b.id }, data: { quantity: b.quantity - take } });
    try {
      await prisma.stockMovement.create({ data: {
        type: "DISPENSE", medicationId, batchId: b.id, quantity: take,
        byName: who.name ?? null, patientId, patientName, reason: "تداوي/تضميد",
      }});
    } catch {}
    remaining -= take;
  }
  const agg = await prisma.medicationBatch.aggregate({ where: { medicationId }, _sum: { quantity: true } });
  await prisma.medication.update({ where: { id: medicationId }, data: { quantity: Math.max(0, agg._sum.quantity ?? 0) } });
}

export async function addCareRecord(patientId: string, fd: FormData) {
  const s = await guard("clinical.care");
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
    await deductStockFEFO(medicationId, quantity, { id: (s?.user as any)?.id, name: (s?.user?.name as string) ?? null }, patientId, pt?.fullName ?? null);
  }
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "dressing_records", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function deleteCareRecord(patientId: string, id: string) {
  await assertAdminDelete();
  const s = await guard("clinical.care");
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

// يتأكّد أن المستخدم يملك دور المحطة (أو مدير/أدمن تجاوز إداري)
function canConfirmStage(userRole: string | undefined, stageRole: string | null | undefined): boolean {
  if (userRole === "ADMIN" || userRole === "MANAGER") return true; // تجاوز إداري
  if (!stageRole) return true; // محطة بلا دور محدد — أي مخوّل
  return userRole === stageRole;
}

export async function startPathway(patientId: string) {
  const s = await guard("journey.manage");
  const count = await prisma.careStage.count({ where: { patientId } });
  if (count > 0) redirect(`/patients/${patientId}?saved=${encodeURIComponent("المسار موجود مسبقاً")}`);
  await prisma.careStage.createMany({ data: DEFAULT_PATHWAY.map((st, i) => ({ patientId, station: st.station, responsibleRole: st.role as any, sequence: i, createdById: (s?.user as any)?.id })) });
  await logAudit({ action: "CREATE", tableName: "care_stages", recordId: patientId, newValue: { pathway: "default" } });
  revalidatePath(`/patients/${patientId}`);
}

export async function addStage(patientId: string, fd: FormData) {
  const s = await guard("journey.manage");
  const station = fd.get("station")?.toString().trim();
  if (!station) redirect(`/patients/${patientId}?saved=${encodeURIComponent("اسم المحطة مطلوب")}`);
  const max = await prisma.careStage.aggregate({ where: { patientId }, _max: { sequence: true } });
  const t = await prisma.careStage.create({ data: { patientId, station: station!, responsibleRole: (fd.get("responsibleRole")?.toString() as any) || null, note: fd.get("note")?.toString() || null, sequence: (max._max.sequence ?? -1) + 1, createdById: (s?.user as any)?.id } });
  await logAudit({ action: "CREATE", tableName: "care_stages", recordId: t.id });
  revalidatePath(`/patients/${patientId}`);
}

export async function confirmStage(patientId: string, id: string) {
  const s = await guard("journey.confirm");
  const role = (s?.user as any)?.role;
  const stage = await prisma.careStage.findUnique({ where: { id }, select: { responsibleRole: true } });
  if (stage && !canConfirmStage(role, stage.responsibleRole)) {
    redirect(`/patients/${patientId}?saved=${encodeURIComponent(`هذه المحطة يؤكّدها «${ROLE_LABELS[stage.responsibleRole as keyof typeof ROLE_LABELS]}» فقط`)}`);
  }
  await prisma.careStage.update({ where: { id }, data: { status: "CONFIRMED", confirmedBy: s?.user?.name ?? null, confirmedById: (s?.user as any)?.id, confirmedAt: new Date() } });
  await logAudit({ action: "UPDATE", tableName: "care_stages", recordId: id, newValue: { status: "CONFIRMED", by: role } });
  // إشعار المحطة التالية
  try {
    const cur = await prisma.careStage.findUnique({ where: { id }, select: { sequence: true } });
    const next = await prisma.careStage.findFirst({ where: { patientId, sequence: { gt: cur?.sequence ?? -1 }, status: { in: ["WAITING", "IN_PROGRESS"] } }, orderBy: { sequence: "asc" } });
    if (next?.responsibleRole) {
      const pt = await prisma.patient.findUnique({ where: { id: patientId }, select: { fullName: true } });
      await notifyRole(next.responsibleRole, `مراجع بمحطتك: ${next.station}`, { body: pt?.fullName ?? "", link: `/patients/${patientId}` });
    }
  } catch {}
  revalidatePath(`/patients/${patientId}`);
}

export async function setStageStatus(patientId: string, id: string, status: string) {
  const s = await guard("journey.confirm");
  const role = (s?.user as any)?.role;
  const stage = await prisma.careStage.findUnique({ where: { id }, select: { responsibleRole: true } });
  if (stage && !canConfirmStage(role, stage.responsibleRole)) {
    redirect(`/patients/${patientId}?saved=${encodeURIComponent(`هذه المحطة يديرها «${ROLE_LABELS[stage.responsibleRole as keyof typeof ROLE_LABELS]}» فقط`)}`);
  }
  const data: any = { status };
  if (status !== "CONFIRMED") { data.confirmedBy = null; data.confirmedById = null; data.confirmedAt = null; }
  await prisma.careStage.update({ where: { id }, data });
  await logAudit({ action: "UPDATE", tableName: "care_stages", recordId: id, newValue: { status } });
  revalidatePath(`/patients/${patientId}`);
}

export async function deleteStage(patientId: string, id: string) {
  await assertAdminDelete();
  await guard("journey.manage");
  await prisma.careStage.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "care_stages", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

// ---------- الإجراءات الرسمية ----------
export async function addOfficialDoc(patientId: string, fd: FormData) {
  const s = await guard("officialdocs.manage");
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
  await guard("officialdocs.manage");
  const linked = await prisma.referralRequest.findUnique({ where: { officialDocumentId: id }, select: { id: true } });
  if (linked) throw new Error("لا يمكن حذف كتاب إرسال مرتبط بطلب إحالة");
  await prisma.officialDocument.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "official_documents", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

// ---------- تعديل السجلات النصية (بدل الحذف) ----------
export async function updateDiagnosis(patientId: string, id: string, fd: FormData) {
  const s = await guard("clinical.diagnosis");
  await prisma.diagnosis.update({ where: { id }, data: {
    type: (fd.get("type")?.toString() as any) || "PRELIMINARY",
    text: fd.get("text")?.toString() || "",
    doctor: fd.get("doctor")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "diagnoses", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function updateSessionRecord(patientId: string, id: string, fd: FormData) {
  const s = await guard("clinical.session");
  await prisma.therapySession.update({ where: { id }, data: {
    treatmentPlan: fd.get("treatmentPlan")?.toString() || null,
    totalSessions: fd.get("totalSessions") ? Number(fd.get("totalSessions")) : null,
    actualSessions: fd.get("actualSessions") ? Number(fd.get("actualSessions")) : 0,
    therapist: fd.get("therapist")?.toString() || null,
    hall: fd.get("hall")?.toString() || null,
    notes: fd.get("notes")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "therapy_sessions", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function addTherapySessionLog(patientId: string, fd: FormData) {
  const s = await guard("clinical.session");
  const n = (key: string) => {
    const raw = fd.get(key)?.toString().trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(10, Math.round(value))) : null;
  };
  const rec = await prisma.therapySessionLog.create({
    data: {
      patientId,
      sessionId: fd.get("sessionId")?.toString() || null,
      appointmentId: fd.get("appointmentId")?.toString() || null,
      therapist: fd.get("therapist")?.toString().trim() || s?.user?.name || null,
      performedAt: fd.get("performedAt")?.toString() ? new Date(fd.get("performedAt")!.toString()) : new Date(),
      exercises: fd.get("exercises")?.toString().trim() || null,
      response: fd.get("response")?.toString().trim() || null,
      painBefore: n("painBefore"),
      painAfter: n("painAfter"),
      notes: fd.get("notes")?.toString().trim() || null,
      nextRecommendation: fd.get("nextRecommendation")?.toString().trim() || null,
      createdById: (s?.user as any)?.id,
    },
  });
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "therapy_session_logs", recordId: rec.id });
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/workload");
}

export async function updateCorrespondence(patientId: string, id: string, fd: FormData) {
  const s = await guard("clinical.report");
  await prisma.correspondence.update({ where: { id }, data: {
    subject: fd.get("subject")?.toString() || "",
    body: fd.get("body")?.toString() || null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "correspondence", recordId: id });
  revalidatePath(`/patients/${patientId}`);
}

export async function updateOfficialDocText(patientId: string, id: string, fd: FormData) {
  const s = await guard("officialdocs.manage");
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
  const s = await guard("sickleave.manage");
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
  const s = await guard("clinical.metrics"); // الأطباء/المعالجون واللجنة الطبية
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
  const s = await guard("clinical.metrics");
  const data: any = {};
  if (member === 1) { data.approved1At = null; data.approved1ById = null; }
  else if (member === 2) { data.approved2At = null; data.approved2ById = null; }
  else if (member === 3) { data.approved3At = null; data.approved3ById = null; }
  await prisma.sickLeave.update({ where: { id }, data });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "sick_leaves", recordId: id, newValue: { committeeUnapprove: member } });
  revalidatePath(`/patients/${patientId}`);
}

export async function approveSickLeave(patientId: string, id: string, fd: FormData) {
  const s = await guard("reports.approve");
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
  await guard("reports.approve");
  await prisma.reportApproval.deleteMany({ where: { kind: "sick-leave", refKey: id } });
  revalidatePath(`/patients/${patientId}`);
}

// موعد الفحص القادم (رئيس المعالجين/الطبيب)
export async function setNextCheckup(patientId: string, fd: FormData) {
  const s = await guard("appointments.edit");
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
  const s = await guard("clinical.diagnosis");
  const station = fd.get("station")?.toString().trim() || "إحالة للمركز المختص";
  const note = fd.get("note")?.toString() || null;
  const max = await prisma.careStage.aggregate({ where: { patientId }, _max: { sequence: true } });
  await prisma.careStage.create({
    data: { patientId, station, responsibleRole: "HEAD_THERAPIST", note, sequence: (max._max.sequence ?? -1) + 1, createdById: (s?.user as any)?.id },
  });
  const pt = await prisma.patient.findUnique({ where: { id: patientId }, select: { fullName: true } });
  await notifyRole("HEAD_THERAPIST", `إحالة جديدة: ${station}`, { body: pt?.fullName ?? "", link: `/patients/${patientId}` });
  await logAudit({ action: "CREATE", tableName: "care_stages", recordId: patientId, newValue: { referral: station } });
  revalidatePath(`/patients/${patientId}`);
}


// ═══ تقييم الطبيب المقيم (قبل التشخيص): علامات حيوية + إحالة لاختصاص ═══
export async function addResidentReview(patientId: string, fd: FormData) {
  const s = await guard("clinical.metrics");
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
  const s = await guard("clinical.metrics");
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
  const ses = await guardScheduler();
  const therapyType = (fd.get("therapyType")?.toString() as any) || "PHYSICAL";
  const centerId = fd.get("centerId") ? Number(fd.get("centerId")) : null;
  const hall = fd.get("hall")?.toString().trim() || null;
  const therapist = fd.get("therapist")?.toString().trim() || null;
  const treatmentPlan = fd.get("treatmentPlan")?.toString().trim() || null;
  const totalSessions = fd.get("totalSessions") ? Math.max(1, Math.min(60, Number(fd.get("totalSessions")))) : 1;
  const sessionTime = fd.get("sessionTime")?.toString().trim() || "10:00";
  const startRaw = fd.get("startDate")?.toString();
  // أيام الأسبوع المختارة (checkbox values: 0..6)
  const weekdays = fd.getAll("weekdays").map((v) => parseInt(v.toString(), 10)).filter((n) => n >= 0 && n <= 6);

  if (!weekdays.length) { redirect(`/patients/${patientId}?saved=${encodeURIComponent("اختر يوماً واحداً على الأقل للمراجعة")}`); }
  if (Number.isNaN(Date.parse(startRaw || ""))) { redirect(`/patients/${patientId}?saved=${encodeURIComponent("تاريخ البداية غير صحيح")}`); }

  const startDate = new Date(startRaw!);
  const dates = distributeSessionDates(startDate, weekdays, totalSessions, sessionTime);
  const csvDays = weekdays.sort((a, b) => a - b).join(",");
  const conflictOr: any[] = [];
  if (therapist) conflictOr.push({ assignedTo: therapist });
  if (hall) {
    conflictOr.push({ session: { is: { hall } } });
    conflictOr.push({ notes: { contains: `القاعة: ${hall}` } });
  }
  if (dates.length && conflictOr.length) {
    const conflicts = await prisma.appointment.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { in: dates },
        OR: conflictOr,
      },
      include: { patient: { select: { fullName: true, fileNumber: true } }, session: { select: { hall: true } } },
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
      patientId, therapyType, centerId, hall, therapist, treatmentPlan,
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
        assignedTo: therapist, sessionId: session.id, status: "SCHEDULED" as any,
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
