import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, requirePerm } from "@/lib/access";
import Link from "next/link";
import { baghdadDayRange } from "@/lib/display-utils";
import { handoffKpis } from "@/lib/handoff-kpis";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

function fmtDur(ms: number | null): string {
  if (ms == null) return "—";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return `${h} ساعة${rm ? ` و${rm} د` : ""}`;
  const d = Math.floor(h / 24), rh = h % 24;
  return `${d} يوم${rh ? ` و${rh} س` : ""}`;
}

/** Station KPIs read from the handoffs — the same source as "now with" on every screen. */
export default async function StationKPIs() {
  await requirePerm("reports.view");
  const perms = await currentPerms();
  const now = new Date();
  const today = baghdadDayRange(now);
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const handoffs = await prisma.patientHandoff.findMany({
    where: { patient: { archivedAt: null }, OR: [{ sentAt: { gte: since } }, { status: { in: ["SENT", "ACCEPTED"] } }] },
    select: { id: true, patientId: true, toRole: true, status: true, sentAt: true, acceptedAt: true, doneAt: true, fromCenterId: true, toCenterId: true, patient: { select: { fullName: true, fileNumber: true } } },
    orderBy: { sentAt: "asc" },
    take: 5000,
  });
  const rows = handoffKpis(handoffs, now, today);
  const maxAvg = Math.max(1, ...rows.map((r) => r.avgReceiveMs ?? 0));
  const bottleneckTime = rows.filter((r) => r.avgReceiveMs != null).sort((a, b) => (b.avgReceiveMs ?? 0) - (a.avgReceiveMs ?? 0))[0];
  const bottleneckQueue = [...rows].sort((a, b) => (b.waiting + b.inProgress) - (a.waiting + a.inProgress))[0];
  const activeTotal = rows.reduce((sum, r) => sum + r.waiting + r.inProgress, 0);
  const lateTotal = rows.reduce((sum, r) => sum + r.late, 0);
  const doneTotal = rows.reduce((sum, r) => sum + r.doneToday, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="مؤشرات أداء المحطات" subtitle={`من التسليمات: من ينتظر، من استلم، ومن تأخر — آخر ${WINDOW_DAYS} يوم`} icon="📈" />

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
          <div className="text-xs font-medium text-brand-700">مراجعين بتسليم مفتوح</div>
          <div className="mt-1 text-2xl font-bold text-brand-900">{activeTotal}</div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="text-xs font-medium text-emerald-700">مكتمل اليوم</div>
          <div className="mt-1 text-2xl font-bold text-emerald-900">{doneTotal}</div>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <div className="text-xs font-medium text-red-700">متأخر عن الاستلام</div>
          <div className="mt-1 text-2xl font-bold text-red-900">{lateTotal}</div>
        </div>
        <Link href="/care-board" className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-brand-200 hover:bg-brand-50">
          <div className="text-xs font-medium text-gray-500">لوحة المراجعين حسب المرحلة</div>
          <div className="mt-1 text-lg font-bold text-gray-800">فتح اللوحة</div>
        </Link>
      </div>

      {rows.every((row) => row.thru === 0) ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">لا توجد تسليمات بعد. المؤشرات تظهر من يبدأ الموظفون بتسليم المراجعين.</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {bottleneckTime?.avgReceiveMs != null && (
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                <div className="text-xs font-medium text-amber-700">🕒 أبطأ استلام (متوسط الانتظار)</div>
                <div className="mt-1 text-lg font-bold text-amber-800">{bottleneckTime.label}</div>
                <div className="text-sm text-amber-700">متوسط {fmtDur(bottleneckTime.avgReceiveMs)}</div>
              </div>
            )}
            {bottleneckQueue && (bottleneckQueue.waiting + bottleneckQueue.inProgress) > 0 && (
              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
                <div className="text-xs font-medium text-red-700">⚠ أكثر مرحلة ازدحاماً الآن</div>
                <div className="mt-1 text-lg font-bold text-red-800">{bottleneckQueue.label}</div>
                <div className="text-sm text-red-700">{bottleneckQueue.waiting} بانتظار الاستلام، {bottleneckQueue.inProgress} مستلم</div>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <div key={r.role} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-gray-900">{r.label}</div>
                    <div className="mt-1 text-xs text-gray-500">حد الاستلام: {fmtDur(r.limitMinutes * 60000)}</div>
                  </div>
                  {r.late > 0 && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700">{r.late} متأخر</span>}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-lg font-bold text-gray-800">{r.waiting}</div>
                    <div className="text-[11px] text-gray-500">بانتظار الاستلام</div>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-2">
                    <div className="text-lg font-bold text-amber-800">{r.inProgress}</div>
                    <div className="text-[11px] text-amber-700">مستلم</div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-2">
                    <div className="text-lg font-bold text-emerald-800">{r.doneToday}</div>
                    <div className="text-[11px] text-emerald-700">مكتمل اليوم</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                  <span>متوسط الاستلام: <b className="text-gray-700">{fmtDur(r.avgReceiveMs)}</b></span>
                  <span>تسليمات {WINDOW_DAYS} يوم: <b className="text-gray-700">{r.thru}</b></span>
                </div>
                {r.samples.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {r.samples.map((st) => (
                      <Link key={st.id} href={`/patients/${st.patientId}`} className="block truncate rounded-lg bg-gray-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">
                        {st.patient?.fullName}{st.patient?.fileNumber ? ` #${st.patient.fileNumber}` : ""}
                      </Link>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {perms.has("journey.view") && <Link href="/care-board" className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">اللوحة</Link>}
                  {perms.has("tasks.view") && <Link href="/staff?tab=tasks" className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">مهام الدور</Link>}
                  {perms.has("queue.view") && <Link href="/queue" className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">الطابور</Link>}
                </div>
              </div>
            ))}
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="p-3 text-right">المرحلة</th>
                  <th className="p-3 text-right">تسليمات</th>
                  <th className="p-3 text-right">متوسط الاستلام</th>
                  <th className="p-3 text-right w-1/3">مقارنة</th>
                  <th className="p-3 text-right">بانتظار الاستلام</th>
                  <th className="p-3 text-right">مستلم</th>
                  <th className="p-3 text-right">مكتمل اليوم</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.role} className="border-t">
                    <td className="p-3 font-medium text-gray-800">{r.label}</td>
                    <td className="p-3 text-gray-600">{r.thru}</td>
                    <td className="p-3 text-gray-700">{fmtDur(r.avgReceiveMs)}</td>
                    <td className="p-3">
                      <div className="h-2.5 w-full rounded-full bg-gray-100">
                        <div className="h-2.5 rounded-full bg-brand-500" style={{ width: `${r.avgReceiveMs != null ? Math.max(4, (r.avgReceiveMs / maxAvg) * 100) : 0}%` }} />
                      </div>
                    </td>
                    <td className="p-3">{r.waiting > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{r.waiting}</span> : <span className="text-gray-300">0</span>}</td>
                    <td className="p-3">{r.inProgress > 0 ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">{r.inProgress}</span> : <span className="text-gray-300">0</span>}</td>
                    <td className="p-3">{r.doneToday > 0 ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">{r.doneToday}</span> : <span className="text-gray-300">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">متوسط الاستلام = من لحظة الإرسال إلى لحظة استلام المراجع. «متأخر» = لم يُستلم خلال حد المرحلة.</p>
        </>
      )}
    </div>
  );
}
