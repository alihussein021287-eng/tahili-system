import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canManageFinance } from "@/lib/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fmtMoney } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { getOrg } from "@/lib/org";

export const dynamic = "force-dynamic";
const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

export default async function FinanceReport({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requirePerm("finance.report");
  const sp = await searchParams;
  const nowY = new Date().getFullYear();
  const year = Number(sp.year) || nowY;
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const org = await getOrg();

  const invoices = await prisma.invoice.findMany({
    where: { issuedAt: { gte: start, lt: end } },
    select: { amount: true, paidAmount: true, issuedAt: true },
  });

  const rows = MONTHS.map((m, i) => ({ month: m, billed: 0, collected: 0, count: 0 }));
  for (const inv of invoices) {
    const i = new Date(inv.issuedAt).getMonth();
    rows[i].billed += inv.amount ?? 0;
    rows[i].collected += inv.paidAmount ?? 0;
    rows[i].count += 1;
  }
  const tBilled = rows.reduce((a, r) => a + r.billed, 0);
  const tCollected = rows.reduce((a, r) => a + r.collected, 0);
  const tOutstanding = tBilled - tCollected;
  const tCount = invoices.length;
  const years = [nowY, nowY - 1, nowY - 2, nowY - 3];

  return (
    <div className="space-y-5">
      <PageHeader title="التقرير المالي السنوي" subtitle="ملخص الإيرادات والتحصيل" icon="📊" />
      <div className="no-print flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <Link href="/finance" className="btn-ghost">→ المالية</Link>
          <PrintButton />
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-500">السنة:</span>
        {years.map((y) => (
          <Link key={y} href={`/finance/report?year=${y}`} className={`badge ${y === year ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"}`}>{y}</Link>
        ))}
      </div>

      <div id="card" className="space-y-5">
        <div className="print-header text-center">
          {(org.officialHeader1 || org.officialHeader2 || org.officialHeader3) && <div className="text-sm font-semibold text-gray-700">{[org.officialHeader1, org.officialHeader2, org.officialHeader3].filter(Boolean).join(" - ")}</div>}
          <div className="text-lg font-bold text-brand-900">{org.officialHeader4 || org.name}</div>
          <div className="text-xs text-gray-500">{[org.officialAddress || org.address, org.officialPhone || org.phone].filter(Boolean).join(" — ")}</div>
          <div className="text-sm text-gray-500">التقرير المالي لسنة {year}</div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="card p-5"><div className="text-2xl font-bold text-gray-800">{fmtMoney(tBilled)}</div><div className="text-sm text-gray-500">إجمالي الفواتير</div></div>
          <div className="card p-5"><div className="text-2xl font-bold text-green-700">{fmtMoney(tCollected)}</div><div className="text-sm text-gray-500">المحصّل</div></div>
          <div className="card p-5"><div className="text-2xl font-bold text-red-700">{fmtMoney(tOutstanding)}</div><div className="text-sm text-gray-500">المتبقّي</div></div>
          <div className="card p-5"><div className="text-2xl font-bold text-gray-800">{tCount}</div><div className="text-sm text-gray-500">عدد الفواتير</div></div>
        </div>

        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead><tr><th className="th">الشهر</th><th className="th">عدد الفواتير</th><th className="th">الفواتير</th><th className="th">المحصّل</th><th className="th">المتبقّي</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="td font-medium">{r.month}</td>
                  <td className="td">{r.count || "—"}</td>
                  <td className="td">{fmtMoney(r.billed)}</td>
                  <td className="td text-green-700">{fmtMoney(r.collected)}</td>
                  <td className={`td ${r.billed - r.collected > 0 ? "text-red-700" : ""}`}>{fmtMoney(r.billed - r.collected)}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-bold">
                <td className="td">الإجمالي</td>
                <td className="td">{tCount}</td>
                <td className="td">{fmtMoney(tBilled)}</td>
                <td className="td text-green-700">{fmtMoney(tCollected)}</td>
                <td className="td text-red-700">{fmtMoney(tOutstanding)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
