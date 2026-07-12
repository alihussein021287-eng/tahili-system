import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/access";
import { centerActor } from "@/lib/center-access";
import { CENTER_SPACES, resolveCenter, SERVICE_LABELS } from "@/lib/center-workspaces";
import { recordCenterSession } from "../../actions";

export const dynamic = "force-dynamic";

export default async function CenterToday({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(slug in CENTER_SPACES)) notFound();
  const { config, center } = await resolveCenter(prisma, slug as keyof typeof CENTER_SPACES);
  if (!center) notFound();
  const actor = await centerActor(center.id, "centers.sessions.record");
  const session = await getSession();
  const start = new Date(); start.setHours(0,0,0,0); const end = new Date(start.getTime()+86400000);
  const rows = await prisma.centerSession.findMany({ where: { centerId: center.id, assignedToId: (session?.user as any).id, scheduledAt: { gte: start, lt: end } }, include: { patient: true, program: true, resource: true }, orderBy: { scheduledAt: "asc" } });
  const canSensitive = actor.permissions.has("centers.psych.sensitive");
  const time = new Intl.DateTimeFormat("ar-IQ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" });
  return <div className="space-y-5"><PageHeader title={`جلسات اليوم، ${config.title}`} subtitle="الجلسات المسندة إليك فقط" icon="🗓" />{rows.length === 0 ? <div className="card p-8 text-center text-gray-500">لا توجد جلسات مسندة إليك اليوم.</div> : rows.map((row)=><article key={row.id} className="card p-5"><div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-bold">{row.patient.fullName}</h2><p className="text-sm text-gray-600">{time.format(row.scheduledAt)}، {SERVICE_LABELS[row.program.serviceType]}، {row.resource?.name || "بلا مورد"}</p></div><span className="badge-info">{row.status}</span></div><form action={recordCenterSession.bind(null, center.id, row.id)} className="mt-4 grid gap-3 md:grid-cols-2" autoComplete="off"><label className="label">الحضور<select name="attended" className="input mt-1"><option value="1">حضر</option><option value="0">لم يحضر</option></select></label><label className="label">الحالة<select name="status" className="input mt-1"><option value="COMPLETED">مكتملة</option><option value="ATTENDED">حضور مسجل</option><option value="NO_SHOW">لم يحضر</option><option value="CANCELLED">ملغاة</option></select></label><label className="label">الإجراء<textarea name="procedure" className="input mt-1" rows={2} /></label><label className="label">النتيجة<textarea name="result" className="input mt-1" rows={2} /></label><label className="label">التقدم<textarea name="progress" className="input mt-1" rows={2} /></label><label className="label">الملاحظات<textarea name="notes" className="input mt-1" rows={2} /></label>{canSensitive && row.program.serviceType === "PSYCHOLOGICAL" ? <label className="label md:col-span-2">ملاحظات نفسية حساسة<textarea name="sensitiveNotes" className="input mt-1" rows={2} /></label> : null}<div className="md:col-span-2"><button className="btn-primary" disabled={row.status === "COMPLETED"}>{row.status === "COMPLETED" ? "الجلسة مكتملة" : "حفظ الجلسة"}</button></div></form></article>)}</div>;
}
