import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { currentPerms, getSession, requirePerm } from "@/lib/access";
import { createAppointment, setAppointmentStatus, deleteAppointment, rescheduleAppointment } from "./actions";
import { THERAPY, APPT_STATUS, CONFIRM_STATUS, fmtDate, fmtTime } from "@/lib/labels";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";

export const dynamic = "force-dynamic";

const dayMs = 86400000;
const STATUS_OPTIONS = [
  { value: "", label: "كل الحالات" },
  { value: "SCHEDULED", label: APPT_STATUS.SCHEDULED },
  { value: "COMPLETED", label: APPT_STATUS.COMPLETED },
  { value: "NOSHOW", label: APPT_STATUS.NOSHOW },
  { value: "CANCELLED", label: APPT_STATUS.CANCELLED },
];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const off = (x.getDay() + 1) % 7;
  x.setDate(x.getDate() - off);
  return x;
}

export default async function Appointments({ searchParams }: { searchParams: Promise<{ range?: string; st?: string; who?: string; patient?: string; branch?: string; saved?: string }> }) {
  const session = await getSession();
  await requirePerm("appointments.view");
  const perms = await currentPerms();
  const userBranch = await currentUserBranch();
  const activeBranchId = effectiveBranchId((await searchParams).branch, userBranch?.branchId);
  const role = (session?.user as any)?.role as string;
  const userId = (session?.user as any)?.id as string;
  const cCreate = perms.has("appointments.create") && role !== "THERAPIST";
  const cEdit = perms.has("appointments.edit");
  const cDelete = perms.has("appointments.delete");

  const now = new Date();
  const sp = await searchParams;
  const startToday = new Date(now.toDateString());
  const tomorrow = new Date(startToday.getTime() + dayMs);
  const afterTomorrow = new Date(startToday.getTime() + 2 * dayMs);
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * dayMs);
  const range = sp.range || "upcoming";
  const rangeWhere =
    range === "today" ? { gte: startToday, lt: tomorrow } :
    range === "tomorrow" ? { gte: tomorrow, lt: afterTomorrow } :
    range === "week" ? { gte: weekStart, lt: weekEnd } :
    { gte: startToday };
  const patientNo = Number(sp.patient);
  const where: any = { scheduledAt: rangeWhere };
  if (role === "THERAPIST") where.assignedToId = userId;
  if (role === "HEAD_THERAPIST") {
    const centerIds = (await prisma.centerMembership.findMany({ where: { userId, role: "HEAD_THERAPIST", status: "ACTIVE" }, select: { centerId: true } })).map((membership) => membership.centerId);
    where.session = { centerId: { in: centerIds } };
  }
  if (sp.st) where.status = sp.st;
  else if (range === "upcoming") where.status = "SCHEDULED";
  if (sp.who) where.assignedTo = sp.who;
  if (sp.patient) {
    where.patient = Number.isNaN(patientNo)
      ? { fullName: { contains: sp.patient, mode: "insensitive" } }
      : { OR: [{ fileNumber: patientNo }, { fullName: { contains: sp.patient, mode: "insensitive" } }] };
  }
  if (activeBranchId) {
    const existingPatientWhere = where.patient;
    where.patient = existingPatientWhere ? { AND: [existingPatientWhere, { branchId: activeBranchId }] } : { branchId: activeBranchId };
  }

  const [appts, patients, whoList, branches] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: { patient: { include: { branch: true } }, session: { select: { hall: true } } }, orderBy: { scheduledAt: "asc" }, take: 200,
    }),
    prisma.patient.findMany({ where: activeBranchId ? { branchId: activeBranchId } : {}, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, fileNumber: true } }),
    prisma.appointment.findMany({ where: { assignedTo: { not: null } }, select: { assignedTo: true }, distinct: ["assignedTo"], orderBy: { assignedTo: "asc" } }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  // تجميع حسب اليوم
  const groups: Record<string, typeof appts> = {};
  for (const a of appts) {
    const key = new Date(a.scheduledAt).toDateString();
    (groups[key] ||= []).push(a);
  }
  const rangeLinks = [
    { value: "today", label: "اليوم" },
    { value: "tomorrow", label: "غداً" },
    { value: "week", label: "هذا الأسبوع" },
    { value: "upcoming", label: "القادمة" },
  ];
  const filterUrl = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.range) p.set("range", sp.range);
    if (sp.st) p.set("st", sp.st);
    if (sp.who) p.set("who", sp.who);
    if (sp.patient) p.set("patient", sp.patient);
    if (sp.branch) p.set("branch", sp.branch); else if (activeBranchId) p.set("branch", String(activeBranchId));
    Object.entries(extra).forEach(([k, v]) => v ? p.set(k, v) : p.delete(k));
    const s = p.toString();
    return `/appointments${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader title="المواعيد" subtitle="جدولة ومتابعة المواعيد" icon="📅" />
      {userBranch?.branch?.name && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800">
          {activeBranchId ? `المواعيد مفلترة افتراضياً حسب فرعك: ${userBranch.branch.name}` : "تعرض مواعيد كل الفروع حالياً"}
        </div>
      )}
      {sp.saved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{sp.saved}</div>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/appointments/calendar" className="btn-ghost">🗓 تقويم أسبوعي</Link>
      </div>

      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap gap-2">
          {rangeLinks.map((r) => (
            <Link key={r.value} href={filterUrl({ range: r.value })}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${range === r.value ? "border-brand-400 bg-brand-50 text-brand-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
              {r.label}
            </Link>
          ))}
        </div>
        <form action="/appointments" className="grid gap-2 md:grid-cols-4">
          <input type="hidden" name="range" value={range} />
          <Combobox name="st" label="الحالة" allowFree={false} defaultValue={sp.st ?? ""} options={STATUS_OPTIONS} />
          {branches.length > 0 && <Combobox name="branch" label="الفرع" allowFree={false} defaultValue={sp.branch ?? (activeBranchId ? String(activeBranchId) : "")} placeholder="كل الفروع"
            options={[{ value: "all", label: "كل الفروع" }, ...branches.map((b: any) => ({ value: String(b.id), label: b.name }))]} />}
          <Combobox name="who" label="المسؤول" defaultValue={sp.who ?? ""} placeholder="الكل"
            options={[{ value: "", label: "الكل" }, ...whoList.map((w: any) => ({ value: String(w.assignedTo), label: String(w.assignedTo) }))]} />
          <div>
            <label className="label">المراجع</label>
            <input name="patient" className="input" defaultValue={sp.patient ?? ""} placeholder="اسم أو رقم ملف" />
          </div>
          <div className="flex items-end gap-2">
            <button className="btn-primary" type="submit">تصفية</button>
            <Link href="/appointments" className="btn-ghost">مسح</Link>
          </div>
        </form>
      </div>

      {cCreate && (
        <form action={createAppointment} className="card grid gap-3 p-4 md:grid-cols-3">
          <div>
            <Combobox name="patientId" label="المريض" required allowFree={false}
              options={patients.map((p: any) => ({ value: String(p.id), label: `${p.fullName} (#${p.fileNumber})` }))} />
          </div>
          <div>
            <label className="label">وقت الموعد</label>
            <input name="scheduledAt" type="datetime-local" className="input" required />
          </div>
          <div>
            <Combobox name="therapyType" label="المسار العلاجي" allowFree={false}
              options={Object.entries(THERAPY).map(([value, label]: any) => ({ value, label }))} />
          </div>
          <Combobox name="type" label="نوع الموعد" options={["فحص", "متابعة", "جلسة", "مراجعة"]} />
          <input name="assignedTo" className="input" placeholder="المعالج/الطبيب" />
          <input name="notes" className="input" placeholder="ملاحظات" />
          <div className="md:col-span-3"><button className="btn-primary" type="submit">إضافة موعد</button></div>
        </form>
      )}

      {Object.keys(groups).length === 0 && <div className="card p-6 text-center text-gray-400">لا توجد مواعيد ضمن الفلاتر الحالية.</div>}

      {Object.entries(groups).map(([day, list]) => (
        <div key={day} className="card overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-5 py-2 font-semibold text-gray-700">{fmtDate(new Date(day))} <span className="text-gray-400">({list.length})</span></div>
          <div className="space-y-3 p-3 md:hidden">
            {list.map((a) => (
              <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-400">{fmtTime(a.scheduledAt)}</div>
                    <Link href={`/patients/${a.patientId}`} className="mt-1 block truncate font-semibold text-brand-700 hover:underline">{a.patient.fullName}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {(a as any).patientResponse && <span className={`badge ${(a as any).patientResponse === "CONFIRMED" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{CONFIRM_STATUS[(a as any).patientResponse as keyof typeof CONFIRM_STATUS]}</span>}
                      <span className={`badge ${a.status === "SCHEDULED" ? "bg-brand-50 text-brand-700" : a.status === "COMPLETED" ? "bg-green-50 text-green-700" : a.status === "NOSHOW" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{APPT_STATUS[a.status as keyof typeof APPT_STATUS]}</span>
                    </div>
                  </div>
                  <a href={`/appointments/${a.id}/qr`} target="_blank" className="shrink-0 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700">QR</a>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-gray-500">
                  <div><span className="text-gray-400">النوع:</span> {a.type || (a.therapyType ? THERAPY[a.therapyType as keyof typeof THERAPY] : "—")}</div>
                  <div><span className="text-gray-400">المسؤول:</span> {a.assignedTo || "—"}</div>
                  <div><span className="text-gray-400">الفرع:</span> {(a as any).patient.branch?.name ?? "بدون فرع"}</div>
                  {a.session?.hall && <div><span className="text-gray-400">القاعة:</span> {a.session.hall}</div>}
                </div>
                {(cEdit || cDelete) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                    {cEdit && a.patient.phone && (
                      <a target="_blank" className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700"
                        href={`https://wa.me/${String(a.patient.phone).replace(/\D/g, "").replace(/^0/, "964")}?text=${encodeURIComponent("تذكير: لديك موعد في المجمع التأهيلي يوم " + fmtDate(a.scheduledAt) + " الساعة " + fmtTime(a.scheduledAt))}`}>
                        واتساب
                      </a>
                    )}
                    {cEdit && <form action={setAppointmentStatus.bind(null, a.id, "COMPLETED")}><button className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white">تم</button></form>}
                    {cEdit && <form action={setAppointmentStatus.bind(null, a.id, "NOSHOW")}><button className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">لم يحضر</button></form>}
                    {cEdit && <form action={setAppointmentStatus.bind(null, a.id, "CANCELLED")}><button className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">إلغاء</button></form>}
                    {cDelete && <form action={deleteAppointment.bind(null, a.id)}><button className="rounded-lg px-2.5 py-1.5 text-xs text-red-600">حذف</button></form>}
                    {cEdit && <form action={rescheduleAppointment.bind(null, a.id)} className="grid w-full grid-cols-[1fr_auto] gap-2">
                      <input name="scheduledAt" type="datetime-local" className="input !py-1.5 text-xs" />
                      <button className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700">نقل</button>
                    </form>}
                  </div>
                )}
              </div>
            ))}
          </div>
          <table className="hidden w-full md:table">
            <thead><tr><th className="th">الوقت</th><th className="th">المريض</th><th className="th">النوع</th><th className="th">المسؤول</th><th className="th">الحالة</th><th className="th">إجراء</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="td font-medium">{fmtTime(a.scheduledAt)}</td>
                  <td className="td"><Link href={`/patients/${a.patientId}`} className="text-brand-700 hover:underline">{a.patient.fullName}</Link>{(a as any).patientResponse && <span className={`badge ms-1 ${(a as any).patientResponse === "CONFIRMED" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{CONFIRM_STATUS[(a as any).patientResponse as keyof typeof CONFIRM_STATUS]}</span>}</td>
                  <td className="td">
                    <div>{a.type || (a.therapyType ? THERAPY[a.therapyType as keyof typeof THERAPY] : "—")}</div>
                    {a.session?.hall && <div className="text-xs text-gray-400">القاعة: {a.session.hall}</div>}
                  </td>
                  <td className="td">{a.assignedTo || "—"}</td>
                  <td className="td"><span className={`badge ${a.status === "SCHEDULED" ? "bg-brand-50 text-brand-700" : a.status === "COMPLETED" ? "bg-green-50 text-green-700" : a.status === "NOSHOW" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{APPT_STATUS[a.status as keyof typeof APPT_STATUS]}</span></td>
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={`/appointments/${a.id}/qr`} target="_blank" className="text-xs font-medium text-brand-700 hover:underline">QR</a>
                      {(cEdit || cDelete) && (
                    <>
                      {cEdit && a.patient.phone && (
                        <a target="_blank" className="text-xs text-emerald-700 hover:underline"
                          href={`https://wa.me/${String(a.patient.phone).replace(/\D/g, "").replace(/^0/, "964")}?text=${encodeURIComponent("تذكير: لديك موعد في المجمع التأهيلي يوم " + fmtDate(a.scheduledAt) + " الساعة " + fmtTime(a.scheduledAt))}`}>
                          تذكير واتساب
                        </a>
                      )}
                      {cEdit && <form action={setAppointmentStatus.bind(null, a.id, "COMPLETED")}><button className="text-xs text-emerald-600 hover:underline">تم</button></form>}
                      {cEdit && <form action={setAppointmentStatus.bind(null, a.id, "NOSHOW")}><button className="text-xs text-amber-600 hover:underline">لم يحضر</button></form>}
                      {cEdit && <form action={setAppointmentStatus.bind(null, a.id, "CANCELLED")}><button className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline">إلغاء</button></form>}
                      {cEdit && <form action={rescheduleAppointment.bind(null, a.id)} className="flex items-center gap-1">
                        <input name="scheduledAt" type="datetime-local" className="input !w-44 !py-0.5 text-xs" />
                        <button className="text-xs text-brand-700 hover:underline">نقل</button>
                      </form>}
                      {cDelete && <form action={deleteAppointment.bind(null, a.id)}><button className="text-xs text-gray-400 hover:text-red-600">حذف</button></form>}
                    </>
                  )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
