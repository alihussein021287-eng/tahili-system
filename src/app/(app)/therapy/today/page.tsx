import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { getSession, requirePerm } from "@/lib/access";
import { recordTherapyAppointment } from "../actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TherapistToday() {
  await requirePerm("therapy.session.record");
  const session = await getSession();
  const userId = (session?.user as any)?.id;
  const start = new Date(); start.setHours(0,0,0,0);
  const end = new Date(start.getTime() + 86400000);
  const appointments = await prisma.appointment.findMany({ where: { assignedToId: userId, scheduledAt: { gte: start, lt: end }, session: { treatmentPlanId: { not: null } } }, include: { patient: true, session: { include: { plan: true, therapyHall: true } }, therapySessionLogs: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { scheduledAt: "asc" } });
  const time = new Intl.DateTimeFormat("ar-IQ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" });
  return <div className="space-y-5"><PageHeader title="جلسات المعالج اليومية" subtitle="سجّل نتيجة الجلسات المسندة إليك فقط" icon="🗓" />{appointments.length === 0 ? <div className="card p-8 text-center text-gray-500">لا توجد جلسات مسندة إليك اليوم.</div> : appointments.map((appointment)=><article key={appointment.id} className="card p-4"><div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-bold"><Link href={`/patients/${appointment.patientId}`} className="text-brand-700 hover:underline">{appointment.patient.fullName}</Link></h2><p className="text-sm text-gray-600">{time.format(appointment.scheduledAt)}، {appointment.session?.therapyHall?.name || appointment.session?.hall || "قاعة غير محددة"}</p></div><span className={appointment.status === "COMPLETED" ? "badge-success" : "badge-info"}>{appointment.status === "COMPLETED" ? "مكتملة" : "مجدولة"}</span></div><form action={recordTherapyAppointment.bind(null, appointment.id)} className="mt-4 grid gap-3 md:grid-cols-2" autoComplete="off"><label className="label">الحضور<select name="attended" className="input mt-1" defaultValue={appointment.therapySessionLogs[0]?.attended === false ? "0" : "1"}><option value="1">حضر</option><option value="0">لم يحضر</option></select></label><label className="label">حالة الجلسة<select name="status" className="input mt-1" defaultValue={appointment.therapySessionLogs[0]?.status || "COMPLETED"}><option value="ATTENDED">حضور مسجل</option><option value="COMPLETED">مكتملة</option><option value="NO_SHOW">لم يحضر</option><option value="CANCELLED">ملغاة</option></select></label><label className="label">الإجراءات المتخذة<textarea name="exercises" className="input mt-1" rows={2} defaultValue={appointment.therapySessionLogs[0]?.exercises || ""} /></label><label className="label">استجابة المراجع<textarea name="response" className="input mt-1" rows={2} defaultValue={appointment.therapySessionLogs[0]?.response || ""} /></label><label className="label">التقدم<textarea name="progress" className="input mt-1" rows={2} defaultValue={appointment.therapySessionLogs[0]?.progress || ""} /></label><label className="label">الملاحظات<textarea name="notes" className="input mt-1" rows={2} defaultValue={appointment.therapySessionLogs[0]?.notes || ""} /></label><div className="md:col-span-2"><button className="btn-primary" disabled={appointment.status === "COMPLETED"}>{appointment.status === "COMPLETED" ? "الجلسة مكتملة" : "حفظ نتيجة الجلسة"}</button></div></form></article>)}</div>;
}
