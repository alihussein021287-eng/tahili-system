import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/access";
import { getOrg } from "@/lib/org";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canManageFinance } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { INVOICE_STATUS, fmtMoney, fmtDate, fmtDateTime } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { updateInvoiceDate } from "../../actions";

export const dynamic = "force-dynamic";

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("finance.receipt");
  const { id } = await params;
  const org = await getOrg();

  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { patient: true, payments: { orderBy: { paidAt: "asc" } } },
  });
  if (!inv) notFound();

  const remaining = inv.amount - inv.paidAmount;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/finance" className="btn-ghost">↩ رجوع</Link>
        <form action={updateInvoiceDate.bind(null, inv.id)} className="flex items-center gap-2">
          <label className="text-sm text-gray-500">تعديل التاريخ:</label>
          <input name="issuedAt" type="date" className="input !py-1" defaultValue={new Date(inv.issuedAt).toISOString().slice(0, 10)} />
          <button className="btn-ghost" type="submit">حفظ</button>
        </form>
        <PrintButton />
      </div>

      <div className="card space-y-5 p-8" id="receipt">
        <div className="print-header border-b-2 border-brand-600 pb-4 text-center">
          <div className="text-2xl font-extrabold text-brand-800">{org.name}</div>
          {org.subtitle && <div className="text-sm text-gray-600">{org.subtitle}</div>}
          {(org.address || org.phone) && <div className="text-xs text-gray-500">{[org.address, org.phone].filter(Boolean).join(" — ")}</div>}
          <div className="mt-2 inline-block rounded bg-brand-50 px-3 py-0.5 text-sm font-medium text-brand-700">وصل استلام مبلغ</div>
        </div>

        <div className="flex justify-between text-sm">
          <div>رقم الوصل: <span className="font-mono font-medium">{inv.id.slice(0, 8).toUpperCase()}</span></div>
          <div>التاريخ: {fmtDate(inv.issuedAt)}</div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-4 text-sm">
          <div>المريض: <span className="font-medium">{inv.patient.fullName}</span></div>
          <div>رقم الملف: <span className="font-medium">#{inv.patient.fileNumber}</span></div>
          <div className="col-span-2">البيان: <span className="font-medium">{inv.description || "—"}</span></div>
        </div>

        <table className="w-full text-sm">
          <thead><tr className="border-b text-gray-500">
            <th className="py-2 text-right">#</th>
            <th className="py-2 text-right">تاريخ الدفعة</th>
            <th className="py-2 text-left">المبلغ المستلم</th>
          </tr></thead>
          <tbody>
            {inv.payments.map((p, i) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{i + 1}</td>
                <td className="py-2">{fmtDateTime(p.paidAt)}</td>
                <td className="py-2 text-left font-medium">{fmtMoney(p.amount)}</td>
              </tr>
            ))}
            {inv.payments.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-gray-400">لا توجد دفعات مسجّلة بعد.</td></tr>}
          </tbody>
        </table>

        <div className="space-y-1 border-t pt-4 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">إجمالي الفاتورة</span><span className="font-medium">{fmtMoney(inv.amount)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">إجمالي المدفوع</span><span className="font-medium text-green-700">{fmtMoney(inv.paidAmount)}</span></div>
          <div className="flex justify-between text-base"><span className="font-semibold">المتبقّي</span><span className="font-bold text-red-700">{fmtMoney(remaining)}</span></div>
          <div className="flex justify-between pt-1"><span className="text-gray-500">الحالة</span><span className="font-medium">{INVOICE_STATUS[inv.status as keyof typeof INVOICE_STATUS]}</span></div>
        </div>

        <div className="grid grid-cols-2 gap-8 pt-8 text-center text-sm text-gray-500">
          <div className="border-t pt-2">توقيع المستلم</div>
          <div className="border-t pt-2">توقيع المحاسب</div>
        </div>
      </div>
    </div>
  );
}
