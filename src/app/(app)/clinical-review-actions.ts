"use server";

import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { withSerializableRetry } from "@/lib/serializable-retry";
import { nominateClinicalReviewer, acceptClinicalReview, revokeClinicalReview, type ClinicalActor, type ClinicalTarget } from "@/lib/clinical-review-service";
import { confirmCenterProgramMedical } from "@/lib/center-program-lifecycle";
import { revalidatePath } from "next/cache";

async function actor(): Promise<ClinicalActor> {
  const u = (await requireSession()).user as { id: string; role: ClinicalActor["role"]; authVersion: number };
  return { userId: u.id, role: u.role, authVersion: u.authVersion };
}
function refresh() { revalidatePath("/patients", "layout"); revalidatePath("/centers", "layout"); revalidatePath("/referrals", "layout"); revalidatePath("/my-work"); }

export async function nominateReviewAction(kind: ClinicalTarget["kind"], id: string, fd: FormData) {
  const user = await actor();
  if (kind !== "STAGE" && kind !== "PROGRAM") throw new Error("غير مصرح");
  await withSerializableRetry(() => prisma.$transaction(tx => nominateClinicalReviewer(tx, user, { kind, id }, fd.get("reviewerId")?.toString() || ""), { isolationLevel: "Serializable" }));
  refresh();
}
export async function acceptReviewAction(kind: ClinicalTarget["kind"], id: string, assignmentId: string) {
  const user = await actor();
  if (kind !== "STAGE" && kind !== "PROGRAM") throw new Error("غير مصرح");
  await withSerializableRetry(() => prisma.$transaction(tx => acceptClinicalReview(tx, user, { kind, id }, assignmentId), { isolationLevel: "Serializable" }));
  refresh();
}
export async function revokeReviewAction(kind: ClinicalTarget["kind"], id: string, assignmentId: string) {
  const user = await actor();
  if (kind !== "STAGE" && kind !== "PROGRAM") throw new Error("غير مصرح");
  await withSerializableRetry(() => prisma.$transaction(tx => revokeClinicalReview(tx, user, { kind, id }, assignmentId), { isolationLevel: "Serializable" }));
  refresh();
}
export async function confirmProgramMedicalAction(centerId: number, programId: string, completionId: string, assignmentId: string) {
  const user = await actor();
  await withSerializableRetry(() => prisma.$transaction(tx => confirmCenterProgramMedical(tx, user, centerId, programId, completionId, assignmentId), { isolationLevel: "Serializable" }));
  refresh();
}
