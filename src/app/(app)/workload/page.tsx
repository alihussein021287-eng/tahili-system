import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, requirePerm } from "@/lib/access";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Workload() {
  const session = await requireSession();
  await requirePerm("workload.view");
  const perms = await currentPerms();
  const canLogSession = perms.has("clinical.session");
  const role = (session.user as any).role as string;
  const userId = (session.user as any).id as string;
  const centerIds = role === "ADMIN" ? [] : (await prisma.centerMembership.findMany({ where: { userId, role: "HEAD_THERAPIST", status: "ACTIVE" }, select: { centerId: true } })).map((membership) => membership.centerId);
  const therapyScope: any = role === "ADMIN" ? {} : { centerId: { in: centerIds } };
  const appointmentScope: any = role === "ADMIN" ? {} : { session: { centerId: { in: centerIds } } };

  const startToday = new Date(new Date().toDateString());
  const tomorrow = new Date(startToday.getTime() + 86400000);

  const [byTherapist, todayAppts, sessRows, apptByStatus, todayTherapyAppts] = await Promise.all([
    prisma.therapySession.groupBy({ by: ["therapist"], where: therapyScope, _count: { _all: true }, _sum: { actualSessions: true, totalSessions: true } }),
    prisma.appointment.findMany({ where: { ...appointmentScope, scheduledAt: { gte: startToday, lt: tomorrow }, status: "SCHEDULED" }, select: { assignedTo: true } }),
    prisma.therapySession.findMany({ where: therapyScope, select: { therapist: true, patientId: true, totalSessions: true, actualSessions: true, benefitRate: true } }),
    prisma.appointment.groupBy({ by: ["assignedTo", "status"], where: appointmentScope, _count: { _all: true } }),
    prisma.appointment.findMany({
      where: { ...appointmentScope, scheduledAt: { gte: startToday, lt: tomorrow }, sessionId: { not: null }, status: { in: ["SCHEDULED", "COMPLETED"] } },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, session: { select: { therapyType: true, hall: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 80,
    }),
  ]);

  // ===== مؤشرات الأداء لكل معالج =====
  type K = { patients: Set<string>; sessions: number; planned: number; actual: number; benefitSum: number; benefitN: number; done: number; cancelled: number; noshow: number; scheduled: number };
  const kpi: Record<string, K> = {};
  const ensure = (name: string) => (kpi[name] ??= { patients: new Set(), sessions: 0, planned: 0, actual: 0, benefitSum: 0, benefitN: 0, done: 0, cancelled: 0, noshow: 0, scheduled: 0 });
  for (const r of sessRows) {
    const k = ensure(r.therapist || "غير محدّد");
    k.patients.add(r.patientId); k.sessions++; k.planned += r.totalSessions || 0; k.actual += r.actualSessions || 0;
    const b = parseFloat(String(r.benefitRate || "").replace(/[^0-9.]/g, ""));
    if (!isNaN(b) && b > 0) { k.benefitSum += b; k.benefitN++; }
  }
  for (const r of apptByStatus) {
    const k = ensure(r.assignedTo || "غير محدّد");
    const c = (r as any)._count._all as number;
    if (r.status === "COMPLETED") k.done = c;
    else if (r.status === "CANCELLED") k.cancelled = c;
    else if (r.status === "NOSHOW") k.noshow = c;
    else if (r.status === "SCHEDULED") k.scheduled = c;
  }
  const kpiRows = Object.entries(kpi).map(([name, k]) => {
    const realized = k.done + k.noshow + k.cancelled;
    const completion = realized > 0 ? Math.round((k.done / realized) * 100) : null;
    const avgBenefit = k.benefitN > 0 ? Math.round(k.benefitSum / k.benefitN) : null;
    return { name, patients: k.patients.size, sessions: k.sessions, planned: k.planned, actual: k.actual, done: k.done, scheduled: k.scheduled, completion, avgBenefit };
  }).sort((a, b) => b.actual - a.actual || b.patients - a.patients);
  const pctCls = (p: number | null) => p === null ? "text-gray-400" : p >= 80 ? "text-emerald-700" : p >= 50 ? "text-amber-700" : "text-red-700";

  const rows = byTherapist
    .map((r: any) => ({ name: r.therapist || "غير محدّد", sessions: r._count._all, planned: r._sum.totalSessions || 0, actual: r._sum.actualSessions || 0 }))
    .sort((a, b) => b.sessions - a.sessions);
  const maxS = Math.max(1, ...rows.map((r) => r.sessions));

  const apptCount: Record<string, number> = {};
  for (const a of todayAppts) { const k = a.assignedTo || "غير محدّد"; apptCount[k] = (apptCount[k] || 0) + 1; }
  const apptRows = Object.entries(apptCount).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      <PageHeader title="حمل المعالجين" subtitle="توزيع الجلسات على المعالجين" icon="👷" />

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-700">إجمالي المسارات والجلسات لكل معالج</h2>
        {rows.length === 0 && <p className="text-sm text-gray-400">لا توجد بيانات. أضف اسم المعالج في الجلسات العلاجية.</p>}
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 truncate text-gray-600" title={r.name}>{r.name}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                <div className="flex h-full items-center justify-end rounded bg-brand-600 pe-2 text-xs text-white" style={{ width: `${(r.sessions / maxS) * 100}%` }}>{r.sessions}</div>
              </div>
              <span className="w-36 shrink-0 text-left text-xs text-gray-500">{r.actual} منجز / {r.planned || "—"} مخطط</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-700">مواعيد اليوم حسب المعالج</h2>
        {apptRows.length === 0 && <p className="text-sm text-gray-400">لا مواعيد اليوم.</p>}
        <div className="flex flex-wrap gap-3">
          {apptRows.map(([name, n]) => (
            <div key={name} className="rounded-xl border border-gray-200 px-4 py-3 text-center">
              <div className="text-2xl font-bold text-brand-700">{n}</div>
              <div className="text-xs text-gray-500">{name}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-700">جلسات اليوم للتوثيق</div>
        {todayTherapyAppts.length === 0 ? (
          <p className="p-5 text-sm text-gray-400">لا توجد مواعيد جلسات علاجية اليوم.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">المعالج</th><th className="th">القاعة</th><th className="th">الحالة</th><th className="th">إجراء</th></tr></thead>
              <tbody>
                {todayTherapyAppts.map((a: any) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="td">{new Date(a.scheduledAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" })}</td>
                    <td className="td"><Link href={`/patients/${a.patientId}`} className="font-medium text-brand-700 hover:underline">{a.patient.fullName} #{a.patient.fileNumber}</Link></td>
                    <td className="td">{a.assignedTo || "—"}</td>
                    <td className="td">{a.session?.hall || "—"}</td>
                    <td className="td">{a.status === "COMPLETED" ? <span className="badge-success">مكتملة</span> : <span className="badge-info">مجدولة</span>}</td>
                    <td className="td">
                      {canLogSession ? <Link href={`/patients/${a.patientId}`} className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">تسجيل نتيجة</Link> : <span className="text-xs text-gray-400">تحتاج clinical.session</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-2 text-xs text-gray-400">يفتح الزر ملف المراجع. سجّل النتيجة من تبويب «الجلسات العلاجية» ضمن سجل الجلسات اليومية.</div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-700">مؤشرات الأداء لكل معالج</div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="th">المعالج</th>
              <th className="th">المراجعون</th>
              <th className="th">المسارات</th>
              <th className="th">المخطط</th>
              <th className="th">المنجز</th>
              <th className="th">مواعيد مكتملة</th>
              <th className="th">قادمة</th>
              <th className="th">نسبة الإكمال</th>
              <th className="th">متوسط الاستفادة</th>
            </tr></thead>
            <tbody>
              {kpiRows.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={9}>لا توجد بيانات بعد.</td></tr>}
              {kpiRows.map((r) => (
                <tr key={r.name} className="hover:bg-gray-50">
                  <td className="td font-medium text-gray-800">{r.name}</td>
                  <td className="td">{r.patients}</td>
                  <td className="td">{r.sessions}</td>
                  <td className="td">{r.planned || "—"}</td>
                  <td className="td">{r.actual}</td>
                  <td className="td">{r.done}</td>
                  <td className="td">{r.scheduled}</td>
                  <td className={`td font-semibold ${pctCls(r.completion)}`}>{r.completion === null ? "—" : `${r.completion}%`}</td>
                  <td className="td">{r.avgBenefit === null ? "—" : `${r.avgBenefit}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-2 text-xs text-gray-400">نسبة الإكمال = المواعيد المكتملة ÷ (مكتملة + ملغاة + لم يحضر). متوسط الاستفادة محسوب من الجلسات التي فيها قيمة رقمية.</div>
      </div>
    </div>
  );
}
