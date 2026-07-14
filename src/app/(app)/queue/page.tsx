import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms, getSession } from "@/lib/access";

import Link from "next/link";
import { fmtTime } from "@/lib/labels";
import { addToQueue, setQueueStatus, removeQueue, clearDoneQueue } from "./actions";
import { normalizeStationName } from "@/lib/stations";
import { baghdadDayRange } from "@/lib/display-utils";
import { queueHallNames } from "@/lib/queue";

export const dynamic = "force-dynamic";

const SHARED_COLS = [
  { key: "CALLED", label: "تم الاستدعاء", clr: "border-sky-300", head: "bg-sky-100 text-sky-700", next: "IN_SESSION", nextLabel: "إدخال للجلسة" },
  { key: "IN_SESSION", label: "داخل الجلسة", clr: "border-amber-300", head: "bg-amber-100 text-amber-700", next: "DONE", nextLabel: "إنهاء" },
  { key: "DONE", label: "خلص", clr: "border-green-300", head: "bg-green-100 text-green-700", next: null, nextLabel: "" },
];

export default async function Queue() {
  const session = await getSession();
  await requirePerm("queue.view");
  const perms = await currentPerms();
  const editable = perms.has("queue.manage");
  const canDeleteQueue = (session?.user as any)?.role === "ADMIN";
  const { start: startToday, end: endToday } = baghdadDayRange(new Date());

  const [entries, patients, centers, therapyHalls] = await Promise.all([
    prisma.queueEntry.findMany({
      where: { createdAt: { gte: startToday, lt: endToday } },
      include: { patient: { include: { careStages: { where: { status: { in: ["WAITING", "IN_PROGRESS"] } }, orderBy: { sequence: "asc" }, take: 1 } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.patient.findMany({ where: { archivedAt: null }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, fileNumber: true } }),
    prisma.center.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.therapyHall.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  const halls = queueHallNames(therapyHalls.map((hall) => hall.name));

  return (
    <div className="space-y-5">
      <PageHeader title="طابور المراجعين" subtitle={`طابور اليوم — ${entries.length}`} icon="⏳" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <a href="/display" target="_blank" className="btn-ghost text-sm">📺 شاشة العرض</a>
          {canDeleteQueue && <form action={clearDoneQueue}><button className="btn-ghost text-sm">🧹 تفريغ المنتهين</button></form>}
        </div>
      </div>

      {editable && (
        <form action={addToQueue} className="card flex flex-wrap items-end gap-2 p-3">
          <div className="flex-1 min-w-[220px]">
            <label className="label">إضافة مراجع للطابور</label>
<Combobox name="patientId" required allowFree={false} placeholder="اختر المريض" options={patients.map((p:any)=>({value:String(p.id),label:`${p.fullName} (#${p.fileNumber})`}))} />
          </div>
          <div className="min-w-[210px]">
            <label className="label">القاعة</label>
<Combobox name="hall" required allowFree={false} placeholder="اختر القاعة" options={halls} />
          </div>
          <div className="min-w-[210px]">
            <label className="label">المركز</label>
<Combobox name="centerId" allowFree={false} placeholder="كل المراكز" options={centers.map((center) => ({ value: String(center.id), label: center.name }))} />
          </div>
          <div className="flex-1 min-w-[160px]"><label className="label">ملاحظة</label><input name="note" className="input" placeholder="اختياري" /></div>
          <button className="btn-primary" type="submit">➕ للطابور</button>
        </form>
      )}

      {/* الانتظار: مربع لكل قاعة */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {halls.map((hall) => {
          const list = entries.filter((e) => e.status === "WAITING" && e.hall === hall);
          return (
            <div key={hall} className="rounded-xl border-2 border-gray-300 bg-white">
              <div className="rounded-t-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700">⏳ {hall} <span className="opacity-70">({list.length})</span></div>
              <div className="space-y-2 p-3">
                {list.length === 0 && <p className="py-4 text-center text-xs text-gray-400">—</p>}
                {list.map((e) => (
                  <div key={e.id} className="rounded-lg border border-gray-200 p-3">
                    <Link href={`/patients/${e.patientId}`} className="font-medium text-brand-700 hover:underline">{e.patient.fullName}</Link>
                    <div className="text-xs text-gray-400">دخل الطابور {fmtTime(e.createdAt)}{e.note ? ` — ${e.note}` : ""}</div>
                    {e.patient.careStages[0] && <div className="mt-1 text-xs text-slate-500">المحطة الحالية: <b>{normalizeStationName(e.patient.careStages[0].station)}</b></div>}
                    {editable && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <form action={setQueueStatus.bind(null, e.id, "CALLED")}><button className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">استدعاء ←</button></form>
                        {canDeleteQueue && <form action={removeQueue.bind(null, e.id)}><button className="text-red-400 hover:text-red-600" title="إزالة">×</button></form>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* انتظار بدون قاعة (سجلات قديمة) */}
      {entries.some((e) => e.status === "WAITING" && !e.hall) && (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-3">
          <div className="mb-2 text-xs font-semibold text-amber-700">بالانتظار — بدون قاعة (حدّد قاعتهم بإعادة إضافتهم)</div>
          <div className="flex flex-wrap gap-2">
            {entries.filter((e) => e.status === "WAITING" && !e.hall).map((e) => (
              <span key={e.id} className="rounded-lg bg-white px-3 py-1 text-sm text-gray-700 shadow-sm">{e.patient.fullName}
                {canDeleteQueue && <form action={removeQueue.bind(null, e.id)} className="inline"><button className="mr-2 text-red-400">×</button></form>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* المراحل المشتركة */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SHARED_COLS.map((col) => {
          const list = entries.filter((e) => e.status === col.key);
          return (
            <div key={col.key} className={`rounded-xl border-2 ${col.clr} bg-white`}>
              <div className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${col.head}`}>{col.label} <span className="opacity-70">({list.length})</span></div>
              <div className="space-y-2 p-3">
                {list.length === 0 && <p className="py-4 text-center text-xs text-gray-400">—</p>}
                {list.map((e) => (
                  <div key={e.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/patients/${e.patientId}`} className="font-medium text-brand-700 hover:underline">{e.patient.fullName}</Link>
                      {e.hall && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{e.hall.replace("قاعة ", "")}</span>}
                    </div>
                    <div className="text-xs text-gray-400">دخل الطابور {fmtTime(e.createdAt)}{e.note ? ` — ${e.note}` : ""}</div>
                    {e.patient.careStages[0] && <div className="mt-1 text-xs text-slate-500">المحطة الحالية: <b>{normalizeStationName(e.patient.careStages[0].station)}</b></div>}
                    {editable && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {col.next && <form action={setQueueStatus.bind(null, e.id, col.next)}><button className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">{col.nextLabel} ←</button></form>}
                        <form action={setQueueStatus.bind(null, e.id, "WAITING")}><button className="text-xs text-gray-400 hover:underline">رجوع</button></form>
                        {canDeleteQueue && <form action={removeQueue.bind(null, e.id)}><button className="text-red-400 hover:text-red-600" title="إزالة">×</button></form>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
