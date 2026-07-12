"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { assertPerm } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export async function approveStatReport(refKey: string, fd: FormData) {
  await assertPerm("reports.approve");
  const s = await requireSession();
  const data = { approvedBy: s?.user?.name ?? "—", title: fd.get("title")?.toString() || null, note: fd.get("note")?.toString() || null, approvedById: (s?.user as any)?.id };
  await prisma.reportApproval.upsert({
    where: { kind_refKey: { kind: "official-stat", refKey } },
    update: { ...data, approvedAt: new Date() },
    create: { kind: "official-stat", refKey, ...data },
  });
  await logAudit({ action: "UPDATE", tableName: "report_approvals", recordId: `official-stat:${refKey}` });
  revalidatePath("/reports/statistical");
}

export async function unapproveStatReport(refKey: string) {
  await assertPerm("reports.approve");
  await prisma.reportApproval.deleteMany({ where: { kind: "official-stat", refKey } });
  await logAudit({ action: "DELETE", tableName: "report_approvals", recordId: `official-stat:${refKey}` });
  revalidatePath("/reports/statistical");
}
