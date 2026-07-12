import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requirePerm, currentPerms } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { redirect } from "next/navigation";
import Link from "next/link";
import { INVOICE_STATUS, fmtMoney, fmtDate } from "@/lib/labels";
import { createInvoice, recordPayment, payFull, updateInvoiceDate, deleteInvoice } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_CLR: Record<string, string> = {
  UNPAID: "bg-red-50 text-red-700", PARTIAL: "bg-amber-50 text-amber-700", PAID: "bg-green-50 text-green-700",
};

export default async function Finance({ searchParams }: { searchParams: Promise<{ status?: string; patientId?: string; q?: string }> }) {
  await requirePerm("finance.view");
  const perms = await currentPerms();
  const cInvoice = perms.has("finance.invoice");
  const cPayment = perms.has("finance.payment");
  const cDelete = perms.has("finance.delete");
  const cReceipt = perms.has("finance.receipt");
  const sp = await searchParams;

  const where: any = {};
  if (sp.status) where.status = sp.status;
  if (sp.patientId) where.patientId = sp.patientId;
  if (sp.q) where.OR = [
    { patient: { fullName: { contains: sp.q, mode: "insensitive" } } },
    { description: { contains: sp.q, mode: "insensitive" } },
  ];

  const [invoices, patients, agg] = await Promise.all([
    prisma.invoice.findMany({ where, include: { patient: true }, orderBy: { issuedAt: "desc" }, take: 300 }),
    prisma.patient.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true, fileNumber: true } }),
    prisma.invoice.aggregate({ _sum: { amount: true, paidAmount: true }, where }),
  ]);
  const billed = agg._sum.amount ?? 0;
  const collected = agg._sum.paidAmount ?? 0;
  const outstanding = billed - collected;

  return (
    <div className="space-y-5">
      <PageHeader title="المالية" subtitle="الفواتير والمدفوعات" icon="💰" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {perms.has("expenses.view") && <Link href="/finance/expenses" className="btn-ghost">صرفيات الجرحى</Link>}
        <Link href="/finance/report" className="btn-ghost">📊 التقرير المالي السنوي</Link>
        <Link href="/finance/payments" className="btn-ghost">📋 سجل المدفوعات</Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card p-5"><div className="text-2xl font-bold text-gray-800">{fmtMoney(billed)}</div><div className="text-sm text-gray-500">إجمالي الفواتير</div></div>
        <div className="card p-5"><div className="text-2xl font-bold text-green-700">{fmtMoney(collected)}</div><div className="text-sm text-gray-500">المحصّل</div></div>
        <div className="card p-5"><div className="text-2xl font-bold text-red-700">{fmtMoney(outstanding)}</div><div className="text-sm text-gray-500">المتبقّي</div></div>
      </div>

      {cInvoice && <form action={createInvoice} className="card grid gap-3 p-4 md:grid-cols-4">
        <div>
          <label className="label">المريض</label>
          <Combobox name="patientId" required allowFree={false} defaultValue={sp.patientId ?? ""} options={patients.map((p:any)=>({value:String(p.id),label:`${p.fullName} (#${p.fileNumber})`}))} />
        </div>
        <div><label className="label">المبلغ (د.ع)</label><input name="amount" type="number" min="0" className="input" /></div>
        <div><label className="label">دفعة أولى (اختياري)</label><input name="paidAmount" type="number" min="0" className="input" /></div>
        <div><label className="label">تاريخ الفاتورة</label><input name="issuedAt" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        <div><label className="label">البيان</label><input name="description" className="input" placeholder="مثال: جلسات علاج طبيعي" /></div>
        <div className="md:col-span-4"><button className="btn-primary" type="submit">إصدار فاتورة</button></div>
      </form>}

      <div className="card overflow-x-auto p-0">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm text-gray-500">تصفية:</span>
          <Link href="/finance" className={`badge ${!sp.status ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"}`}>الكل</Link>
          {Object.entries(INVOICE_STATUS).map(([k, v]) => (
            <Link key={k} href={`/finance?status=${k}`} className={`badge ${sp.status === k ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"}`}>{v}</Link>
          ))}
          <form action="/finance" className="ms-auto flex items-center gap-2">
            <input name="q" defaultValue={sp.q ?? ""} className="input !py-1 !w-48" placeholder="بحث بالاسم أو البيان..." />
            <button className="text-xs text-brand-700 hover:underline" type="submit">بحث</button>
          </form>
          <form action="/finance" className="flex items-center gap-2">
<Combobox name="patientId" allowFree={false} defaultValue={sp.patientId ?? ""} placeholder="كل المرضى" options={patients.map((p:any)=>({value:String(p.id),label:`${p.fullName} (#${p.fileNumber})`}))} />
            <button className="text-xs text-brand-700 hover:underline" type="submit">تصفية بالمريض</button>
            {sp.patientId && <Link href="/finance" className="text-xs text-gray-400 hover:underline">مسح</Link>}
          </form>
        </div>
        <table className="min-w-full text-sm">
          <thead><tr>
            <th className="th">المريض</th><th className="th">البيان</th><th className="th">المبلغ</th>
            <th className="th">المدفوع</th><th className="th">المتبقّي</th><th className="th">الحالة</th>
            <th className="th">التاريخ</th><th className="th">تحصيل</th><th className="th"></th>
          </tr></thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="td"><Link href={`/patients/${inv.patientId}`} className="text-brand-700 hover:underline">{inv.patient.fullName}</Link></td>
                <td className="td">{inv.description || "—"}</td>
                <td className="td">{fmtMoney(inv.amount)}</td>
                <td className="td">{fmtMoney(inv.paidAmount)}</td>
                <td className="td">{fmtMoney(inv.amount - inv.paidAmount)}</td>
                <td className="td"><span className={`badge ${STATUS_CLR[inv.status]}`}>{INVOICE_STATUS[inv.status as keyof typeof INVOICE_STATUS]}</span></td>
                <td className="td">
                  <form action={updateInvoiceDate.bind(null, inv.id)} className="flex items-center gap-1">
                    <input name="issuedAt" type="date" className="input !w-32 !py-1" defaultValue={new Date(inv.issuedAt).toISOString().slice(0, 10)} />
                    <button className="text-xs text-brand-700 hover:underline" title="حفظ التاريخ">↻</button>
                  </form>
                </td>
                <td className="td">
                  {inv.status !== "PAID" && (
                    <div className="flex items-center gap-2">
                      {cPayment && (<>
                      <form action={recordPayment.bind(null, inv.id)} className="flex items-center gap-1">
                        <input name="pay" type="number" min="0" className="input !w-24 !py-1" placeholder="مبلغ" />
                        <button className="text-xs text-brand-700 hover:underline">سدّد</button>
                      </form>
                      <form action={payFull.bind(null, inv.id)}><button className="text-xs text-green-700 hover:underline">دفع كامل</button></form>
                      </>)}
                    </div>
                  )}
                </td>
                <td className="td">
                  <div className="flex items-center gap-3">
                    {cReceipt && <Link href={`/finance/${inv.id}/receipt`} className="text-xs text-gray-600 hover:underline">🧾 وصل</Link>}
                    {cDelete && <form action={deleteInvoice.bind(null, inv.id)}><button className="btn-icon-danger" title="حذف">×</button></form>}
                  </div>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={9}>لا توجد فواتير.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
