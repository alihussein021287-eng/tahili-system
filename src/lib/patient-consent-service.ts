import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ClinicalActor } from "@/lib/clinical-review-service";
import { currentTherapyActor } from "@/lib/therapy-session-lock";
import { withSerializableRetry } from "@/lib/serializable-retry";
import { validateCollaborationUpload, DEFAULT_BLOCKED_FILE_TYPES, sha256 } from "@/lib/collaboration-rules";
import { putCollaborationObject, getCollaborationObject } from "@/lib/collaboration-storage";
import { scanBufferWithClamAv } from "@/lib/collaboration-scan";
import { parseConsentSignedDate } from "@/lib/consent-date";

export async function consentActor(tx: Prisma.TransactionClient, actor: ClinicalActor, permission: string, patientId: string, filePermission: string) {
  const user = await currentTherapyActor(tx, { id: actor.userId, role: actor.role, authVersion: actor.authVersion }, permission, patientId);
  if (!user.permissions.has(filePermission) || !(await tx.patient.findFirst({ where: { id: patientId, ...(permission === "consents.view" ? {} : { archivedAt: null }) }, select: { id: true } }))) throw new Error("غير مصرح بالموافقة");
  if (permission === "consents.view" && !user.permissions.has("files.view")) throw new Error("غير مصرح بالموافقة");
  return user;
}
type ConsentInput = { procedure: string; documentCode: string; documentVersion: string; signerName: string; signerCapacity: string; representationBasis?: string; signedAt: string; attestedSigned: boolean; careStageId?: string };
function validate(input: ConsentInput) {
  for (const k of ["procedure", "documentCode", "documentVersion", "signerName"] as const) if (!input[k]?.trim() || input[k].length > 300) throw new Error("بيانات الموافقة والمستند والموقّع مطلوبة");
  const date = parseConsentSignedDate(input.signedAt);
  if (!input.attestedSigned || !["PATIENT", "GUARDIAN", "REPRESENTATIVE"].includes(input.signerCapacity)
    || (input.signerCapacity !== "PATIENT" && !input.representationBasis?.trim()) || (input.representationBasis?.length ?? 0) > 1000) throw new Error("تحقق من دليل التوقيع وصفة الموقّع وتاريخه");
  return date;
}

/** A new immutable evidence record for every version; no collaboration-share path. */
export async function recordSignedConsent(actor: ClinicalActor, patientId: string, input: ConsentInput, file: File) {
  const signedAt = validate(input);
  await prisma.$transaction(tx => consentActor(tx, actor, "consents.record", patientId, "files.upload"));
  const settings = await prisma.collaborationSettings.findUnique({ where: { id: 1 } });
  if (settings?.servicePaused) throw new Error("خدمة الملفات متوقفة");
  const maxMb = Math.min(20, settings?.maxUploadMb ?? 20);
  if (!(file instanceof File) || file.size <= 0 || file.size > maxMb * 1024 * 1024) throw new Error("ملف الموافقة مفقود أو كبير");
  // Reject routine duplicates/quota failures before allocating an immutable
  // object. The authoritative transaction repeats quota enforcement after scan.
  await prisma.$transaction(async tx => {
    await consentActor(tx, actor, "consents.record", patientId, "files.upload");
    if (await tx.patientConsent.findUnique({ where: { patientId_documentCode_documentVersion: {
      patientId, documentCode: input.documentCode.trim(), documentVersion: input.documentVersion.trim(),
    } } })) throw new Error("هذا الإصدار محفوظ؛ سجّل إصداراً مستقلاً دون استبداله");
    const [own, shared] = await Promise.all([
      tx.patientConsent.aggregate({ where: { recordedById: actor.userId }, _sum: { size: true } }),
      tx.collaborationFile.aggregate({ where: { ownerId: actor.userId, deletedAt: null, permanentlyDeletedAt: null, scanStatus: { not: "REJECTED" } }, _sum: { size: true } }),
    ]);
    if ((own._sum.size ?? 0) + (shared._sum.size ?? 0) + file.size > (settings?.userQuotaMb ?? 1024) * 1024 * 1024) throw new Error("تجاوزت حصة التخزين");
  });
  const buffer = Buffer.from(await file.arrayBuffer());
  const allowed = Array.isArray(settings?.allowedTypes) ? settings.allowedTypes.map(String) : ["pdf", "png", "jpg", "jpeg"];
  const blocked = [...DEFAULT_BLOCKED_FILE_TYPES, ...(Array.isArray(settings?.blockedTypes) ? settings.blockedTypes.map(String) : [])];
  const validation = validateCollaborationUpload({ name: file.name, size: file.size, declaredType: file.type, buffer,
    settings: { maxUploadMb: maxMb, allowedTypes: allowed, blockedTypes: blocked } });
  if (!["pdf", "png", "jpg", "jpeg"].includes(validation.extension)) throw new Error("نوع دليل الموافقة غير مسموح");
  if (!["application/pdf", "image/png", "image/jpeg"].includes(validation.mimeType)) throw new Error("دليل الموافقة يجب أن يكون PDF أو صورة موقعة");
  const scan = await scanBufferWithClamAv(buffer);
  if (scan.status !== "SAFE") throw new Error("لم ينجح الفحص الأمني لدليل الموافقة؛ لم تُسجل موافقة");
  const storageKey = `consents/${randomUUID()}.${validation.extension}`, hash = sha256(buffer);
  await putCollaborationObject(storageKey, buffer, { mimeType: validation.mimeType, originalName: validation.safeName });
  return withSerializableRetry(() => prisma.$transaction(async tx => {
    await consentActor(tx, actor, "consents.record", patientId, "files.upload");
    // Serialize version creation and withdrawal for one patient, then re-check scope.
    await tx.$queryRaw`SELECT id FROM patients WHERE id=${patientId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.userId} FOR UPDATE`;
    const [consents, collaboration] = await Promise.all([
      tx.patientConsent.aggregate({ where: { recordedById: actor.userId }, _sum: { size: true } }),
      tx.collaborationFile.aggregate({ where: { ownerId: actor.userId, deletedAt: null, permanentlyDeletedAt: null, scanStatus: { not: "REJECTED" } }, _sum: { size: true } }),
    ]);
    if ((consents._sum.size ?? 0) + (collaboration._sum.size ?? 0) + buffer.length > (settings?.userQuotaMb ?? 1024) * 1024 * 1024) throw new Error("تجاوزت حصة التخزين");
    if (input.careStageId && !(await tx.careStage.findFirst({ where: { id: input.careStageId, patientId }, select: { id: true } }))) throw new Error("الإجراء لا يتبع المراجع");
    const row = await tx.patientConsent.create({ data: { patientId, careStageId: input.careStageId || null, procedure: input.procedure.trim(),
      documentCode: input.documentCode.trim(), documentVersion: input.documentVersion.trim(), signerName: input.signerName.trim(), signerCapacity: input.signerCapacity,
      representationBasis: input.representationBasis?.trim() || null, signedAt, recordedById: actor.userId,
      storageKey, originalName: validation.safeName, mimeType: validation.mimeType, size: buffer.length, sha256: hash, scanStatus: "SAFE" } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", tableName: "patient_consents", recordId: row.id,
      newValue: { patientId, documentCode: row.documentCode, documentVersion: row.documentVersion, sha256: hash, scanEngine: scan.engine, scanStatus: scan.status, recorderAttestedSigned: true } } });
    return row.id;
  }, { isolationLevel: "Serializable" }));
}

