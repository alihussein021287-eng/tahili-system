import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, requirePerm } from "@/lib/access";
import Link from "next/link";
import { CENTER_STATIONS, normalizeStationName } from "@/lib/stations";
import { fmtTime } from "@/lib/labels";

export const dynamic = "force-dynamic";

const STATIONS = CENTER_STATIONS.map((station) => station.name);

function fmtDur(ms: number | null): string {
  if (ms == null) return "—";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return `${h} ساعة${rm ? ` و${rm} د` : ""}`;
  const d = Math.floor(h / 24), rh = h % 24;
  return `${d} يوم${rh ? ` و${rh} س` : ""}`;
}

export default async function StationKPIs() {
  await requirePerm("reports.view");
  const perms = await currentPerms();
  const now = new Date();
  const startToday = new Date(now.toDateString());
  const startTomorrow = new Date(startToday.getTime() + 86400000);

  const [confirmed, activeStages, doneToday] = await Promise.all([
    prisma.careStage.findMany({
      where: { confirmedAt: { not: null }, patient: { archivedAt: null } },
      select: { patientId: true, station: true, sequence: true, confirmedAt: true },
      orderBy: [{ patientId: "asc" }, { sequence: "asc" }],
    }),
    prisma.careStage.findMany({
      where: { status: { in: ["WAITING", "IN_PROGRESS"] }, patient: { archivedAt: null } },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } } },
      orderBy: [{ patientId: "asc" }, { sequence: "asc" }],
    }),
    prisma.careStage.findMany({
      where: { confirmedAt: { gte: startToday, lt: startTomorrow }, patient: { archivedAt: null } },
      select: { station: true, confirmedAt: true },
      orderBy: { confirmedAt: "desc" },
    }),
  ]);

  // تجميع حسب المريض بالترتيب
  const byPatient = new Map<string, any[]>();
  for (const st of confirmed) {
    if (!byPatient.has(st.patientId)) byPatient.set(st.patientId, []);
    byPatient.get(st.patientId)!.push(st);
  }

  // تجميع لكل محطة: عدد المرور + زمن (من تأكيد المحطة السابقة إلى تأكيد الحالية)
  const agg = new Map<string, { thru: number; dcount: number; dsum: number }>();
  for (const list of byPatient.values()) {
    for (let i = 0; i < list.length; i++) {
      const cur = list[i], prev = i > 0 ? list[i - 1] : null;
      const station = normalizeStationName(cur.station);
      const a = agg.get(station) ?? { thru: 0, dcount: 0, dsum: 0 };
      a.thru++;
      if (prev) { const d = +new Date(cur.confirmedAt) - +new Date(prev.confirmedAt); if (d > 0) { a.dcount++; a.dsum += d; } }
      agg.set(station, a);
    }
  }

  const currentByPatient = new Map<string, any>();
  for (const st of activeStages) {
    if (!currentByPatient.has(st.patientId)) currentByPatient.set(st.patientId, st);
  }
  const currentStages = Array.from(currentByPatient.values());

  const waitMap = new Map<string, number>();
  const progressMap = new Map<string, number>();
  const sampleMap = new Map<string, any[]>();
  for (const st of currentStages) {
    const station = normalizeStationName(st.station);
    if (st.status === "IN_PROGRESS") progressMap.set(station, (progressMap.get(station) ?? 0) + 1);
    else waitMap.set(station, (waitMap.get(station) ?? 0) + 1);
    const samples = sampleMap.get(station) ?? [];
    if (samples.length < 3) samples.push(st);
    sampleMap.set(station, samples);
  }

  const doneMap = new Map<string, number>();
  const lastDoneMap = new Map<string, Date>();
  for (const st of doneToday) {
    const station = normalizeStationName(st.station);
    doneMap.set(station, (doneMap.get(station) ?? 0) + 1);
    if (st.confirmedAt && !lastDoneMap.has(station)) lastDoneMap.set(station, st.confirmedAt);
  }

  const stationNames = [...new Set([...STATIONS, ...agg.keys(), ...waitMap.keys(), ...progressMap.keys(), ...doneMap.keys()])];
  const rows = stationNames.map((name) => {
    const a = agg.get(name);
    const avg = a && a.dcount ? a.dsum / a.dcount : null;
    const meta = CENTER_STATIONS.find((station) => station.name === name);
    return {
      name,
      meta,
      thru: a?.thru ?? 0,
      avg,
      waiting: waitMap.get(name) ?? 0,
      inProgress: progressMap.get(name) ?? 0,
      doneToday: doneMap.get(name) ?? 0,
      lastDone: lastDoneMap.get(name) ?? null,
      samples: sampleMap.get(name) ?? [],
    };
  });

  const maxAvg = Math.max(1, ...rows.map((r) => r.avg ?? 0));
  const bottleneckTime = rows.filter((r) => r.avg != null).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0];
  const bottleneckQueue = [...rows].sort((a, b) => (b.waiting + b.inProgress) - (a.waiting + a.inProgress))[0];
  const activeTotal = currentStages.length;
  const doneTotal = doneToday.length;

  return (
    <div className="space-y-5">
      <PageHeader title="مؤشرات أداء المحطات" subtitle="استقبال، تشخيص، علاج، صيدلية، أجهزة، تضميد، ومالية" icon="📈" />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
          <div className="text-xs font-medium text-brand-700">قيد المسار الآن</div>
          <div className="mt-1 text-2xl font-bold text-brand-900">{activeTotal}</div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="text-xs font-medium text-emerald-700">مكتمل اليوم</div>
          <div className="mt-1 text-2xl font-bold text-emerald-900">{doneTotal}</div>
        </div>
        <Link href="/care-board" className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-brand-200 hover:bg-brand-50">
          <div className="text-xs font-medium text-gray-500">لوحة المرضى حسب المحطة</div>
          <div className="mt-1 text-lg font-bold text-gray-800">فتح اللوحة</div>
        </Link>
      </div>

      {activeTotal === 0 && doneTotal === 0 && rows.every((row) => row.thru === 0) ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">لا توجد بيانات مسار كافية بعد. ابدأ مسارات للمرضى وأكّد محطاتها.</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {bottleneckTime?.avg != null && (
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                <div className="text-xs font-medium text-amber-700">🕒 أبطأ محطة (أطول زمن)</div>
                <div className="mt-1 text-lg font-bold text-amber-800">{bottleneckTime.name}</div>
                <div className="text-sm text-amber-700">متوسط {fmtDur(bottleneckTime.avg)}</div>
              </div>
            )}
            {bottleneckQueue && (bottleneckQueue.waiting + bottleneckQueue.inProgress) > 0 && (
              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
                <div className="text-xs font-medium text-red-700">⚠ أكثر محطة ازدحاماً الآن</div>
                <div className="mt-1 text-lg font-bold text-red-800">{bottleneckQueue.name}</div>
                <div className="text-sm text-red-700">{bottleneckQueue.waiting} بالانتظار، {bottleneckQueue.inProgress} قيد العمل</div>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <div key={r.name} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-gray-900">{r.name}</div>
                    <div className="mt-1 text-xs text-gray-500">{r.meta?.description ?? "محطة مضافة يدوياً"}</div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{r.meta?.role ?? "—"}</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-lg font-bold text-gray-800">{r.waiting}</div>
                    <div className="text-[11px] text-gray-500">ينتظرون</div>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-2">
                    <div className="text-lg font-bold text-amber-800">{r.inProgress}</div>
                    <div className="text-[11px] text-amber-700">قيد العمل</div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-2">
                    <div className="text-lg font-bold text-emerald-800">{r.doneToday}</div>
                    <div className="text-[11px] text-emerald-700">مكتمل اليوم</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                  <span>متوسط الزمن: <b className="text-gray-700">{fmtDur(r.avg)}</b></span>
                  <span>آخر إنجاز: <b className="text-gray-700">{r.lastDone ? fmtTime(r.lastDone) : "—"}</b></span>
                </div>
                {r.samples.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {r.samples.map((st: any) => (
                      <Link key={st.id} href={`/patients/${st.patientId}`} className="block truncate rounded-lg bg-gray-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">
                        {st.patient.fullName}{st.patient.fileNumber ? ` #${st.patient.fileNumber}` : ""}
                      </Link>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {perms.has("journey.view") && <Link href="/care-board" className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">المحطة</Link>}
                  {perms.has("tasks.view") && r.meta?.role && <Link href={`/tasks?scope=role&role=${r.meta.role}`} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">مهام الدور</Link>}
                  {perms.has("queue.view") && <Link href="/queue" className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">الطابور</Link>}
                </div>
              </div>
            ))}
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="p-3 text-right">المحطة</th>
                  <th className="p-3 text-right">مرّ بها</th>
                  <th className="p-3 text-right">متوسط الزمن</th>
                  <th className="p-3 text-right w-1/3">مقارنة</th>
                  <th className="p-3 text-right">ينتظرون</th>
                  <th className="p-3 text-right">قيد العمل</th>
                  <th className="p-3 text-right">مكتمل اليوم</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-t">
                    <td className="p-3 font-medium text-gray-800">{r.name}</td>
                    <td className="p-3 text-gray-600">{r.thru}</td>
                    <td className="p-3 text-gray-700">{fmtDur(r.avg)}</td>
                    <td className="p-3">
                      <div className="h-2.5 w-full rounded-full bg-gray-100">
                        <div className="h-2.5 rounded-full bg-brand-500" style={{ width: `${r.avg != null ? Math.max(4, (r.avg / maxAvg) * 100) : 0}%` }} />
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
          <p className="text-xs text-gray-400">الزمن يُحسب من تأكيد المحطة السابقة إلى تأكيد المحطة الحالية. المحطة الأولى تُحتسب ضمن «مرّ بها» فقط.</p>
        </>
      )}
    </div>
  );
}
