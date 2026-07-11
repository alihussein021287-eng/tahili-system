"use server";

import { assertPerm } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function clean(v: FormDataEntryValue | null) {
  return v?.toString().trim() || null;
}

export async function addOfficialDocument(fd: FormData) {
  await assertPerm("officialdocs.manage");
  const number = clean(fd.get("number"));
  const subject = clean(fd.get("subject"));
  const docDate = clean(fd.get("docDate"));
  if (!number || !subject || !docDate) {
    redirect("/official-docs?err=" + encodeURIComponent("رقم الكتاب والتاريخ والموضوع مطلوبة"));
  }

  const file = fd.get("attachment") as File | null;
  const attachmentUrl = file && file.size > 0 ? `/api/files/${(await saveFile(file)).key}` : null;
  const patientId = clean(fd.get("patientId"));
  const doc = await prisma.officialDocument.create({
    data: {
      patientId,
      docType: (clean(fd.get("docType")) as any) || "LETTER",
      direction: (clean(fd.get("direction")) as any) || "INCOMING",
      number,
      docDate: new Date(docDate),
      subject,
      entity: clean(fd.get("entity")),
      body: clean(fd.get("body")),
      attachmentUrl,
    },
  });
  await logAudit({ action: "CREATE", tableName: "official_documents", recordId: doc.id, newValue: { number, subject, patientId } });
  revalidatePath("/official-docs");
  if (patientId) revalidatePath(`/patients/${patientId}`);
  redirect("/official-docs?msg=" + encodeURIComponent(`تمت أرشفة الوثيقة: ${number}`));
}

export async function updateOfficialDocument(id: string, fd: FormData) {
  await assertPerm("officialdocs.manage");
  const number = clean(fd.get("number"));
  const subject = clean(fd.get("subject"));
  const docDate = clean(fd.get("docDate"));
  if (!number || !subject || !docDate) {
    redirect(`/official-docs/${id}?err=` + encodeURIComponent("رقم الكتاب والتاريخ والموضوع مطلوبة"));
  }
  const old = await prisma.officialDocument.findUnique({ where: { id }, select: { patientId: true, attachmentUrl: true } });
  const file = fd.get("attachment") as File | null;
  const attachmentUrl = file && file.size > 0 ? `/api/files/${(await saveFile(file)).key}` : old?.attachmentUrl;
  const doc = await prisma.officialDocument.update({
    where: { id },
    data: {
      patientId: clean(fd.get("patientId")),
      docType: (clean(fd.get("docType")) as any) || "LETTER",
      direction: (clean(fd.get("direction")) as any) || "INCOMING",
      number,
      docDate: new Date(docDate),
      subject,
      entity: clean(fd.get("entity")),
      body: clean(fd.get("body")),
      attachmentUrl,
    },
  });
  await logAudit({ action: "UPDATE", tableName: "official_documents", recordId: id, newValue: { number, subject } });
  revalidatePath("/official-docs");
  revalidatePath(`/official-docs/${id}`);
  if (old?.patientId) revalidatePath(`/patients/${old.patientId}`);
  if (doc.patientId) revalidatePath(`/patients/${doc.patientId}`);
  redirect(`/official-docs/${id}?msg=` + encodeURIComponent("تم حفظ التعديلات"));
}