export async function withdrawConsent(tx: Prisma.TransactionClient, actor: ClinicalActor, patientId: string, id: string, reason: string) {
  await tx.$queryRaw`SELECT id FROM patients WHERE id=${patientId} FOR UPDATE`;
  await consentActor(tx, actor, "consents.withdraw", patientId, "files.view");
  if (!reason.trim() || reason.length > 1000) throw new Error("سبب سحب الموافقة مطلوب");
  const row = await tx.patientConsent.findFirst({ where: { id, patientId } });
  if (!row) throw new Error("الموافقة غير متاحة");
  if (row.status === "WITHDRAWN") return;
  const at = new Date();
  await tx.patientConsent.update({ where: { id }, data: { status: "WITHDRAWN", withdrawnById: actor.userId, withdrawnAt: at, withdrawalReason: reason.trim() } });
  await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", tableName: "patient_consents", recordId: id,
    newValue: { status: "WITHDRAWN", withdrawnById: actor.userId, withdrawnAt: at.toISOString(), reason: reason.trim() } } });
}

export async function readConsentEvidence(actor: ClinicalActor, patientId: string, id: string) {
  const row = await withSerializableRetry(() => prisma.$transaction(async tx => {
    await consentActor(tx, actor, "consents.view", patientId, "files.download");
    const row = await tx.patientConsent.findFirst({ where: { id, patientId, scanStatus: "SAFE" } });
    if (!row) throw new Error("الموافقة غير متاحة");
    return row;
  }, { isolationLevel: "Serializable" }));
  const buffer = await getCollaborationObject(row.storageKey);
  if (!buffer || buffer.length !== row.size || sha256(buffer) !== row.sha256) throw new Error("دليل الموافقة غير متاح أو لا تطابق بصمته");
  const checked = await withSerializableRetry(() => prisma.$transaction(async tx => {
    await consentActor(tx, actor, "consents.view", patientId, "files.download");
    const current = await tx.patientConsent.findFirst({ where: { id, patientId, sha256: row.sha256, scanStatus: "SAFE" } });
    if (!current) throw new Error("الموافقة غير متاحة");
    await tx.auditLog.create({ data: { userId: actor.userId, action: "READ", tableName: "patient_consents", recordId: id,
      newValue: { documentVersion: current.documentVersion, status: current.status } } });
    return current;
  }, { isolationLevel: "Serializable" }));
  return { row: checked, buffer };
}
