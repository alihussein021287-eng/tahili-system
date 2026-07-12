import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm } from "@/lib/access";
import { fmtDate } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function TherapyDashboard() {
  await requirePerm("therapy.view");
  const [accepted, plans, therapists] = await Promise.all([
    prisma.referralRequest.findMany({ where: { status: "ACCEPTED", destinationScope: "INTERNAL_CENTER", treatmentPlan: null }, include: { patient: true, destinationCenter: true }, orderBy: { acceptedAt: "asc" } }),
    prisma.treatmentPlan.findMany({ where: { referralRequestId: { not: null } }, include: { patient: true, therapist: true, hall: true, sessions: true }, orderBy: { createdAt: "desc" }, take: 80 }),
    prisma.user.findMany({ where: { role: "THERAPIST", isActive: true }, include: { _count: { select: { therapyPlansAssigned: { where: { status: "ACTIVE" } }, therapyAppointmentsAssigned: { where: { status: "SCHEDULED" } } } } }, orderBy: { fullName: "asc" } }),
  ]);
  return <div className="space-y-5"><PageHeader title="لوحة رئيس المعالجين" subtitle="الإحالات المقبولة والخطط والتوزيع" icon="🏃"><Link href="/therapy/today" className="btn-ghost bg-white text-brand-700">جلسات المعالج اليوم</Link></PageHeader><div className="grid gap-3 md:grid-cols-3"><Summary label="إحالات تنتظر خطة" value={accepted.length} /><Summary label="خطط نشطة" value={plans.filter((p)=>p.status === "ACTIVE").length} /><Summary label="معالجون متاحون" value={therapists.length} /></div><section className="card overflow-hidden"><h2 className="border-b p-4 font-bold">الإحالات الداخلية المقبولة</h2><table className="w-full text-sm"><thead><tr><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الخدمة</th><th className="th">تاريخ القبول</th></tr></thead><tbody>{accepted.map((r)=><tr key={r.id}><td className="td"><Link href={`/patients/${r.patientId}`} className="text-brand-700 hover:underline">{r.patient.fullName}</Link></td><td className="td">{r.destinationCenter?.name || "—"}</td><td className="td">{r.requestedService}</td><td className="td">{fmtDate(r.acceptedAt)}</td></tr>)}{accepted.length === 0 ? <tr><td colSpan={4} className="td text-center text-gray-500">لا توجد إحالات تنتظر خطة.</td></tr> : null}</tbody></table></section><section className="card p-4"><h2 className="font-bold">حمل المعالجين قبل الإسناد</h2><div className="mt-3 grid gap-3 md:grid-cols-3">{therapists.map((t)=><div key={t.id} className="rounded-xl border p-3"><div className="font-medium">{t.fullName}</div><div className="mt-1 text-sm text-gray-600">{t._count.therapyPlansAssigned} خطط نشطة، {t._count.therapyAppointmentsAssigned} مواعيد قادمة</div></div>)}</div><Link href="/workload" className="btn-ghost mt-3 inline-flex">فتح صفحة حمل المعالجين</Link></section></div>;
}
function Summary({ label, value }: { label: string; value: number }) { return <div className="card p-4"><div className="text-2xl font-bold text-brand-700">{value}</div><div className="text-sm text-gray-600">{label}</div></div>; }
