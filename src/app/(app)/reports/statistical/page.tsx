import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms } from "@/lib/access";
import Link from "next/link";
import { fmtMoney, fmtDate, fmtDateTime, GENDER, CASE_TYPE } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { getOrg } from "@/lib/org";
import { approveStatReport, unapproveStatReport } from "./actions";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";

export const dynamic = "force-dynamic";

const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
const QUARTERS = ["الربع الأول (1-3)", "الربع الثاني (4-6)", "الربع الثالث (7-9)", "الربع الرابع (10-12)"];

export default async function StatReport({ searchParams }: { searchParams: Promise<{ ptype?: string; year?: string; month?: string; quarter?: string; branch?: string }> }) {
  await requirePerm("reports.view");
  const perms = await currentPerms();
  const userBranch = await currentUserBranch();
  const org = await getOrg();
  const sp = await searchParams;
  const now = new Date();

  const ptype = sp.ptype || "month";
  const year = sp.year ? Number(sp.year) : now.getFullYear();
  const month = sp.month !== undefined && sp.month !== "" ? Number(sp.month) : now.getMonth();
  const quarter = sp.quarter !== undefined && sp.quarter !== "" ? Number(sp.quarter) : Math.floor(now.getMonth() / 3);
  const branchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const branchFilter = branchId ? { branchId } : {};

  let start: Date, end: Date, periodLabel: string, refKey: string;
  if (ptype === "year") { start = new Date(year, 0, 1); end = new Date(year + 1, 0, 1); periodLabel = `سنة ${year}`; refKey = `year-${year}`; }
  else if (ptype === "quarter") { start = new Date(year, quarter * 3, 1); end = new Date(year, quarter * 3 + 3, 1); periodLabel = `${QUARTERS[quarter]} — ${year}`; refKey = `q-${year}-${quarter}`; }
  else { start = new Date(year, month, 1); end = new Date(year, month + 1, 1); periodLabel = `${MONTHS[month]} ${year}`; refKey = `m-${year}-${month}`; }

  const inRange = { gte: start, lt: end };
  const [newP, totalP, sessions, adm, admittedNow, devices, dispensed, revenue, approvals, byGov, byInjury, byGender, byCase, govs, injuries, branches, approval] = await Promise.all([
    prisma.patient.count({ where: { registrationDate: inRange, ...branchFilter } }),
    prisma.patient.count({ where: { archivedAt: null, ...branchFilter } }),
    prisma.therapySession.count({ where: { createdAt: inRange, patient: { ...branchFilter } } }),
    prisma.admission.count({ where: { admissionDate: inRange, patient: { ...branchFilter } } }),
    prisma.admission.count({ where: { status: "ADMITTED", patient: { ...branchFilter } } }),
    prisma.device.count({ where: { deliveredAt: inRange, patient: { ...branchFilter } } }),
    prisma.prescription.count({ where: { isDispensed: true, dispensedAt: inRange, patient: { ...branchFilter } } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { paidAt: inRange } }),
    prisma.approvalRequest.count({ where: { createdAt: inRange } }),
    prisma.patient.groupBy({ by: ["governorateId"], where: { registrationDate: inRange, ...branchFilter }, _count: { _all: true } }),
    prisma.patient.groupBy({ by: ["injuryTypeId"], where: { registrationDate: inRange, ...branchFilter }, _count: { _all: true } }),
    prisma.patient.groupBy({ by: ["gender"], where: { registrationDate: inRange, ...branchFilter }, _count: { _all: true } }),
    prisma.patient.groupBy({ by: ["caseType"], where: { registrationDate: inRange, ...branchFilter }, _count: { _all: true } }),
    prisma.governorate.findMany({ select: { id: true, name: true } }),
    prisma.injuryType.findMany({ select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.reportApproval.findUnique({ where: { kind_refKey: { kind: "official-stat", refKey } } }),
  ]);

  const govName = (id: number | null) => govs.find((g) => g.id === id)?.name ?? "غير محدّد";
  const injName = (id: number | null) => injuries.find((g) => g.id === id)?.name ?? "غير محدّد";
  const rev = revenue._sum.amount ?? 0;

  const summary = [
    ["مراجعون جدد", newP], ["إجمالي المراجعين النشطين", totalP], ["الجلسات العلاجية", sessions],
    ["حالات رقود جديدة", adm], ["مرقودون حالياً", admittedNow], ["أجهزة مسلّمة", devices],
    ["وصفات مصروفة", dispensed], ["طلبات موافقة", approvals], ["الإيرادات المحصّلة", fmtMoney(rev)],
  ];

  const Bk = ({ title, rows }: any) => (
    <div>
      <div className="mb-1 text-sm font-bold text-gray-700">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 && <tr><td className="py-2 text-gray-400">— لا بيانات —</td></tr>}
          {rows.map((r: any, i: number) => (
            <tr key={i} className="border-b"><td className="py-1.5">{r[0]}</td><td className="py-1.5 text-left font-medium">{r[1]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/reports" className="btn-ghost">↩ التقارير</Link>
        {perms.has("reports.print") && <PrintButton />}
      </div>
      {userBranch?.branch?.name && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800 print:hidden">
          {branchId ? `التقرير مفلتر افتراضياً حسب فرعك: ${userBranch.branch.name}` : "يعرض التقرير كل الفروع حالياً"}
        </div>
      )}

      {/* منتقي الفترة */}
      <form className="card flex flex-wrap items-end gap-2 p-4 print:hidden">
        <div><label className="label">نوع الفترة</label>
          <Combobox name="ptype" allowFree={false} defaultValue={ptype} options={[{value:"month",label:"شهري"},{value:"quarter",label:"فصلي"},{value:"year",label:"سنوي"}]} /></div>
        <div><label className="label">السنة</label><input name="year" type="number" defaultValue={year} className="input w-28" /></div>
        <div><label className="label">الشهر</label><Combobox name="month" allowFree={false} defaultValue={String(month)} options={MONTHS.map((m:any,i:number)=>({value:String(i),label:m}))} /></div>
        <div><label className="label">الربع</label><Combobox name="quarter" allowFree={false} defaultValue={String(quarter)} options={QUARTERS.map((q:any,i:number)=>({value:String(i),label:q}))} /></div>
        {branches.length > 0 && <Combobox name="branch" label="الفرع" allowFree={false} defaultValue={sp.branch ?? (branchId ? String(branchId) : "")} placeholder="كل الفروع" options={[{ value: "all", label: "كل الفروع" }, ...branches.map((b:any)=>({value:String(b.id),label:b.name}))]} />}
        <button className="btn-primary" type="submit">عرض</button>
      </form>

      <div className="card space-y-6 p-8">
        <div className="print-header border-b-2 border-brand-600 pb-4 text-center">
          {(org.officialHeader1 || org.officialHeader2 || org.officialHeader3) && <div className="text-sm font-semibold text-gray-700">{[org.officialHeader1, org.officialHeader2, org.officialHeader3].filter(Boolean).join(" - ")}</div>}
          <div className="text-2xl font-extrabold text-brand-800">{org.officialHeader4 || org.name}</div>
          {org.subtitle && <div className="text-sm text-gray-600">{org.subtitle}</div>}
          <div className="mt-1 text-xs text-gray-500">{[org.officialAddress || org.address, org.officialPhone || org.phone].filter(Boolean).join(" — ")}</div>
          <div className="mt-2 inline-block rounded bg-brand-50 px-3 py-0.5 text-sm font-medium text-brand-700">التقرير الإحصائي الرسمي — {periodLabel}</div>
          <div className="mt-1 text-xs text-gray-400">تاريخ الإصدار: {fmtDate(new Date())}</div>
        </div>

        <div>
          <div className="mb-2 text-sm font-bold text-gray-700">أولاً: المؤشرات العامة</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3">
            {summary.map(([k, v]: any, i: number) => (
              <div key={i} className="flex justify-between border-b py-1.5 text-sm"><span className="text-gray-600">{k}</span><b className="text-gray-800">{v}</b></div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-bold text-gray-700">ثانياً: توزيع المراجعين الجدد</div>
          <div className="grid gap-6 sm:grid-cols-2">
            <Bk title="حسب المحافظة" rows={byGov.map((g: any) => [govName(g.governorateId), g._count._all])} />
            <Bk title="حسب نوع الإصابة" rows={byInjury.map((g: any) => [injName(g.injuryTypeId), g._count._all])} />
            <Bk title="حسب الجنس" rows={byGender.map((g: any) => [g.gender ? (GENDER as any)[g.gender] : "غير محدّد", g._count._all])} />
            <Bk title="حسب نوع الحالة" rows={byCase.map((g: any) => [g.caseType ? (CASE_TYPE as any)[g.caseType] : "غير محدّد", g._count._all])} />
          </div>
        </div>

        {/* الاعتماد */}
        <div className="border-t pt-4">
          {approval ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3">
              <div className="text-sm text-emerald-800">
                <b>✔ معتمد إلكترونياً</b> — {approval.approvedBy}{approval.title ? ` (${approval.title})` : ""} • {fmtDateTime(approval.approvedAt)}
                {approval.note && <div className="text-xs text-emerald-700">{approval.note}</div>}
              </div>
              {perms.has("reports.approve") && <form action={unapproveStatReport.bind(null, refKey)} className="print:hidden"><button className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200">إلغاء الاعتماد</button></form>}
            </div>
          ) : perms.has("reports.approve") ? (
            <form action={approveStatReport.bind(null, refKey)} className="flex flex-wrap items-end gap-2 print:hidden">
              <div><label className="label">الصفة</label><input name="title" className="input" placeholder="مدير المركز" /></div>
              <div className="flex-1"><label className="label">ملاحظة</label><input name="note" className="input" /></div>
              <button className="btn-primary" type="submit">اعتماد وتوقيع إلكتروني</button>
            </form>
          ) : (
            <div className="text-center text-sm text-gray-400">التقرير غير معتمد بعد.</div>
          )}
          <div className="mt-8 grid grid-cols-2 gap-8 text-center text-sm">
            <div className="border-t border-gray-400 pt-2">توقيع المُعِدّ</div>
            <div className="border-t border-gray-400 pt-2">ختم وتوقيع المدير</div>
          </div>
        </div>
      </div>
    </div>
  );
}
