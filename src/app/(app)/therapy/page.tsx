import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { getSession, requirePerm } from "@/lib/access";
import { fmtDate } from "@/lib/labels";
import { evaluationDue } from "@/lib/therapy-plan-rules";

export const dynamic = "force-dynamic";

export default async function TherapyDashboard() {
  await requirePerm("therapy.view");
  const session = await getSession();
  const userId = (session?.user as any)?.id as string;
  const role = (session?.user as any)?.role as string;
  const memberships = role === "ADMIN" ? [] : await prisma.centerMembership.findMany({ where: { userId, status: "ACTIVE" }, select: { centerId: true, role: true } });
  const managedCenterIds = memberships.filter((item) => item.role === "HEAD_THERAPIST").map((item) => item.centerId);
  const planWhere: any = role === "ADMIN" ? { referralRequestId: { not: null } } : role === "HEAD_THERAPIST" ? { centerId: { in: managedCenterIds } } : { therapistId: userId };
  const acceptedWhere: any = { status: "ACCEPTED", destinationScope: "INTERNAL_CENTER", treatmentPlan: null, ...(role === "ADMIN" ? {} : { destinationCenterId: { in: managedCenterIds } }) };
  const [accepted, plans, therapists] = await Promise.all([
    prisma.referralRequest.findMany({ where: acceptedWhere, include: { patient: true, destinationCenter: true }, orderBy: { acceptedAt: "asc" } }),
    prisma.treatmentPlan.findMany({ where: planWhere, include: { patient: true, center: true, therapist: true, specialistDoctor: true, hall: true, sessions: true, periodicEvaluations: { orderBy: { evaluatedAt: "asc" } }, _count: { select: { sessions: true } } }, orderBy: { createdAt: "desc" }, take: 80 }),
    prisma.user.findMany({ where: { role: "THERAPIST", isActive: true, ...(role === "ADMIN" ? {} : { centerMemberships: { some: { centerId: { in: managedCenterIds }, role: "THERAPIST", status: "ACTIVE" } } }) }, include: { centerMemberships: { where: { status: "ACTIVE", role: "THERAPIST" }, include: { center: true } }, _count: { select: { therapyPlansAssigned: { where: { status: "ACTIVE" } }, therapyAppointmentsAssigned: { where: { status: "SCHEDULED" } } } } }, orderBy: { fullName: "asc" } }),
  ]);
  const due = plans.filter((plan) => evaluationDue(plan));
  return <div className="space-y-5"><PageHeader title="لوحة رئيس المعالجين" subtitle="الإحالات والخطط والمواعيد ضمن مراكز عضويتك" icon="🏃"><Link href="/therapy-centers?tab=program" className="btn-ghost bg-white text-brand-700">لوحة المسار العلاجي والمراكز</Link><Link href="/therapy/today" className="btn-ghost bg-white text-brand-700">جلسات المعالج اليوم</Link></PageHeader>
    {due.length ? <section className="rounded-lg border border-amber-300 bg-amber-50 p-4"><h2 className="font-bold text-amber-900">تقييمات دورية مستحقة</h2><div className="mt-2 flex flex-wrap gap-2">{due.map((plan)=><Link key={plan.id} href={`/patients/${plan.patientId}`} className="rounded bg-white px-3 py-2 text-sm text-amber-900 hover:bg-amber-100">{plan.patient.fullName}، {plan.title}</Link>)}</div></section> : null}
    <div className="grid gap-3 md:grid-cols-3"><Summary label="إحالات تنتظر خطة" value={accepted.length} /><Summary label="خطط نشطة" value={plans.filter((p)=>p.status === "ACTIVE").length} /><Summary label="تقييمات مستحقة" value={due.length} /></div>
    <section className="card overflow-hidden"><h2 className="border-b p-4 font-bold">الإحالات الداخلية المقبولة</h2><div className="table-wrap"><table className="w-full text-sm"><thead><tr><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الخدمة</th><th className="th">تاريخ القبول</th></tr></thead><tbody>{accepted.map((r)=><tr key={r.id}><td className="td"><Link href={`/patients/${r.patientId}`} className="text-brand-700 hover:underline">{r.patient.fullName}</Link></td><td className="td">{r.destinationCenter?.name || "—"}</td><td className="td">{r.requestedService}</td><td className="td">{fmtDate(r.acceptedAt)}</td></tr>)}{accepted.length === 0 ? <tr><td colSpan={4} className="td text-center text-gray-500">لا توجد إحالات تنتظر خطة.</td></tr> : null}</tbody></table></div></section>
    <section className="card p-4"><h2 className="font-bold">الخطط والمواعيد</h2><div className="mt-3 space-y-2">{plans.map((plan)=><div key={plan.id} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-5"><Link href={`/patients/${plan.patientId}`} className="font-medium text-brand-700">{plan.patient.fullName}</Link><span>{plan.center?.name || "—"}</span><span>المعالج: {plan.therapist?.fullName || "—"}</span><span>الطبيب: {plan.specialistDoctor?.fullName || "—"}</span><span>{plan.plannedSessions || 0} جلسة حتى {fmtDate(plan.expectedEndDate)}</span></div>)}</div></section>
    <section className="card p-4"><h2 className="font-bold">حمل المعالجين قبل الإسناد</h2><div className="mt-3 grid gap-3 md:grid-cols-3">{therapists.map((therapist)=><div key={therapist.id} className="rounded-lg border p-3"><div className="font-medium">{therapist.fullName}</div><div className="text-xs text-gray-500">{therapist.centerMemberships.map((membership)=>membership.center.name).join("، ")}</div><div className="mt-1 text-sm text-gray-600">{therapist._count.therapyPlansAssigned} خطط نشطة، {therapist._count.therapyAppointmentsAssigned} مواعيد قادمة</div></div>)}</div><Link href="/workload" className="btn-ghost mt-3 inline-flex">فتح صفحة حمل المعالجين</Link></section>
  </div>;
}
function Summary({ label, value }: { label: string; value: number }) { return <div className="card p-4"><div className="text-2xl font-bold text-brand-700">{value}</div><div className="text-sm text-gray-600">{label}</div></div>; }
