"use server";

import type { ReferralRequestStatus, ReferralRequestType, ReferralDestinationScope } from "@prisma/client";
import { currentPerms, requireSession } from "@/lib/access";
import { createReferralRequest, transitionReferralRequest, updateReferralDraft, type ReferralActorContext } from "@/lib/referral-service";
import { saveFile } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const text = (fd: FormData, key: string) => fd.get(key)?.toString().trim() || null;

async function actor(): Promise<ReferralActorContext> {
  const session = await requireSession();
  return {
    userId: (session.user as any).id,
    role: (session.user as any).role,
    permissions: await currentPerms(),
  };
}

function draftInput(patientId: string, fd: FormData) {
  return {
    patientId,
    residentReviewId: text(fd, "residentReviewId"),
    type: text(fd, "type") as ReferralRequestType,
    destinationScope: text(fd, "destinationScope") as ReferralDestinationScope,
    externalEntity: text(fd, "externalEntity"),
    requestedService: text(fd, "requestedService") || "",
    clinicalReason: text(fd, "clinicalReason") || "",
    assignedReviewerId: text(fd, "assignedReviewerId"),
    destinationCenterId: text(fd, "destinationCenterId") ? Number(text(fd, "destinationCenterId")) : null,
  };
}

export async function createReferralFromPatient(patientId: string, fd: FormData) {
  const created = await createReferralRequest(draftInput(patientId, fd), await actor());
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/referrals");
  redirect(`/referrals/${created.id}?msg=${encodeURIComponent("تم إنشاء الطلب كمسودة")}`);
}

export async function updateReferralAction(id: string, patientId: string, fd: FormData) {
  await updateReferralDraft(id, draftInput(patientId, fd), await actor());
  revalidatePath(`/referrals/${id}`);
  redirect(`/referrals/${id}?msg=${encodeURIComponent("تم حفظ المسودة")}`);
}

export async function transitionReferralAction(id: string, toStatus: ReferralRequestStatus, fd: FormData) {
  const file = fd.get("resultAttachment") as File | null;
  const resultAttachmentUrl = file && file.size > 0 ? `/api/files/${(await saveFile(file)).key}` : null;
  const docDate = text(fd, "docDate");
  await transitionReferralRequest(id, toStatus, {
    resultSummary: text(fd, "resultSummary"),
    resultAttachmentUrl,
    cancellationReason: text(fd, "cancellationReason"),
    acceptedById: toStatus === "ACCEPTED" ? (await actor()).userId : null,
    official: toStatus === "READY" && text(fd, "number") ? {
      number: text(fd, "number")!,
      docDate: docDate ? new Date(docDate) : new Date(),
      subject: text(fd, "subject") || "كتاب إرسال مراجع",
      body: text(fd, "body"),
    } : undefined,
  }, await actor());
  revalidatePath(`/referrals/${id}`);
  revalidatePath("/referrals");
  revalidatePath("/notifications");
  redirect(`/referrals/${id}?msg=${encodeURIComponent("تم تحديث حالة الطلب")}`);
}
