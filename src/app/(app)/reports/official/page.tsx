import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm } from "@/lib/access";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fmtMoney } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { getOrg } from "@/lib/org";
import { currentPerms } from "@/lib/access";
import { fmtDate } from "@/lib/labels";
import { approveOfficialReport, unapproveOfficialReport } from "./actions";

export const dynamic = "force-dynamic";
const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

export default async function OfficialReport({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const session = await requireSession();
  await requirePerm("reports.official");
  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const month = sp.month !== undefined && sp.month !== "" ? Number(sp.month) : now.getMonth();
  const mStart = new Date(year, month, 1), mEnd = new Date(year, month + 1, 1);
  const org = await getOrg();
  const perms = await currentPerms();
  const canApprove = perms.has("reports.approve");
  const approval = await prisma.reportApproval.findUnique({ where: { kind_refKey: { kind: "official-monthly", refKey: `${year}-${month}` } } });

  const [newP, totalP, sessions, admStart, admittedNow, devices, inv] = await Promise.all([
    prisma.patient.count({ where: { registrationDate: { gte: mStart, lt: mEnd } } }),
    prisma.patient.count({ where: { archivedAt: null } }),
    prisma.therapySession.count({ where: { createdAt: { gte: mStart, lt: mEnd } } }),
    prisma.admission.count({ where: { admissionDate: { gte: mStart, lt: mEnd } } }),
    prisma.admission.count({ where: { status: "ADMITTED" } }),
    prisma.device.count({ where: { deliveredAt: { gte: mStart, lt: mEnd } } }),
    prisma.invoice.aggregate({ _sum: { amount: true, paidAmount: true }, where: { issuedAt: { gte: mStart, lt: mEnd } } }),
  ]);
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const stat = (label: string, value: any) => (
    <tr><td className="td font-medium">{label}</td><td className="td text-center text-lg font-bold text-brand-800">{value}</td></tr>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="التقرير الإحصائي الرسمي" subtitle="إحصاء شهري قابل للطباعة" icon="📄" />
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-500">الفترة: {MONTHS[month]} {year}</div>
        {approval && <span className="badge-success">✔ معتمد — {approval.approvedBy}</span>}
        {perms.has("reports.print") && <PrintButton />}
      </div>

      {canApprove && (
        <div className="no-print card p-4">
          {approval ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-gray-600">هذا التقرير معتمد بواسطة <b className="text-gray-800">{approval.approvedBy}</b>{approval.title ? ` (${approval.title})` : ""} بتاريخ {fmtDate(approval.approvedAt)}.</div>
              <form action={unapproveOfficialReport.bind(null, year, month)}><button className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200">إلغاء الاعتماد</button></form>
            </div>
          ) : (
            <form action={approveOfficialReport.bind(null, year, month)} className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3 font-semibold text-gray-700">اعتماد التقرير إلكترونياً</div>
              <div><label className="label">المعتمِد</label><input name="approvedBy" className="input" defaultValue={session?.user?.name ?? ""} required /></div>
              <div><label className="label">الصفة/المنصب</label><input name="title" className="input" placeholder="مثال: مدير المركز" /></div>
              <div><label className="label">ملاحظة (اختياري)</label><input name="note" className="input" /></div>
              <div className="sm:col-span-3"><button className="btn-primary" type="submit">اعتماد وتوقيع</button></div>
            </form>
          )}
        </div>
      )}
      <div className="no-print flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-500">السنة:</span>
        {years.map((y) => <Link key={y} href={`/reports/official?year=${y}&month=${month}`} className={`badge ${y === year ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"}`}>{y}</Link>)}
        <span className="ms-2 text-sm text-gray-500">الشهر:</span>
        {MONTHS.map((m, i) => <Link key={i} href={`/reports/official?year=${year}&month=${i}`} className={`badge ${i === month ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"}`}>{m}</Link>)}
      </div>

      <div id="card" className="card mx-auto max-w-2xl p-8">
        <div className="print-header border-b-2 border-brand-700 pb-4 text-center">
          {(org.officialHeader1 || org.officialHeader2 || org.officialHeader3) && <div className="text-sm font-semibold text-gray-700">{[org.officialHeader1, org.officialHeader2, org.officialHeader3].filter(Boolean).join(" - ")}</div>}
          <div className="text-2xl font-bold text-brand-900">{org.officialHeader4 || org.name}</div>
          {org.subtitle && <div className="text-sm text-gray-600">{org.subtitle}</div>}
          <div className="mt-1 text-xs text-gray-500">{[org.officialAddress || org.address, org.officialPhone || org.phone].filter(Boolean).join(" — ")}</div>
        </div>
        <div className="my-4 text-center">
          <div className="text-lg font-bold text-gray-800">تقرير إحصائي شهري</div>
          <div className="text-sm text-gray-500">عن شهر {MONTHS[month]} {year}</div>
        </div>
        <table className="w-full border border-gray-200 text-sm">
          <tbody>
            {stat("مراجعون جدد خلال الشهر", newP)}
            {stat("إجمالي المراجعين (نشطون)", totalP)}
            {stat("الجلسات العلاجية خلال الشهر", sessions)}
            {stat("حالات رقود بدأت خلال الشهر", admStart)}
            {stat("الراقدون حالياً", admittedNow)}
            {stat("أجهزة/أطراف سُلّمت خلال الشهر", devices)}
            {stat("إجمالي الفواتير خلال الشهر", fmtMoney(inv._sum.amount ?? 0))}
            {stat("المبالغ المحصّلة خلال الشهر", fmtMoney(inv._sum.paidAmount ?? 0))}
          </tbody>
        </table>
        {approval ? (
          <div className="mt-10 flex items-end justify-between text-sm text-gray-700">
            <div>التاريخ: {fmtDate(approval.approvedAt)}</div>
            <div className="text-center">
              <div className="mb-1 font-semibold text-gray-800">المعتمِد: {approval.approvedBy}</div>
              {approval.title && <div className="text-xs text-gray-500">{approval.title}</div>}
              <div className="mt-1 inline-block rounded border-2 border-emerald-600 px-3 py-1 text-xs font-bold text-emerald-700">معتمد إلكترونياً ✔</div>
            </div>
          </div>
        ) : (
          <div className="mt-10 flex justify-between text-sm text-gray-600">
            <div>التاريخ: ......................</div>
            <div>التوقيع: ......................</div>
          </div>
        )}
      </div>
    </div>
  );
}
