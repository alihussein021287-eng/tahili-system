import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/access";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canManageFinance } from "@/lib/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fmtMoney, fmtDate, fmtTime } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function Payments({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; patientId?: string; q?: string }> }) {
  await requirePerm("finance.view");
  const sp = await searchParams;

  const from = sp.from ? new Date(sp.from) : null;
  const to = sp.to ? new Date(sp.to + "T23:59:59") : null;
  const where: any = {};
  if (from || to) where.paidAt = { gte: from ?? undefined, lte: to ?? undefined };
  const invoiceFilter: any = {};
  if (sp.patientId) invoiceFilter.patientId = sp.patientId;
  if (sp.q) invoiceFilter.patient = { fullName: { contains: sp.q, mode: "insensitive" } };
  if (Object.keys(invoiceFilter).length) where.invoice = invoiceFilter;

  const [payments, agg, patients] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { invoice: { include: { patient: true } } },
      orderBy: { paidAt: "desc" },
      take: 500,
    }),
    prisma.payment.aggregate({ _sum: { amount: true }, _count: true, where }),
    prisma.patient.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true, fileNumber: true } }),
  ]);
  const totalCollected = agg._sum.amount ?? 0;
  const count = agg._count ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader title="سجل المدفوعات" subtitle="كل الدفعات المسجّلة" icon="📋" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/finance" className="btn-ghost">↩ المالية</Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-2">
        <div className="card p-5"><div className="text-2xl font-bold text-green-700">{fmtMoney(totalCollected)}</div><div className="text-sm text-gray-500">إجمالي المبالغ المستلمة</div></div>
        <div className="card p-5"><div className="text-2xl font-bold text-gray-800">{count}</div><div className="text-sm text-gray-500">عدد الدفعات</div></div>
      </div>

      <form action="/finance/payments" className="card flex flex-wrap items-end gap-2 p-3">
        <div>
          <label className="label">المريض</label>
<Combobox name="patientId" allowFree={false} defaultValue={sp.patientId ?? ""} placeholder="كل المرضى" options={patients.map((p:any)=>({value:String(p.id),label:`${p.fullName} (#${p.fileNumber})`}))} />
        </div>
        <div><label className="label">بحث بالاسم</label><input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="اسم المريض..." /></div>
        <div><label className="label">من تاريخ</label><input name="from" type="date" className="input" defaultValue={sp.from ?? ""} /></div>
        <div><label className="label">إلى تاريخ</label><input name="to" type="date" className="input" defaultValue={sp.to ?? ""} /></div>
        <button className="btn-primary" type="submit">تطبيق</button>
        <a href="/finance/payments" className="btn-ghost">مسح</a>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead><tr>
            <th className="th">#</th><th className="th">المريض</th><th className="th">البيان</th>
            <th className="th">المبلغ المستلم</th><th className="th">التاريخ</th><th className="th">الوقت</th><th className="th">الوصل</th>
          </tr></thead>
          <tbody>
            {payments.map((p, i) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="td">{i + 1}</td>
                <td className="td"><Link href={`/patients/${p.invoice.patientId}`} className="text-brand-700 hover:underline">{p.invoice.patient.fullName}</Link></td>
                <td className="td">{p.invoice.description || "—"}</td>
                <td className="td font-medium text-green-700">{fmtMoney(p.amount)}</td>
                <td className="td">{fmtDate(p.paidAt)}</td>
                <td className="td">{fmtTime(p.paidAt)}</td>
                <td className="td"><Link href={`/finance/${p.invoiceId}/receipt`} className="text-xs text-gray-600 hover:underline">🧾 وصل</Link></td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={7}>لا توجد مدفوعات.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
