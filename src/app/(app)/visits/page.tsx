import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms } from "@/lib/access";
import Link from "next/link";
import { fmtDateTime, fmtDate, PATIENT_STATUS } from "@/lib/labels";
import { receptionCheckIn, recordVisit } from "./actions";
import { CENTER_STATIONS } from "@/lib/stations";
import { activeCenterHallOptions } from "@/lib/center-halls";
import { CenterHallSelect } from "@/components/CenterHallSelect";

export const dynamic = "force-dynamic";

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ q?: string; saved?: string }> }) {
  await requirePerm("visits.view");
  const perms = await currentPerms();
  const editable = perms.has("visits.manage");
  const canQueue = perms.has("queue.manage");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const asNum = Number(q);
  const isNum = q !== "" && !isNaN(asNum);

  const startToday = new Date(new Date().toDateString());
  const endToday = new Date(startToday.getTime() + 86400000);

  const [patients, todayVisits, matchedPatients, centers, centerHalls] = await Promise.all([
    prisma.patient.findMany({ where: { archivedAt: null }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, fileNumber: true, phone: true, status: true } }),
    prisma.visit.findMany({ where: { visitDate: { gte: startToday } }, include: { patient: true }, orderBy: { visitDate: "desc" } }),
    q
      ? prisma.patient.findMany({
          where: { OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            ...(isNum ? [{ fileNumber: asNum }] : []),
          ] },
          include: {
            visits: { orderBy: { visitDate: "desc" }, take: 50 },
            appointments: { orderBy: { scheduledAt: "desc" }, take: 1 },
            queueEntries: { where: { createdAt: { gte: startToday, lt: endToday }, status: { in: ["WAITING", "CALLED", "IN_SESSION"] } }, orderBy: { createdAt: "desc" }, take: 1 },
          },
          take: 10, orderBy: { fullName: "asc" },
        })
      : Promise.resolve([]),
    prisma.center.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    activeCenterHallOptions(prisma),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="استعلامات وحضور المراجعين" subtitle={`حضور اليوم — ${todayVisits.length}`} icon="📋">
        <Link href="/patients-care?tab=visits" className="btn-ghost bg-white text-brand-700">لوحة المرضى والرعاية</Link>
      </PageHeader>

      {sp.saved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{sp.saved}</div>}

      {editable && (
        <form action={recordVisit} className="card flex flex-wrap items-end gap-2 p-3">
          <input type="hidden" name="returnTo" value="/visits" />
          <div className="flex-1 min-w-[240px]">
            <label className="label">تسجيل حضور مراجع</label>
            <Combobox name="patientId" required allowFree={false} placeholder="اختر المراجع"
              options={patients.map((p) => ({ value: String(p.id), label: `${p.fullName} (#${p.fileNumber})` }))} />
          </div>
          <div className="flex-1 min-w-[160px]"><label className="label">ملاحظة</label><input name="notes" className="input" placeholder="اختياري" /></div>
          <div className="min-w-[210px]">
            <label className="label" htmlFor="quick-destination">الوجهة التالية</label>
            <select id="quick-destination" name="destination" className="input" defaultValue="">
              <option value="">بدون تحويل</option>
              {CENTER_STATIONS.map((station) => <option key={station.name} value={station.name}>{station.name}</option>)}
            </select>
          </div>
          <button className="btn-primary" type="submit">✔ تسجيل حضور</button>
        </form>
      )}

      <form action="/visits" className="card flex items-end gap-2 p-3">
        <div className="flex-1">
          <label className="label">استعلام عن مراجع (سجل الحضور الكامل)</label>
          <input name="q" className="input" defaultValue={q} placeholder="اسم المراجع، الهاتف، أو رقم الملف" autoFocus />
        </div>
        <button className="btn-primary" type="submit">استعلام</button>
      </form>

      {q && matchedPatients.length > 0 && (
        <div className="grid gap-3">
          {matchedPatients.map((p: any) => {
            const lastVisit = p.visits[0];
            const lastAppt = p.appointments[0];
            const hasQueue = p.queueEntries.length > 0;
            const todayVisit = p.visits.find((v: any) => new Date(v.visitDate) >= startToday && new Date(v.visitDate) < endToday);
            const locked = Boolean(p.archivedAt);
            const inactive = p.status !== "ACTIVE";
            return (
              <div key={p.id} className={`card p-4 ${locked ? "border-red-200 bg-red-50/30" : inactive ? "border-amber-200 bg-amber-50/30" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/patients/${p.id}`} className="text-base font-bold text-brand-700 hover:underline">{p.fullName}</Link>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>ملف #{p.fileNumber}</span>
                      <span>{p.phone || "لا يوجد هاتف"}</span>
                      <span className="badge-neutral">{PATIENT_STATUS[p.status as keyof typeof PATIENT_STATUS]}</span>
                      {locked && <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-700">مؤرشف</span>}
                      {inactive && !locked && <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-700">تنبيه: غير نشط</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 sm:grid-cols-3">
                    <div className="rounded-lg bg-gray-50 px-3 py-2"><div className="text-gray-400">آخر زيارة</div><div className="font-medium text-gray-700">{lastVisit ? fmtDateTime(lastVisit.visitDate) : "—"}</div></div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2"><div className="text-gray-400">آخر موعد</div><div className="font-medium text-gray-700">{lastAppt ? fmtDate(lastAppt.scheduledAt) : "—"}</div></div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2"><div className="text-gray-400">اليوم</div><div className="font-medium text-gray-700">{todayVisit ? "حاضر" : hasQueue ? "بالطابور" : "لم يسجل"}</div></div>
                  </div>
                </div>

                {editable && !locked && (
                  <form action={receptionCheckIn} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="patientId" value={p.id} />
                    <input type="hidden" name="returnTo" value={`/visits?q=${encodeURIComponent(q)}`} />
                    <div className="min-w-[180px] flex-1">
                      <label className="label">ملاحظة الزيارة</label>
                      <input name="notes" className="input" placeholder="اختياري" />
                    </div>
                    <div className="min-w-[210px]">
                      <label className="label" htmlFor={`destination-${p.id}`}>الوجهة التالية</label>
                      <select id={`destination-${p.id}`} name="destination" className="input" defaultValue="">
                        <option value="">بدون تحويل</option>
                        {CENTER_STATIONS.map((station) => <option key={station.name} value={station.name}>{station.name}</option>)}
                      </select>
                    </div>
                    {canQueue && (
                      <>
                        <input type="hidden" name="sendQueue" value="1" />
                        <CenterHallSelect
                          centers={centers}
                          halls={centerHalls}
                          hallFieldName="hall"
                          hallValue="name"
                          requiredCenter
                          requiredHall
                          className="grid min-w-[420px] flex-[2] gap-2 md:grid-cols-2"
                        />
                        <button className="btn-primary" type="submit">تسجيل زيارة + إرسال للطابور</button>
                      </>
                    )}
                    {!canQueue && <button className="btn-primary" type="submit">تسجيل زيارة اليوم</button>}
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {q && matchedPatients.length === 0 && (
        <p className="text-sm text-gray-400">لا نتائج لـ «{q}».</p>
      )}

      {q && matchedPatients.map((p: any) => (
        <div key={p.id} className="card overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-700">
            <Link href={`/patients/${p.id}`} className="text-brand-700 hover:underline">{p.fullName}</Link>
            <span className="text-gray-400"> (#{p.fileNumber}) — {p.visits.length} زيارة</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">#</th><th className="th">التاريخ والوقت</th><th className="th">ملاحظات</th></tr></thead>
              <tbody>
                {p.visits.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={3}>لا توجد زيارات مسجّلة</td></tr>}
                {p.visits.map((v: any) => (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="td">{v.sequenceNo ?? "—"}</td>
                    <td className="td">{fmtDateTime(v.visitDate)}</td>
                    <td className="td">{v.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="card overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-700">حضور اليوم <span className="text-gray-400">({todayVisits.length})</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">رقم الملف</th><th className="th">ملاحظات</th></tr></thead>
            <tbody>
              {todayVisits.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={4}>لا يوجد حضور مسجّل اليوم بعد</td></tr>}
              {todayVisits.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="td">{fmtDateTime(v.visitDate)}</td>
                  <td className="td"><Link href={`/patients/${v.patientId}`} className="text-brand-700 hover:underline">{v.patient.fullName}</Link></td>
                  <td className="td">{v.patient.fileNumber}</td>
                  <td className="td">{v.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
