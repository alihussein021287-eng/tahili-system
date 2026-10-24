"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { assertPerm, currentPerms } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { assertOptionalPatientScope } from "@/lib/patient-guard";
import { redirect } from "next/navigation";
import type { ApprovalStatus } from "@prisma/client";

async function actor() {
  const s = await requireSession();
  return { id: (s?.user as any)?.id ?? null, name: s?.user?.name ?? null };
}

export async function createApproval(fd: FormData) {
  await assertPerm("approvals.create");
  await assertOptionalPatientScope(fd.get("patientId")?.toString() || null);
  const a = await actor();
  const title = fd.get("title")?.toString().trim();
  if (!title) redirect("/approvals?err=" + encodeURIComponent("عنوان الطلب مطلوب"));
  const amt = fd.get("amount")?.toString();
  const r = await prisma.approvalRequest.create({
    data: {
      reqType: (fd.get("reqType")?.toString() as any) || "OTHER",
      title: title!, description: fd.get("description")?.toString() || null,
      amount: amt ? parseFloat(amt) : null,
      patientId: fd.get("patientId")?.toString() || null,
      requestedById: a.id, requestedByName: a.name, status: "PENDING_REVIEW",
    },
  });
  await logAudit({ action: "CREATE", tableName: "approval_requests", recordId: r.id, newValue: { title } });
  redirect("/approvals?msg=" + encodeURIComponent("تم تقديم الطلب"));
}

async function transition(id: string, from: ApprovalStatus[], status: ApprovalStatus, level: string, decision: string, fd: FormData) {
  const a = await actor();
  await prisma.$transaction(async (tx) => {
    // The conditional write serializes competing transitions before recording any step or success audit.
    const changed = await tx.approvalRequest.updateMany({ where: { id, status: { in: from } }, data: { status } });
    if (changed.count !== 1) throw new Error("حالة الطلب لا تسمح بهذا الإجراء أو تغيرت؛ حدّث الصفحة");
    await tx.approvalStep.create({ data: { requestId: id, level, decision, actorName: a.name, actorId: a.id, note: fd.get("note")?.toString() || null } });
    await tx.auditLog.create({ data: { userId: a.id, actorName: a.name, action: "UPDATE", tableName: "approval_requests", recordId: id, newValue: { status } } });
  });
  revalidatePath("/approvals");
}

export async function reviewApproval(id: string, fd: FormData) {
  await assertPerm("approvals.review");
  await transition(id, ["PENDING_REVIEW"], "PENDING_APPROVAL", "مراجعة", "APPROVED", fd);
}

export async function approveApproval(id: string, fd: FormData) {
  await assertPerm("approvals.approve");
  await transition(id, ["PENDING_APPROVAL"], "APPROVED", "موافقة نهائية", "APPROVED", fd);
}

export async function executeApproval(id: string, fd: FormData) {
  await assertPerm("approvals.execute");
  await transition(id, ["APPROVED"], "EXECUTED", "تنفيذ", "EXECUTED", fd);
}

export async function rejectApproval(id: string, fd: FormData) {
  // يرفض من يملك صلاحية المراجعة أو الموافقة
  const perms = await currentPerms();
  if (!perms.has("approvals.review") && !perms.has("approvals.approve")) throw new Error("غير مصرّح");
  await transition(id, ["PENDING_REVIEW", "PENDING_APPROVAL"], "REJECTED", "رفض", "REJECTED", fd);
}
