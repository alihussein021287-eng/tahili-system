import Link from "next/link";
import { currentPerms, requirePerm } from "@/lib/access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { THERAPY, PATIENT_STATUS } from "@/lib/labels";
import { BarChart, Donut, HBars } from "@/components/charts";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const AR_MONTHS = ["كانون2","شباط","آذار","نيسان","أيار","حزيران","تموز","آب","أيلول","تشرين1","تشرين2","كانون1"];

export default async function Reports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePerm("reports.view");
  const perms = await currentPerms();
  const sp = await searchParams;
  const from = sp.from ? new Date(sp.from) : null;
  const to = sp.to ? new Date(sp.to + "T23:59:59") : null;
  const range = from || to ? { gte: from ?? undefined, lte: to ?? undefined } : undefined;
  const regWhere = range ? { registrationDate: range } : {};
  const sessWhere = range ? { createdAt: range } : {};
  const apptWhere = range ? { scheduledAt: range } : {};

  const [byStatus, bySessionType, byGov, total, admitted, apptAgg, sessAgg, regDates, govs] = await Promise.all([
    prisma.patient.groupBy({ by: ["status"], _count: true, where: regWhere }),
    prisma.therapySession.groupBy({ by: ["therapyType"], _count: true, where: sessWhere }),
    prisma.patient.groupBy({ by: ["governorateId"], _count: true, where: regWhere }),
    prisma.patient.count({ where: regWhere }),
    prisma.admission.count({ where: { status: "ADMITTED" } }),
    prisma.appointment.groupBy({ by: ["status"], _count: true, where: apptWhere }),
    prisma.therapySession.aggregate({ _sum: { totalSessions: true, actualSessions: true }, where: sessWhere }),
    prisma.patient.findMany({ select: { registrationDate: true }, where: regWhere }),
    prisma.governorate.findMany(),
  ]);

  const govName = (id: number | null) => govs.find((g) => g.id === id)?.name ?? "غير محدد";
  const totalSessions = sessAgg._sum.totalSessions ?? 0;
  const actualSessions = sessAgg._sum.actualSessions ?? 0;
  const completionRate = totalSessions ? Math.round((actualSessions / totalSessions) * 100) : 0;
  const apptTotal = apptAgg.reduce((a, b) => a + (b._count as number), 0);
  const noShow = apptAgg.find((a) => a.status === "NOSHOW")?._count ?? 0;
  const noShowRate = apptTotal ? Math.round((noShow / apptTotal) * 100) : 0;

  const now = new Date();
  const buckets: { label: string; value: number; key: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ label: AR_MONTHS[d.getMonth()], value: 0, key: `${d.getFullYear()}-${d.getMonth()}` });
  }
  for (const r of regDates) {
    const d = new Date(r.registrationDate);
    const b = buckets.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (b) b.value++;
  }

  const kpis = [
    { label: "إجمالي المراجعين", value: total },
    { label: "راقدون حالياً", value: admitted },
    { label: "معدّل إكمال الجلسات", value: `${completionRate}%` },
    { label: "نسبة عدم الحضور", value: `${noShowRate}%` },
  ];
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as any).toString();

  return (
    <div className="space-y-6">
      <PageHeader title="التقارير الإحصائية" subtitle="إحصاءات ورسوم بيانية" icon="📈" />
      <div className="flex flex-wrap gap-2">
        <Link href="/reports/daily" className="rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100">📋 تقرير العمليات اليومي</Link>
        <Link href="/reports/official" className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-200">📄 التقرير الرسمي الشهري</Link>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {perms.has("reports.print") && <PrintButton />}
        {perms.has("patients.export") && <a href={`/api/export/patients${exportQs ? "?" + exportQs : ""}`} className="btn-ghost">⤓ تصدير المراجعين (Excel)</a>}
      </div>

      <form action="/reports" className="card flex flex-wrap items-end gap-2 p-3">
        <div><label className="label">من تاريخ</label><input name="from" type="date" className="input" defaultValue={sp.from ?? ""} /></div>
        <div><label className="label">إلى تاريخ</label><input name="to" type="date" className="input" defaultValue={sp.to ?? ""} /></div>
        <button className="btn-primary" type="submit">تطبيق</button>
        <a href="/reports" className="btn-ghost">مسح</a>
        {range && <span className="text-sm text-gray-500">الإحصائيات ضمن الفترة المحددة</span>}
      </form>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card p-5"><div className="text-2xl font-bold text-gray-800">{k.value}</div><div className="text-sm text-gray-500">{k.label}</div></div>
        ))}
      </div>

      <div className="card p-5">
        <h2 className="mb-4 font-semibold text-gray-700">المراجعون الجدد — آخر 12 شهر</h2>
        <BarChart data={buckets.map((b) => ({ label: b.label, value: b.value }))} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 font-semibold text-gray-700">المراجعون حسب الحالة</h2>
          <Donut data={byStatus.map((r) => ({ label: PATIENT_STATUS[r.status as keyof typeof PATIENT_STATUS], value: r._count as number }))} />
        </div>
        <div className="card p-5">
          <h2 className="mb-4 font-semibold text-gray-700">الجلسات حسب المسار العلاجي</h2>
          <Donut data={bySessionType.map((r) => ({ label: THERAPY[r.therapyType as keyof typeof THERAPY], value: r._count as number }))} />
        </div>
        <div className="card p-5 md:col-span-2">
          <h2 className="mb-4 font-semibold text-gray-700">المراجعون حسب المحافظة</h2>
          <HBars data={byGov.map((r) => ({ label: govName(r.governorateId), value: r._count as number })).sort((a, b) => b.value - a.value)} />
        </div>
      </div>
    </div>
  );
}
