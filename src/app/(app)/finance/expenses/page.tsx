import Link from "next/link";
import { PatientSearchField } from "@/components/PatientSearchField";
import { currentAdministrativePatientScope } from "@/lib/patient-guard";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentPerms, getSession } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { REPORTS_FINANCE_NAV } from "@/lib/hub-nav";
import { fmtDate } from "@/lib/labels";
import { createExpense } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "مسودة", cls: "bg-gray-100 text-gray-600" },
  SUBMITTED: { label: "بانتظار الاعتماد", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "معتمدة", cls: "bg-sky-50 text-sky-700" },
  REJECTED: { label: "مرفوضة", cls: "bg-red-50 text-red-700" },
  READY_FOR_PAYMENT: { label: "جاهزة للصرف", cls: "bg-brand-50 text-brand-700" },
  PAID: { label: "مصروفة", cls: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "ملغاة", cls: "bg-gray-100 text-gray-500" },
};
const OPEN = ["DRAFT", "SUBMITTED", "APPROVED", "READY_FOR_PAYMENT"];

type Search = { status?: string; patientId?: string; type?: string; entity?: string; from?: string; to?: string; q?: string };

function day(value: string | undefined, end = false) {
  if (!value) return undefined;
  const parsed = new Date(`${value}T${end ? "23:59:59" : "00:00:00"}`);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

/** The one wounded-expenses page: the list with filters and totals, the CSV export, and new drafts. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!(await getSession())) redirect("/login");
  const perms = await currentPerms();
  if (!["expenses.view", "expenses.reports", "expenses.approve", "expenses.pay"].some((key) => perms.has(key))) redirect("/");
  const sp = await searchParams;
  const canOpen = perms.has("expenses.view");
  const showAmounts = perms.has("expenses.amounts");
  const now = new Date();

  // Branch scope: only expenses of patients inside the viewer's administrative scope (own branch, registrar, ADMIN/central).
  const where: any = { patient: await currentAdministrativePatientScope() };
  if (sp.status === "overdue") Object.assign(where, { dueDate: { lt: now }, status: { in: OPEN } });
  else if (sp.status && sp.status in STATUS) where.status = sp.status;
  if (sp.patientId) where.patientId = sp.patientId;
  if (sp.type?.trim()) where.expenseType = { contains: sp.type.trim(), mode: "insensitive" };
  if (sp.entity?.trim()) where.beneficiaryEntity = { contains: sp.entity.trim(), mode: "insensitive" };
  const from = day(sp.from);
  const to = day(sp.to, true);
  if (from || to) where.requestDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const q = sp.q?.trim();
  if (q) where.OR = [
    { voucherNo: { contains: q, mode: "insensitive" } },
    { beneficiary: { contains: q, mode: "insensitive" } },
    { patient: { fullName: { contains: q, mode: "insensitive" } } },
  ];
  if (q) where.AND = [{ OR: where.OR }];
  if (q) delete where.OR;

  const [rows, patients, agg] = await Promise.all([
    prisma.woundedExpense.findMany({ where, include: { patient: { select: { id: true, fullName: true, fileNumber: true } } }, orderBy: [{ status: "asc" }, { dueDate: "asc" }, { requestDate: "desc" }], take: 300 }),
    Promise.resolve([] as Array<{ id: string; fullName: string; fileNumber: number }>),
    prisma.woundedExpense.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
  ]);

  const exportQuery = new URLSearchParams(
    (["status", "patientId", "type", "entity", "from", "to"] as const)
      .filter((key) => sp[key] && !(key === "status" && sp.status === "overdue"))
      .map((key) => [key, sp[key]!]),
  ).toString();
  const activeCount = [sp.status, sp.patientId, sp.type, sp.entity, sp.from, sp.to].filter(Boolean).length;

  return (
    <div className="space-y-5">
      <PageHeader title="صرفيات الجرحى" subtitle="وحدة مستقلة عن الفواتير والإيرادات" icon="💳">
        {perms.has("expenses.reports") && showAmounts ? <a href={`/api/export/wounded-expenses${exportQuery ? `?${exportQuery}` : ""}`} className="btn-ghost bg-white text-brand-700">⤓ تصدير CSV</a> : null}
      </PageHeader>
      <HubTabs nav={REPORTS_FINANCE_NAV} active="wounded" label="تبويبات التقارير والمالية" perms={perms} />

      {perms.has("expenses.create") ? (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold text-gray-700">+ مسودة صرفية جديدة</summary>
          <form action={createExpense} className="mt-3 grid gap-3 md:grid-cols-3" encType="multipart/form-data" autoComplete="off">
            <div><label className="label">المراجع</label><PatientSearchField name="patientId" required scope="administrative" /></div>
            <label className="label">المستفيد<input name="beneficiary" className="input mt-1" required /></label>
            <label className="label">الجهة<input name="beneficiaryEntity" className="input mt-1" /></label>
            <label className="label">نوع الصرفية<input name="expenseType" className="input mt-1" required /></label>
            <label className="label">المبلغ<input name="amount" type="number" min="0" step="0.01" className="input mt-1" required /></label>
            <label className="label">العملة<select name="currency" className="input mt-1"><option value="IQD">دينار عراقي</option><option value="USD">دولار أمريكي</option></select></label>
            <label className="label">تاريخ الاستحقاق<input name="dueDate" type="date" className="input mt-1" /></label>
            <label className="label">طريقة الصرف<input name="paymentMethod" className="input mt-1" /></label>
            <label className="label">المرجع المالي<input name="financialReference" className="input mt-1" /></label>
            <label className="label">مركز التكلفة<input name="costCenter" className="input mt-1" /></label>
            <label className="label">القسم<input name="department" className="input mt-1" /></label>
            <label className="label">المرفق<input name="attachment" type="file" className="input mt-1" /></label>
            <label className="label md:col-span-3">سبب الصرف<textarea name="reason" className="input mt-1" rows={3} required /></label>
            <label className="label md:col-span-3">الملاحظات<textarea name="notes" className="input mt-1" rows={2} /></label>
            <div className="md:col-span-3"><button className="btn-primary">حفظ المسودة</button></div>
          </form>
        </details>
      ) : null}

      <FilterBar action="/finance/expenses" query={sp.q} placeholder="رقم السند، المستفيد، أو اسم المراجع…" activeCount={activeCount} clearHref="/finance/expenses">
        <label className="label">الحالة<select name="status" defaultValue={sp.status ?? ""} className="input mt-1">
          <option value="">كل الحالات</option>
          <option value="overdue">متأخرة عن الاستحقاق</option>
          {Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
        </select></label>
        <div><label className="label">المراجع</label><PatientSearchField name="patientId" defaultValue={sp.patientId ?? ""} placeholder="الكل" scope="administrative" /></div>
        <label className="label">النوع<input name="type" defaultValue={sp.type ?? ""} className="input mt-1" /></label>
        <label className="label">الجهة<input name="entity" defaultValue={sp.entity ?? ""} className="input mt-1" /></label>
        <label className="label">من<input name="from" type="date" defaultValue={sp.from ?? ""} className="input mt-1" /></label>
        <label className="label">إلى<input name="to" type="date" defaultValue={sp.to ?? ""} className="input mt-1" /></label>
      </FilterBar>

      <section className="card overflow-x-auto">
        <div className="flex flex-wrap gap-4 border-b p-3 text-sm text-gray-600">
          <span>العدد: <b>{agg._count._all}</b></span>
          {showAmounts ? <span>الإجمالي: <b>{new Intl.NumberFormat("ar-IQ").format(Number(agg._sum.amount ?? 0))} IQD</b></span> : null}
        </div>
        <table className="w-full text-sm">
          <thead><tr><th className="th">السند</th><th className="th">المراجع</th><th className="th">المستفيد/الجهة</th><th className="th">النوع</th>{showAmounts ? <th className="th">المبلغ</th> : null}<th className="th">الحالة</th><th className="th">الطلب</th><th className="th">الاستحقاق</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const overdue = !!row.dueDate && row.dueDate < now && OPEN.includes(row.status);
              return (
                <tr key={row.id} className={overdue ? "bg-red-50/40" : "hover:bg-gray-50"}>
                  <td className="td font-medium">{canOpen ? <Link href={`/finance/expenses/${row.id}`} className="text-brand-700 hover:underline">{row.voucherNo}</Link> : row.voucherNo}</td>
                  <td className="td"><Link href={`/patients/${row.patient.id}`} className="text-brand-700 hover:underline">{row.patient.fullName}</Link><div className="text-xs text-gray-400">#{row.patient.fileNumber}</div></td>
                  <td className="td">{row.beneficiary}{row.beneficiaryEntity ? <div className="text-xs text-gray-400">{row.beneficiaryEntity}</div> : null}</td>
                  <td className="td">{row.expenseType}</td>
                  {showAmounts ? <td className="td">{new Intl.NumberFormat("ar-IQ").format(Number(row.amount))} {row.currency}</td> : null}
                  <td className="td"><span className={`badge ${STATUS[row.status]?.cls ?? ""}`}>{STATUS[row.status]?.label ?? row.status}</span></td>
                  <td className="td">{fmtDate(row.requestDate)}</td>
                  <td className={`td ${overdue ? "font-semibold text-red-700" : ""}`}>{fmtDate(row.dueDate)}{overdue ? " · متأخرة" : ""}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? <tr><td colSpan={showAmounts ? 8 : 7} className="td py-8 text-center text-gray-500">لا توجد صرفيات مطابقة.</td></tr> : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
