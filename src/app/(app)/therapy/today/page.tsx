import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, getSession } from "@/lib/access";
import { recordTherapyAppointment, rescheduleTherapyAppointment } from "../actions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HubTabs } from "@/components/hub/HubTabs";
import { CenterSessionTable } from "@/components/therapy/TherapyTables";
import { accessibleCenterIds } from "@/lib/center-access";
import { baghdadDayRange } from "@/lib/display-utils";
import { THERAPY_CENTERS_NAV } from "@/lib/hub-nav";

export const dynamic = "force-dynamic";

export default async function TherapistToday() {
  const session = await getSession();
  if (!session) redirect("/login");
  const perms = await currentPerms();
  const canTherapy = perms.has("therapy.session.record");
  const canCenters = perms.has("centers.sessions.record") || perms.has("centers.view");
  if (!canTherapy && !perms.has("centers.sessions.record")) redirect("/");
  const userId = (session?.user as any)?.id;
  const { start, end } = baghdadDayRange(new Date());
  const centerIds = canCenters ? await accessibleCenterIds() : null;
  const centerSessions = canCenters ? await prisma.centerSession.findMany({
    where: { scheduledAt: { gte: start, lt: end }, ...(centerIds ? { centerId: { in: centerIds } } : {}), ...(perms.has("centers.central.view") ? {} : { assignedToId: userId }) },
    include: { center: true, patient: { select: { id: true, fullName: true, fileNumber: true } }, program: true, resource: true, assignedTo: { select: { fullName: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 100,
  }) : [];
  const appointments = !canTherapy ? [] : await prisma.appointment.findMany({ where: { assignedToId: userId, scheduledAt: { gte: start, lt: end }, session: { treatmentPlanId: { not: null } } }, include: { patient: true, session: { include: { plan: true, therapyHall: true } }, therapySessionLogs: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { scheduledAt: "asc" } });
  const time = new Intl.DateTimeFormat("ar-IQ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" });
  return <div className="space-y-5"><PageHeader title="جلسات المعالج اليومية" subtitle="سجّل نتيجة الجلسات المسندة إليك فقط" icon="🗓" /><HubTabs nav={THERAPY_CENTERS_NAV} active="today" label="تبويبات المسار العلاجي والمراكز" perms={perms} />{canCenters ? <section className="card p-4"><h2 className="mb-3 font-bold">جلسات المراكز اليوم ({centerSessions.length})</h2><CenterSessionTable rows={centerSessions as any[]} /></section> : null}{!canTherapy ? null : appointments.length === 0 ? <div className="card p-8 text-center text-gray-500">لا توجد جلسات مسندة إليك اليوم.</div> : appointments.map((appointment)=><article key={appointment.id} className="card p-4"><div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-bold"><Link href={`/patients/${appointment.patientId}`} className="text-brand-700 hover:underline">{appointment.patient.fullName}</Link></h2><p className="text-sm text-gray-600">{time.format(appointment.scheduledAt)}، {appointment.session?.therapyHall?.name || appointment.session?.hall || "قاعة غير محددة"}{appointment.type ? <span className="mr-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{appointment.type}</span> : null}</p></div><span className={appointment.status === "COMPLETED" ? "badge-success" : "badge-info"}>{appointment.status === "COMPLETED" ? "مكتملة" : "مجدولة"}</span></div><form action={recordTherapyAppointment.bind(null, appointment.id)} className="mt-4 grid gap-3 md:grid-cols-2" autoComplete="off"><label className="label">الحضور<select name="attended" className="input mt-1" defaultValue={appointment.therapySessionLogs[0]?.attended === false ? "0" : "1"}><option value="1">حضر</option><option value="0">لم يحضر</option></select></label><label className="label">حالة الجلسة<select name="status" className="input mt-1" defaultValue={appointment.therapySessionLogs[0]?.status || "COMPLETED"}><option value="ATTENDED">حضور مسجل</option><option value="COMPLETED">مكتملة</option><option value="NO_SHOW">لم يحضر</option><option value="CANCELLED">ملغاة</option></select></label><label className="label">الإجراءات المتخذة<textarea name="exercises" className="input mt-1" rows={2} defaultValue={appointment.therapySessionLogs[0]?.exercises || ""} /></label><label className="label">استجابة المراجع<textarea name="response" className="input mt-1" rows={2} defaultValue={appointment.therapySessionLogs[0]?.response || ""} /></label><label className="label">التقدم<textarea name="progress" className="input mt-1" rows={2} defaultValue={appointment.therapySessionLogs[0]?.progress || ""} /></label><label className="label">الملاحظات<textarea name="notes" className="input mt-1" rows={2} defaultValue={appointment.therapySessionLogs[0]?.notes || ""} /></label><div className="md:col-span-2"><button className="btn-primary" disabled={appointment.status === "COMPLETED"}>{appointment.status === "COMPLETED" ? "الجلسة مكتملة" : "حفظ نتيجة الجلسة"}</button></div></form>{appointment.status !== "COMPLETED" ? <details className="mt-3 border-t border-gray-100 pt-3"><summary className="cursor-pointer text-sm font-medium text-brand-700">نقل الموعد ليوم أو وقت ثاني</summary><form action={rescheduleTherapyAppointment.bind(null, appointment.id)} className="mt-2 flex flex-wrap items-end gap-2" autoComplete="off"><label className="label">الموعد الجديد<input name="scheduledAt" type="datetime-local" className="input mt-1" required /></label><label className="label min-w-[200px] flex-1">السبب<input name="reason" className="input mt-1" placeholder="مثال: المراجع طلب يوم ثاني" /></label><button className="btn-ghost">نقل الموعد</button></form></details> : null}</article>)}</div>;
}
