"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function addMedDose(fd: FormData) {
  await assertPerm("meds.manage");
  const patientId = fd.get("patientId")?.toString();
  const drug = fd.get("drug")?.toString().trim();
  const timeLabel = fd.get("timeLabel")?.toString().trim();
  if (!patientId || !drug || !timeLabel) redirect("/meds?saved=" + encodeURIComponent("أكمل: المريض والدواء والوقت"));
  const created = await prisma.medDose.create({ data: { patientId: patientId!, drug: drug!, timeLabel: timeLabel!, dose: fd.get("dose")?.toString() || null, notes: fd.get("notes")?.toString() || null } });
  await logAudit({ action: "CREATE", tableName: "med_doses", recordId: created.id });
  revalidatePath("/meds");
}
export async function toggleMedGiven(id: string, given: boolean) {
  await assertPerm("meds.manage");
  await prisma.medDose.update({ where: { id }, data: { given, givenAt: given ? new Date() : null } });
  await logAudit({ action: "UPDATE", tableName: "med_doses", recordId: id, newValue: { given } });
  revalidatePath("/meds");
}
export async function deleteMedDose(id: string) {
  await assertAdminDelete();
  await assertPerm("meds.manage");
  await prisma.medDose.delete({ where: { id } });
  await logAudit({ action: "DELETE", tableName: "med_doses", recordId: id });
  revalidatePath("/meds");
}
