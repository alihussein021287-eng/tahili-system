import { prisma } from "@/lib/db";
import { PatientSearchField } from "@/components/PatientSearchField";
import { invoiceViewWhere } from "@/lib/patient-guard";
import { Combobox } from "@/components/Combobox";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requirePerm, currentPerms, getSession } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { redirect } from "next/navigation";
import Link from "next/link";
import { INVOICE_STATUS, fmtMoney, fmtDate } from "@/lib/labels";
import { createInvoice, recordPayment, payFull, updateInvoiceDate, deleteInvoice } from "./actions";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { REPORTS_FINANCE_NAV } from "@/lib/hub-nav";

export const dynamic = "force-dynamic";

const STATUS_CLR: Record<string, string> = {
  UNPAID: "bg-red-50 text-red-700", PARTIAL: "bg-amber-50 text-amber-700", PAID: "bg-green-50 text-green-700",
};

export default async function Finance({ searchParams }: { searchParams: Promise<{ status?: string; patientId?: string; q?: string; from?: string; to?: string }> }) {
  await requirePerm("finance.view");
  const perms = await currentPerms();
  const cInvoice = perms.has("finance.invoice");
  const cPayment = perms.has("finance.payment");
  const cDelete = perms.has("finance.delete");
  const cReceipt = perms.has("finance.receipt");
  const sp = await searchParams;

  const where: any = { AND: [await invoiceViewWhere()] };
  // Visits received by the viewer's own branch can be billed even for patients registered elsewhere (identity shown is the visit's only).
  const session = await getSession();
  const me = await prisma.user.findUnique({ where: { id: (session?.user as any)?.id ?? "" }, select: { branchId: true, branch: { select: { isActive: true } }, role: true } });
  const billableVisits = cInvoice && me?.branchId != null && me.branch?.isActive
    ? await prisma.visit.findMany({ where: { branchId: me.branchId }, orderBy: { visitDate: "desc" }, take: 100, select: { id: true, visitDate: true, patient: { select: { fullName: true, fileNumber: true } } } })
    : [];
  if (sp.status && sp.status in INVOICE_STATUS) where.status = sp.status;
  const from = sp.from ? new Date(`${sp.from}T00:00:00`) : null;
  const to = sp.to ? new Date(`${sp.to}T23:59:59`) : null;
  if ((from && Number.isFinite(from.getTime())) || (to && Number.isFinite(to.getTime()))) {
    where.issuedAt = { ...(from && Number.isFinite(from.getTime()) ? { gte: from } : {}), ...(to && Number.isFinite(to.getTime()) ? { lte: to } : {}) };
  }
  if (sp.patientId) where.patientId = sp.patientId;
  if (sp.q) where.OR = [
    { patient: { fullName: { contains: sp.q, mode: "insensitive" } } },
    { description: { contains: sp.q, mode: "insensitive" } },
  ];

  const [invoices, patients, agg] = await Promise.all([
    prisma.invoice.findMany({ where, include: { patient: true }, orderBy: { issuedAt: "desc" }, take: 300 }),
    Promise.resolve([] as Array<{ id: string; fullName: string; fileNumber: number; phone?: string | null; status?: string }>),
    prisma.invoice.aggregate({ _sum: { amount: true, paidAmount: true }, where }),
  ]);
  const billed = agg._sum.amount ?? 0;
  const collected = agg._sum.paidAmount ?? 0;
  const outstanding = billed - collected;

  return (
    <div className="space-y-5">
      <PageHeader title="الفواتير والمدفوعات" subtitle="إصدار الفواتير وتسجيل التحصيل" icon="💰">
        {perms.has("finance.report") ? <Link href="/finance/report" className="btn-ghost bg-white text-brand-700">📊 التقرير السنوي</Link> : null}
        <Link href="/finance/payments" className="btn-ghost bg-white text-brand-700">📋 سجل المدفوعات</Link>
      </PageHeader>
      <HubTabs nav={REPORTS_FINANCE_NAV} active="finance" label="تبويبات التقارير والمالية" perms={perms} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card p-5"><div className="text-2xl font-bold text-gray-800">{fmtMoney(billed)}</div><div className="text-sm text-gray-500">إجمالي الفواتير</div></div>
        <div className="card p-5"><div className="text-2xl font-bold text-green-700">{fmtMoney(collected)}</div><div className="text-sm text-gray-500">المحصّل</div></div>
        <div className="card p-5"><div className="text-2xl font-bold text-red-700">{fmtMoney(outstanding)}</div><div className="text-sm text-gray-500">المتبقّي</div></div>
      </div>

      {cInvoice && <details className="card p-4"><summary className="cursor-pointer font-semibold text-gray-700">+ إصدار فاتورة</summary><form action={createInvoice} className="mt-3 grid gap-3 md:grid-cols-4">
        <div>
          <label className="label">المريض</label>
          <PatientSearchField name="patientId" defaultValue={sp.patientId ?? ""} scope="administrative" />
        </div>
        <div>
          <label className="label">أو زيارة مسجلة في فرعك</label>
          <select name="visitId" className="input" defaultValue="">
            <option value="">— فاتورة للمريض بلا زيارة —</option>
            {billableVisits.map((v) => <option key={v.id} value={v.id}>{v.patient.fullName} #{v.patient.fileNumber} — {fmtDate(v.visitDate)}</option>)}
          </select>
        </div>
        <div><label className="label">المبلغ (د.ع)</label><input name="amount" type="number" min="0" className="input" /></div>
        <div><label className="label">دفعة أولى (اختياري)</label><input name="paidAmount" type="number" min="0" className="input" /></div>
        <div><label className="label">تاريخ الفاتورة</label><input name="issuedAt" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        <div><label className="label">البيان</label><input name="description" className="input" placeholder="مثال: جلسات علاج طبيعي" /></div>
        <div className="md:col-span-4"><button className="btn-primary" type="submit">إصدار فاتورة</button></div>
      </form></details>}

      <FilterBar action="/finance" query={sp.q} placeholder="اسم المريض أو البيان…" activeCount={[sp.status, sp.patientId, sp.from, sp.to].filter(Boolean).length} clearHref="/finance">
        <label className="label">الحالة<select name="status" defaultValue={sp.status ?? ""} className="input mt-1"><option value="">كل الحالات</option>{Object.entries(INVOICE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <PatientSearchField name="patientId" label="المريض" defaultValue={sp.patientId ?? ""} placeholder="كل المرضى" scope="administrative" />
        <label className="label">من<input name="from" type="date" defaultValue={sp.from ?? ""} className="input mt-1" /></label>
        <label className="label">إلى<input name="to" type="date" defaultValue={sp.to ?? ""} className="input mt-1" /></label>
      </FilterBar>

      <div className="card overflow-x-auto p-0">
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
