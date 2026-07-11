"use server";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertPerm, currentPerms } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function actor() {
  const s = await getServerSession(authOptions);
  return { id: (s?.user as any)?.id ?? null, name: s?.user?.name ?? null };
}

export async function createApproval(fd: FormData) {
  await assertPerm("approvals.create");
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

async function step(requestId: string, level: string, decision: string, note?: string | null) {
  const a = await actor();
  await prisma.approvalStep.create({ data: { requestId, level, decision, actorName: a.name, actorId: a.id, note: note || null } });
}

export async function reviewApproval(id: string, fd: FormData) {
  await assertPerm("approvals.review");
  await step(id, "مراجعة", "APPROVED", fd.get("note")?.toString());
  await prisma.approvalRequest.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
  await logAudit({ action: "UPDATE", tableName: "approval_requests", recordId: id, newValue: { status: "PENDING_APPROVAL" } });
  revalidatePath("/approvals");
}

export async function approveApproval(id: string, fd: FormData) {
  await assertPerm("approvals.approve");
  await step(id, "موافقة نهائية", "APPROVED", fd.get("note")?.toString());
  await prisma.approvalRequest.update({ where: { id }, data: { status: "APPROVED" } });
  await logAudit({ action: "UPDATE", tableName: "approval_requests", recordId: id, newValue: { status: "APPROVED" } });
  revalidatePath("/approvals");
}

export async function executeApproval(id: string, fd: FormData) {
  await assertPerm("approvals.execute");
  await step(id, "تنفيذ", "EXECUTED", fd.get("note")?.toString());
  await prisma.approvalRequest.update({ where: { id }, data: { status: "EXECUTED" } });
  await logAudit({ action: "UPDATE", tableName: "approval_requests", recordId: id, newValue: { status: "EXECUTED" } });
  revalidatePath("/approvals");
}

export async function rejectApproval(id: string, fd: FormData) {
  // يرفض من يملك صلاحية المراجعة أو الموافقة
  const perms = await currentPerms();
  if (!perms.has("approvals.review") && !perms.has("approvals.approve")) throw new Error("غير مصرّح");
  await step(id, "رفض", "REJECTED", fd.get("note")?.toString());
  await prisma.approvalRequest.update({ where: { id }, data: { status: "REJECTED" } });
  await logAudit({ action: "UPDATE", tableName: "approval_requests", recordId: id, newValue: { status: "REJECTED" } });
  revalidatePath("/approvals");
}
