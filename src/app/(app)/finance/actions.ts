"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { canManageFinance } from "@/lib/permissions";
import { assertPerm, assertAdminDelete } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";

async function requireFinance() {
  const s = await requireSession();
  if (!canManageFinance((s?.user as any)?.role)) throw new Error("غير مصرّح");
  return s;
}
function computeStatus(amount: number, paid: number) {
  if (paid <= 0) return "UNPAID";
  if (paid >= amount) return "PAID";
  return "PARTIAL";
}

export async function createInvoice(fd: FormData) {
  const s = await requireFinance();
  await assertPerm("finance.invoice");
  const patientId = fd.get("patientId")?.toString();
  const amount = parseInt(fd.get("amount")?.toString() || "0", 10);
  if (!patientId || !amount || amount <= 0) redirect("/finance?saved=" + encodeURIComponent("اختر المريض وأدخل مبلغاً صحيحاً"));
  let paidAmount = parseInt(fd.get("paidAmount")?.toString() || "0", 10) || 0;
  if (paidAmount > amount) paidAmount = amount;
  const issuedAtStr = fd.get("issuedAt")?.toString();
  const inv = await prisma.invoice.create({ data: {
    patientId: patientId!, amount, paidAmount,
    description: fd.get("description")?.toString() || null,
    issuedAt: issuedAtStr ? new Date(issuedAtStr) : undefined,
    status: computeStatus(amount, paidAmount) as any,
    createdById: (s?.user as any)?.id,
  }});
  if (paidAmount > 0) {
    await prisma.payment.create({ data: { invoiceId: inv.id, amount: paidAmount, createdById: (s?.user as any)?.id } });
  }
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "invoices", recordId: inv.id });
  revalidatePath("/finance");
}

export async function recordPayment(id: string, fd: FormData) {
  const s = await requireFinance();
  await assertPerm("finance.payment");
  const pay = parseInt(fd.get("pay")?.toString() || "0", 10);
  if (!pay || pay <= 0) redirect("/finance?saved=" + encodeURIComponent("أدخل مبلغ دفعة صحيح"));
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv) redirect("/finance");
  const add = Math.min(pay, inv!.amount - inv!.paidAmount);
  if (add <= 0) redirect("/finance?saved=" + encodeURIComponent("الفاتورة مسددة بالكامل"));
  const paidAmount = inv!.paidAmount + add;
  await prisma.$transaction([
    prisma.payment.create({ data: { invoiceId: id, amount: add, createdById: (s?.user as any)?.id } }),
    prisma.invoice.update({ where: { id }, data: { paidAmount, status: computeStatus(inv!.amount, paidAmount) as any } }),
  ]);
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "invoices", recordId: id });
  revalidatePath("/finance");
  revalidatePath(`/finance/${id}/receipt`);
}

export async function payFull(id: string) {
  const s = await requireFinance();
  await assertPerm("finance.payment");
  const inv = await prisma.invoice.findUnique({ where: { id } });
  if (!inv) redirect("/finance");
  const add = inv!.amount - inv!.paidAmount;
  if (add <= 0) redirect("/finance");
  await prisma.$transaction([
    prisma.payment.create({ data: { invoiceId: id, amount: add, createdById: (s?.user as any)?.id } }),
    prisma.invoice.update({ where: { id }, data: { paidAmount: inv!.amount, status: "PAID" } }),
  ]);
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "invoices", recordId: id });
  revalidatePath("/finance");
  revalidatePath(`/finance/${id}/receipt`);
}

export async function updateInvoiceDate(id: string, fd: FormData) {
  const s = await requireFinance();
  await assertPerm("finance.invoice");
  const d = fd.get("issuedAt")?.toString();
  if (!d) redirect("/finance");
  await prisma.invoice.update({ where: { id }, data: { issuedAt: new Date(d) } });
  await logAudit({ userId: (s?.user as any)?.id, action: "UPDATE", tableName: "invoices", recordId: id });
  revalidatePath("/finance");
  revalidatePath(`/finance/${id}/receipt`);
}

export async function deleteInvoice(id: string) {
  await assertAdminDelete();
  const s = await requireFinance();
  await assertPerm("finance.delete");
  await prisma.invoice.delete({ where: { id } });
  await logAudit({ userId: (s?.user as any)?.id, action: "DELETE", tableName: "invoices", recordId: id });
  revalidatePath("/finance");
}
