"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { assertPerm } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export async function approveOfficialReport(year: number, month: number, fd: FormData) {
  const s = await requireSession();
  await assertPerm("reports.approve");
  const refKey = `${year}-${month}`;
  const approvedBy = fd.get("approvedBy")?.toString().trim() || (s?.user?.name ?? "");
  await prisma.reportApproval.upsert({
    where: { kind_refKey: { kind: "official-monthly", refKey } },
    update: { approvedBy, title: fd.get("title")?.toString() || null, note: fd.get("note")?.toString() || null, approvedById: (s?.user as any)?.id, approvedAt: new Date() },
    create: { kind: "official-monthly", refKey, approvedBy, title: fd.get("title")?.toString() || null, note: fd.get("note")?.toString() || null, approvedById: (s?.user as any)?.id },
  });
  await logAudit({ action: "UPDATE", tableName: "report_approvals", recordId: refKey, newValue: { approvedBy } });
  revalidatePath("/reports/official");
}

export async function unapproveOfficialReport(year: number, month: number) {
  await assertPerm("reports.approve");
  const refKey = `${year}-${month}`;
  await prisma.reportApproval.deleteMany({ where: { kind: "official-monthly", refKey } });
  await logAudit({ action: "DELETE", tableName: "report_approvals", recordId: refKey });
  revalidatePath("/reports/official");
}
