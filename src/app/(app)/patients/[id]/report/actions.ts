"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { assertPerm } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export async function approvePatientReport(patientId: string, fd: FormData) {
  const s = await requireSession();
  await assertPerm("reports.approve");
  const approvedBy = fd.get("approvedBy")?.toString().trim() || (s?.user?.name ?? "");
  await prisma.reportApproval.upsert({
    where: { kind_refKey: { kind: "patient-report", refKey: patientId } },
    update: { approvedBy, title: fd.get("title")?.toString() || null, approvedById: (s?.user as any)?.id, approvedAt: new Date() },
    create: { kind: "patient-report", refKey: patientId, approvedBy, title: fd.get("title")?.toString() || null, approvedById: (s?.user as any)?.id },
  });
  await logAudit({ action: "UPDATE", tableName: "report_approvals", recordId: `patient-report:${patientId}`, newValue: { approvedBy } });
  revalidatePath(`/patients/${patientId}/report`);
}

export async function unapprovePatientReport(patientId: string) {
  await assertPerm("reports.approve");
  await prisma.reportApproval.deleteMany({ where: { kind: "patient-report", refKey: patientId } });
  await logAudit({ action: "DELETE", tableName: "report_approvals", recordId: `patient-report:${patientId}` });
  revalidatePath(`/patients/${patientId}/report`);
}
