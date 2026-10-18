import { prisma } from "@/lib/db";
import { PatientSearchField } from "@/components/PatientSearchField";
import { Combobox } from "@/components/Combobox";
import { currentPatientScope } from "@/lib/patient-guard";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, getSession } from "@/lib/access";
import { redirect } from "next/navigation";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { REPORTS_FINANCE_NAV } from "@/lib/hub-nav";
import Link from "next/link";
import { fmtDateTime, fmtMoney, APPROVAL_TYPE, APPROVAL_STATUS } from "@/lib/labels";
import { createApproval, reviewApproval, approveApproval, executeApproval, rejectApproval } from "./actions";

export const dynamic = "force-dynamic";

const SBADGE: any = {
  PENDING_REVIEW: "bg-amber-100 text-amber-700",
  PENDING_APPROVAL: "bg-sky-100 text-sky-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  EXECUTED: "bg-brand-100 text-brand-700",
};

export default async function Approvals({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string; q?: string; status?: string; type?: string }> }) {
  if (!(await getSession())) redirect("/login");
  const perms = await currentPerms();
  const canRequests = perms.has("approvals.view");
  if (!canRequests && !["expenses.approve", "expenses.pay", "reports.approve"].some((key) => perms.has(key))) redirect("/");
  const sp = await searchParams;
  const where: any = {};
  if (sp.status && sp.status in APPROVAL_STATUS) where.status = sp.status;
  if (sp.type && sp.type in APPROVAL_TYPE) where.reqType = sp.type;
  if (sp.q?.trim()) where.OR = [{ title: { contains: sp.q.trim(), mode: "insensitive" } }, { description: { contains: sp.q.trim(), mode: "insensitive" } }, { requestedByName: { contains: sp.q.trim(), mode: "insensitive" } }];

  // Wounded-expense and official-report decisions have their own pages; the cards point there.
  const [submittedExpenses, readyExpenses] = await Promise.all([
    perms.has("expenses.approve") ? prisma.woundedExpense.count({ where: { status: "SUBMITTED" } }) : Promise.resolve(null),
    perms.has("expenses.pay") ? prisma.woundedExpense.count({ where: { status: "READY_FOR_PAYMENT" } }) : Promise.resolve(null),
  ]);

  const [requests, patients] = !canRequests ? [[], []] as [any[], any[]] : await Promise.all([
    prisma.approvalRequest.findMany({ where, include: { patient: { select: { fullName: true, id: true } }, steps: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    Promise.resolve([] as Array<{ id: string; fullName: string; fileNumber: number }>),
  ]);

  const pendingMine = requests.filter((r) =>
    (r.status === "PENDING_REVIEW" && perms.has("approvals.review")) ||
    (r.status === "PENDING_APPROVAL" && perms.has("approvals.approve")) ||
    (r.status === "APPROVED" && perms.has("approvals.execute"))
  );

  const Card = ({ r }: any) => (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-slate-100 text-slate-600">{(APPROVAL_TYPE as any)[r.reqType]}</span>
            <span className="font-semibold text-gray-800">{r.title}</span>
          </div>
          <div className="mt-1 text-xs text-gray-400">
            مقدّم الطلب: {r.requestedByName ?? "—"} • {fmtDateTime(r.createdAt)}
            {r.patient && <> • المريض: <Link href={`/patients/${r.patient.id}`} className="text-brand-600 hover:underline">{r.patient.fullName}</Link></>}
            {r.amount != null && <> • المبلغ: {fmtMoney(r.amount)}</>}
          </div>
        </div>
        <span className={`badge ${SBADGE[r.status]}`}>{(APPROVAL_STATUS as any)[r.status]}</span>
      </div>
      {r.description && <div className="mt-2 text-sm text-gray-600">{r.description}</div>}

      {r.steps.length > 0 && (
        <ol className="mt-3 space-y-1 border-r-2 border-gray-100 pr-3 text-xs">
          {r.steps.map((st: any) => (
            <li key={st.id} className={st.decision === "REJECTED" ? "text-red-600" : "text-gray-500"}>
              <b>{st.level}</b> — {st.actorName ?? "—"} • {fmtDateTime(st.createdAt)}{st.note ? ` • ${st.note}` : ""}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === "PENDING_REVIEW" && perms.has("approvals.review") && (
          <form action={reviewApproval.bind(null, r.id)} className="flex items-center gap-1">
            <input name="note" className="input !py-1 text-xs" placeholder="ملاحظة" />
            <button className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700">اعتماد المراجعة ←</button>
          </form>
        )}
        {r.status === "PENDING_APPROVAL" && perms.has("approvals.approve") && (
          <form action={approveApproval.bind(null, r.id)} className="flex items-center gap-1">
            <input name="note" className="input !py-1 text-xs" placeholder="ملاحظة" />
            <button className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">موافقة نهائية ✔</button>
          </form>
        )}
        {r.status === "APPROVED" && perms.has("approvals.execute") && (
          <form action={executeApproval.bind(null, r.id)} className="flex items-center gap-1">
            <input name="note" className="input !py-1 text-xs" placeholder="ملاحظة التنفيذ" />
            <button className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700">تأشير التنفيذ ✔</button>
          </form>
        )}
        {(r.status === "PENDING_REVIEW" || r.status === "PENDING_APPROVAL") && (perms.has("approvals.review") || perms.has("approvals.approve")) && (
          <form action={rejectApproval.bind(null, r.id)} className="flex items-center gap-1">
            <input name="note" className="input !py-1 text-xs" placeholder="سبب الرفض" />
            <button className="rounded bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100">رفض</button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="الموافقات" subtitle="طلب ← مراجعة ← موافقة المدير ← تنفيذ" icon="✅" />
      <HubTabs nav={REPORTS_FINANCE_NAV} active="approvals" label="تبويبات التقارير والمالية" perms={perms} />
      {submittedExpenses !== null || readyExpenses !== null || perms.has("reports.approve") ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {submittedExpenses !== null ? <Link href="/finance/expenses?status=SUBMITTED" className="card p-4 hover:border-brand-300"><div className={`text-2xl font-bold ${submittedExpenses ? "text-amber-700" : "text-gray-800"}`}>{submittedExpenses}</div><div className="text-sm text-gray-500">صرفيات بانتظار اعتمادك</div></Link> : null}
          {readyExpenses !== null ? <Link href="/finance/expenses?status=READY_FOR_PAYMENT" className="card p-4 hover:border-brand-300"><div className={`text-2xl font-bold ${readyExpenses ? "text-amber-700" : "text-gray-800"}`}>{readyExpenses}</div><div className="text-sm text-gray-500">صرفيات جاهزة للصرف</div></Link> : null}
          {perms.has("reports.approve") ? <Link href="/reports-finance?tab=official" className="card p-4 hover:border-brand-300"><div className="font-bold text-gray-800">التقارير الرسمية</div><div className="text-sm text-gray-500">اعتماد تقارير الشهر</div></Link> : null}
        </div>
      ) : null}
      {sp.msg && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">✅ {sp.msg}</div>}
      {sp.err && <div className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">⚠ {sp.err}</div>}

      {perms.has("approvals.create") && (
        <details className="card p-4">
          <summary className="cursor-pointer font-medium text-brand-700">＋ تقديم طلب جديد</summary>
          <form action={createApproval} className="mt-3 grid gap-2 sm:grid-cols-2">
            <div><label className="label">النوع</label><Combobox name="reqType" allowFree={false} defaultValue="OTHER" options={Object.entries(APPROVAL_TYPE).map(([value,label]:any)=>({value,label}))} /></div>
            <div><label className="label">المبلغ (اختياري)</label><input name="amount" type="number" step="any" className="input" /></div>
            <div className="sm:col-span-2"><label className="label">العنوان <span className="text-red-600">*</span></label><input name="title" className="input" required /></div>
            <div><label className="label">المريض (اختياري)</label><PatientSearchField name="patientId" placeholder="بدون" scope="record" /></div>
            <div className="sm:col-span-2"><label className="label">التفاصيل</label><textarea name="description" className="input" rows={2} /></div>
            <div className="sm:col-span-2"><button className="btn-primary" type="submit">تقديم الطلب</button></div>
          </form>
        </details>
      )}

      {canRequests ? <FilterBar action="/approvals" query={sp.q} placeholder="عنوان الطلب أو مقدمه…" activeCount={[sp.status, sp.type].filter(Boolean).length} clearHref="/approvals">
        <label className="label">الحالة<select name="status" defaultValue={sp.status ?? ""} className="input mt-1"><option value="">كل الحالات</option>{Object.entries(APPROVAL_STATUS).map(([value, label]: any) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="label">النوع<select name="type" defaultValue={sp.type ?? ""} className="input mt-1"><option value="">كل الأنواع</option>{Object.entries(APPROVAL_TYPE).map(([value, label]: any) => <option key={value} value={value}>{label}</option>)}</select></label>
      </FilterBar> : null}

      {pendingMine.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-bold text-gray-700">بانتظار إجرائك ({pendingMine.length})</h2>
          <div className="space-y-3">{pendingMine.map((r) => <Card key={r.id} r={r} />)}</div>
        </div>
      )}

      {canRequests ? <div>
        <h2 className="mb-2 text-sm font-bold text-gray-700">{sp.status || sp.type || sp.q ? "الطلبات المطابقة" : "كل الطلبات"}</h2>
        {requests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">لا توجد طلبات.</div>
        ) : (
          <div className="space-y-3">{requests.map((r) => <Card key={r.id} r={r} />)}</div>
        )}
      </div> : null}
    </div>
  );
}
