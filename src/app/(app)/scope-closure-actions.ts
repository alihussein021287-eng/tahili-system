"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { withSerializableRetry } from "@/lib/serializable-retry";
import type { ClinicalActor } from "@/lib/clinical-review-service";
import { designateServiceResponsibility, revokeServiceResponsibility, assignServiceStage, executeServiceStage } from "@/lib/service-responsibility";
import { recordSignedConsent, withdrawConsent } from "@/lib/patient-consent-service";
import { revalidatePath } from "next/cache";
async function actor(): Promise<ClinicalActor> {
  const u = (await requireSession()).user as { id: string; role: ClinicalActor["role"]; authVersion: number };
  return { userId: u.id, role: u.role, authVersion: u.authVersion };
}
const text = (f: FormData, k: string) => f.get(k)?.toString().trim() || "";
function refresh(patientId?: string) { revalidatePath("/settings"); revalidatePath("/my-work"); if (patientId) revalidatePath(`/patients/${patientId}`); }
export async function designateServiceAction(fd: FormData) {
  const u = await actor(); const branchId = Number(text(fd, "branchId"));
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw new Error("فرع غير صالح");
  await withSerializableRetry(() => prisma.$transaction(tx => designateServiceResponsibility(tx, u, { branchId, serviceKey: text(fd, "serviceKey"), responsibleId: text(fd, "responsibleId") }), { isolationLevel: "Serializable" })); refresh();
}
export async function revokeServiceAction(id: string, fd: FormData) {
  const u = await actor(); await withSerializableRetry(() => prisma.$transaction(tx => revokeServiceResponsibility(tx, u, id, text(fd, "reason")), { isolationLevel: "Serializable" })); refresh();
}
export async function assignServiceAction(patientId: string, stageId: string, authorityId: string, expectedUpdatedAt: string, fd: FormData) {
  const u = await actor(); await withSerializableRetry(() => prisma.$transaction(tx => assignServiceStage(tx, u, { patientId, stageId, authorityId, expectedUpdatedAt, workerId: text(fd, "workerId"), reason: text(fd, "reason") }), { isolationLevel: "Serializable" })); refresh(patientId);
}
export async function executeServiceAction(patientId: string, stageId: string, assignmentId: string, complete: boolean) {
  const u = await actor(); await withSerializableRetry(() => prisma.$transaction(tx => executeServiceStage(tx, u, { patientId, stageId, assignmentId, complete }), { isolationLevel: "Serializable" })); refresh(patientId);
}
export async function recordConsentAction(patientId: string, fd: FormData) {
  const u = await actor(); const file = fd.get("signedFile"); if (!(file instanceof File)) throw new Error("ارفع النموذج الموقع");
  await recordSignedConsent(u, patientId, { procedure: text(fd, "procedure"), documentCode: text(fd, "documentCode"), documentVersion: text(fd, "documentVersion"),
    signerName: text(fd, "signerName"), signerCapacity: text(fd, "signerCapacity"), representationBasis: text(fd, "representationBasis"), signedAt: text(fd, "signedAt"), attestedSigned: text(fd, "attestedSigned") === "1" }, file); refresh(patientId);
}
export async function withdrawConsentAction(patientId: string, id: string, fd: FormData) {
  const u = await actor(); await withSerializableRetry(() => prisma.$transaction(tx => withdrawConsent(tx, u, patientId, id, text(fd, "reason")), { isolationLevel: "Serializable" })); refresh(patientId);
}
