import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms } from "@/lib/access";
import { centerActor } from "@/lib/center-access";
import { CENTER_SPACES, resolveCenter, SERVICE_LABELS } from "@/lib/center-workspaces";
import { finalizeCenterProgram, scheduleCenterSession } from "../../../actions";
import { fmtDateTime } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ProgramPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!(slug in CENTER_SPACES)) notFound();
  const { config, center } = await resolveCenter(prisma, slug as keyof typeof CENTER_SPACES); if (!center) notFound();
  await centerActor(center.id); const perms = await currentPerms();
  const [program, resources] = await Promise.all([
    prisma.centerProgram.findFirst({
      where: { id, centerId: center.id },
      include: { patient: true, assignedTo: true, assessments: { orderBy: { createdAt: "desc" } }, sessions: { include: { resource: true, assignedTo: true }, orderBy: { scheduledAt: "asc" } } },
    }),
    prisma.centerResource.findMany({ where: { centerId: center.id, status: "AVAILABLE" }, orderBy: { name: "asc" } }),
  ]);
  if (!program) notFound(); const canSensitive = perms.has("centers.psych.sensitive");
  return <div className="space-y-5"><PageHeader title={`${SERVICE_LABELS[program.serviceType]}، ${program.patient.fullName}`} subtitle={config.title} icon="📋"><Link href="/therapy-centers?tab=centers" className="btn-ghost bg-white text-brand-700">لوحة المسار العلاجي والمراكز</Link></PageHeader><section className="card grid gap-3 p-5 md:grid-cols-3"><Info label="المسؤول" value={program.assignedTo?.fullName || "غير مسند"} /><Info label="المسار" value={program.track || "عام"} /><Info label="النمط" value={program.mode === "GROUP" ? "جماعي" : "فردي"} /><div className="md:col-span-3"><Info label="الأهداف والخطة" value={[program.goals,program.protocol].filter(Boolean).join("\n") || "غير مثبتة"} /></div></section>{perms.has("centers.programs.manage") && program.status === "ACTIVE" ? <form action={scheduleCenterSession.bind(null, center.id, program.id)} className="card grid gap-3 p-5 md:grid-cols-3" autoComplete="off"><h2 className="font-bold md:col-span-3">جدولة جلسة</h2><label className="label">الموعد<input name="scheduledAt" type="datetime-local" className="input mt-1" required /></label><label className="label">المدة بالدقائق<input name="durationMinutes" type="number" min="15" max="240" defaultValue="60" className="input mt-1" /></label><label className="label">المورد<select name="resourceId" className="input mt-1"><option value="">بلا مورد</option>{resources.filter((r)=>!r.serviceType||r.serviceType===program.serviceType).map((r)=><option key={r.id} value={r.id}>{r.name}، سعة {r.capacity}</option>)}</select></label><div className="md:col-span-3"><button className="btn-primary">حجز الجلسة والموعد</button></div></form> : null}<section className="card overflow-hidden"><h2 className="border-b p-4 font-bold">جلسات البرنامج</h2><table className="w-full text-sm"><thead><tr><th className="th">الموعد</th><th className="th">المورد</th><th className="th">الحالة</th><th className="th">التقدم</th></tr></thead><tbody>{program.sessions.map((s)=><tr key={s.id}><td className="td">{fmtDateTime(s.scheduledAt)}</td><td className="td">{s.resource?.name || "—"}</td><td className="td">{s.status}</td><td className="td">{s.progress || "—"}</td></tr>)}</tbody></table></section><section className="card p-5"><h2 className="font-bold">التقييمات</h2><div className="mt-3 space-y-3">{program.assessments.map((a)=><article key={a.id} className="rounded-lg border p-3"><div className="font-medium">{a.kind === "FINAL" ? "تقييم ختامي" : "تقييم أولي"}</div><p className="mt-1 whitespace-pre-wrap break-words text-sm">{a.summary || a.functionalCapacity}</p>{canSensitive && a.sensitiveNotes ? <p className="mt-2 rounded bg-purple-50 p-2 text-sm text-purple-900">{a.sensitiveNotes}</p> : null}</article>)}</div></section>{perms.has("centers.programs.finalize") && program.status !== "COMPLETED" ? <form action={finalizeCenterProgram.bind(null, center.id, program.id)} className="card grid gap-3 p-5 md:grid-cols-2" autoComplete="off"><h2 className="font-bold md:col-span-2">التقييم النهائي</h2><label className="label md:col-span-2">ملخص نهاية البرنامج<textarea name="finalSummary" className="input mt-1" rows={3} required /></label><label className="label">مستوى التحسن<input name="improvementLevel" className="input mt-1" required /></label><label className="label">التوصية<input name="recommendation" className="input mt-1" required /></label>{canSensitive && program.serviceType === "PSYCHOLOGICAL" ? <label className="label md:col-span-2">ملاحظات نفسية حساسة<textarea name="sensitiveNotes" className="input mt-1" rows={2} /></label> : null}<label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="returnToConsultancy" value="1" />إعادة المراجع إلى الاستشارية</label><div className="md:col-span-2"><button className="btn-primary">إغلاق البرنامج وإصدار التقييم</button></div></form> : null}</div>;
}
function Info({label,value}:{label:string;value:string}) { return <div><div className="text-xs text-gray-500">{label}</div><div className="mt-1 whitespace-pre-wrap break-words font-medium">{value}</div></div>; }
