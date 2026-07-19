import { requirePerm } from "@/lib/access";
import { Combobox } from "@/components/Combobox";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { THERAPY, APPT_STATUS, fmtTime } from "@/lib/labels";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const STATUS_CLR: Record<string, string> = {
  SCHEDULED: "bg-brand-50 text-brand-700 border-brand-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-gray-100 text-gray-400 border-gray-200 line-through",
  NOSHOW: "bg-red-50 text-red-700 border-red-200",
};
const DOT: Record<string, string> = { SCHEDULED: "bg-brand-500", COMPLETED: "bg-green-500", CANCELLED: "bg-gray-400", NOSHOW: "bg-red-500" };

function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const off = (x.getDay() + 1) % 7; // الرجوع إلى السبت
  x.setDate(x.getDate() - off);
  return x;
}

export default async function CalendarView({
  searchParams }: { searchParams: Promise<{ start?: string; who?: string; st?: string }> }) {
  await requirePerm("appointments.view");
  const sp = await searchParams;
  const base = sp.start ? new Date(sp.start + "T00:00:00") : new Date();
  const weekStart = startOfWeek(base);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  const prev = new Date(weekStart); prev.setDate(prev.getDate() - 7);
  const next = new Date(weekStart); next.setDate(next.getDate() + 7);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const where: any = { scheduledAt: { gte: weekStart, lt: weekEnd } };
  if (sp.who) where.assignedTo = sp.who;
  if (sp.st) where.status = sp.st;

  const [appts, whoList] = await Promise.all([
    prisma.appointment.findMany({ where, include: { patient: true, session: { select: { hall: true } } }, orderBy: { scheduledAt: "asc" } }),
    prisma.appointment.findMany({ where: { assignedTo: { not: null } }, select: { assignedTo: true }, distinct: ["assignedTo"] }),
  ]);

  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const byDay = (d: Date) => appts.filter((a) => new Date(a.scheduledAt).toDateString() === d.toDateString());
  const todayStr = new Date().toDateString();
  const qp = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.who) p.set("who", sp.who);
    if (sp.st) p.set("st", sp.st);
    for (const [k, v] of Object.entries(extra)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return `/appointments/calendar${s ? "?" + s : ""}`;
  };

  // إحصاء الأسبوع
  const cnt = { total: appts.length, SCHEDULED: 0, COMPLETED: 0, CANCELLED: 0, NOSHOW: 0 } as any;
  appts.forEach((a) => { cnt[a.status] = (cnt[a.status] || 0) + 1; });
  const lastDay = new Date(weekStart); lastDay.setDate(lastDay.getDate() + 6);
  const rangeLabel = `${weekStart.getDate()}/${weekStart.getMonth() + 1} — ${lastDay.getDate()}/${lastDay.getMonth() + 1}`;

  const StatBadge = ({ k, label }: any) => {
    const active = sp.st === k;
    return (
      <Link href={qp({ st: active ? "" : k })}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${active ? "border-brand-400 bg-brand-50 text-brand-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
        <span className={`h-2 w-2 rounded-full ${DOT[k]}`} />{label}: <b>{cnt[k] || 0}</b>
      </Link>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader title="تقويم المواعيد" subtitle={`عرض أسبوعي · ${rangeLabel}`} icon="🗓">
        <Link href="/patients-care?tab=appointments" className="btn-ghost bg-white text-brand-700">لوحة المرضى والرعاية</Link>
      </PageHeader>

      <div className="card space-y-3 p-3">
        {/* التنقّل + الفلاتر */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link href={qp({ start: iso(prev) })} className="btn-ghost">▶ السابق</Link>
            <Link href={qp({ start: "" })} className="btn-ghost">هذا الأسبوع</Link>
            <Link href={qp({ start: iso(next) })} className="btn-ghost">التالي ◀</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/appointments" className="btn-ghost">↩ قائمة المواعيد</Link>
            <form action="/appointments/calendar" className="flex items-center gap-2">
              <input type="hidden" name="start" value={iso(weekStart)} />
              {sp.st && <input type="hidden" name="st" value={sp.st} />}
<Combobox name="who" defaultValue={sp.who ?? ""} placeholder="كل المسؤولين" options={whoList.map((w:any)=>w.assignedTo).filter(Boolean)} />
              <button className="btn-primary !py-1.5" type="submit">تصفية</button>
            </form>
          </div>
        </div>

        {/* شريط الإحصاء + مفتاح الألوان (اضغط للتصفية) */}
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <span className="rounded-full bg-gray-800 px-3 py-1 text-xs font-medium text-white">إجمالي الأسبوع: {cnt.total}</span>
          <StatBadge k="SCHEDULED" label="مجدول" />
          <StatBadge k="COMPLETED" label="تم" />
          <StatBadge k="NOSHOW" label="لم يحضر" />
          <StatBadge k="CANCELLED" label="ملغى" />
          {(sp.st || sp.who) && <Link href={qp({ start: sp.start || "", who: "", st: "" }).replace(/who=[^&]*/, "")} className="text-xs text-gray-400 hover:underline">مسح الفلاتر</Link>}
        </div>
      </div>

      {/* الأيام */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((d) => {
          const list = byDay(d);
          const isToday = d.toDateString() === todayStr;
          return (
            <div key={d.toISOString()} className={`card p-2 ${isToday ? "ring-2 ring-brand-500" : ""}`}>
              <div className="mb-2 flex items-center justify-between border-b border-gray-100 pb-1.5">
                <div className="text-sm font-semibold text-gray-700">{DAY_NAMES[d.getDay()]}
                  <span className="mr-1 text-xs font-normal text-gray-400">{d.getDate()}/{d.getMonth() + 1}</span>
                </div>
                {list.length > 0 && <span className={`rounded-full px-2 text-[11px] font-bold ${isToday ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-500"}`}>{list.length}</span>}
                {isToday && list.length === 0 && <span className="rounded-full bg-brand-500 px-2 text-[10px] text-white">اليوم</span>}
              </div>
              <div className="space-y-1">
                {list.map((a) => (
                  <Link key={a.id} href={`/patients/${a.patientId}`}
                    className={`block rounded border p-1.5 text-xs ${STATUS_CLR[a.status] || "border-gray-200"}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold">{fmtTime(a.scheduledAt)}</span>
                      <span className="rounded bg-white/60 px-1 text-[9px]">{APPT_STATUS[a.status as keyof typeof APPT_STATUS]}</span>
                    </div>
                    <div className="mt-0.5 font-medium leading-tight">{a.patient.fullName}</div>
                    <div className="opacity-70">{a.therapyType ? THERAPY[a.therapyType as keyof typeof THERAPY] : (a.type || "")}{a.assignedTo ? ` — ${a.assignedTo}` : ""}{a.session?.hall ? ` — ${a.session.hall}` : ""}</div>
                  </Link>
                ))}
                {list.length === 0 && <div className="py-3 text-center text-xs text-gray-300">لا مواعيد</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
