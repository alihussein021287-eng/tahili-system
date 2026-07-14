import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { getSession, requirePerm } from "@/lib/access";
import { finalizeTherapyPlan } from "../../../actions";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FinalEvaluation({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("therapy.plan.finalize");
  const { id } = await params;
  const plan = await prisma.treatmentPlan.findUnique({ where: { id }, include: { patient: true, therapist: true, specialistDoctor: true, sessions: true, followUpAppointment: true } });
  if (!plan) notFound();
  const session = await getSession();
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN" && (!plan.centerId || !(await prisma.centerMembership.findFirst({ where: { centerId: plan.centerId, userId: (session?.user as any)?.id, role: "HEAD_THERAPIST", status: "ACTIVE" } })))) notFound();
  const extensionInProgress = Boolean(plan.evaluatedAt && plan.status === "ACTIVE");
  return <div className="space-y-5"><PageHeader title="التقييم النهائي للعلاج الطبيعي" subtitle={`${plan.patient.fullName}، ${plan.title}، طبيب الاختصاص: ${plan.specialistDoctor?.fullName || "غير محدد"}`} icon="✓" /><form action={finalizeTherapyPlan.bind(null, id)} className="card grid gap-4 p-5 md:grid-cols-2" autoComplete="off"><label className="label">حالة المراجع قبل البرنامج<textarea name="beforeCondition" className="input mt-1" rows={4} defaultValue={plan.beforeCondition || ""} required /></label><label className="label">حالة المراجع بعد البرنامج<textarea name="afterCondition" className="input mt-1" rows={4} defaultValue={plan.afterCondition || ""} required /></label><label className="label">مستوى التحسن<input name="improvementLevel" className="input mt-1" defaultValue={plan.improvementLevel || ""} required /></label><label className="label">نسبة الشفاء أو التحسن<input name="finalRecoveryPercent" type="number" min="0" max="100" className="input mt-1" defaultValue={plan.finalRecoveryPercent ?? ""} required /></label><label className="label">القرار<select name="finalDecision" className="input mt-1" defaultValue={plan.finalDecision || "END"}><option value="END">إنهاء البرنامج والتحويل للاستشارية</option><option value="EXTEND">تمديد البرنامج</option></select></label><label className="label">عدد جلسات التمديد<input name="extensionSessions" type="number" min="1" max="30" defaultValue="6" className="input mt-1" /></label><label className="label md:col-span-2">الأهداف المحققة<textarea name="achievedGoals" className="input mt-1" rows={3} defaultValue={plan.achievedGoals || ""} required /></label><label className="label md:col-span-2">التوصية النهائية<textarea name="finalRecommendation" className="input mt-1" rows={3} defaultValue={plan.finalRecommendation || ""} required /></label>{plan.followUpAppointment ? <p className="md:col-span-2 text-sm text-gray-600">موعد الفحص القادم مرتبط بهذه المتابعة.</p> : null}<div className="md:col-span-2"><button className="btn-primary" disabled={extensionInProgress}>{extensionInProgress ? "برنامج التمديد قيد التنفيذ" : "حفظ التقييم النهائي"}</button></div></form></div>;
}
