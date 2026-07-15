import Link from "next/link";
import { addPeriodicTherapyEvaluation, createPhysicalTherapyPlan, updatePhysicalTherapyPlan } from "@/app/(app)/therapy/actions";
import { fmtDate, fmtDateTime } from "@/lib/labels";

const DAYS = [[0,"الأحد"],[1,"الاثنين"],[2,"الثلاثاء"],[3,"الأربعاء"],[4,"الخميس"],[5,"الجمعة"],[6,"السبت"]] as const;
const DECISIONS: Record<string, string> = { CONTINUE: "الاستمرار", MODIFY: "تعديل الخطة", REFER: "الإحالة إلى طبيب الاختصاص" };

function PlanFields({ doctors, plan, defaults }: any) {
  const mode = plan?.reviewEveryDays ? "DAYS" : "SESSIONS";
  return <>
    <label className="label">طبيب الاختصاص<select name="specialistDoctorId" className="input mt-1" defaultValue={plan?.specialistDoctorId || ""} required><option value="">اختر طبيب الاختصاص</option>{doctors.map((doctor:any)=><option key={doctor.id} value={doctor.id}>{doctor.fullName}</option>)}</select></label>
    <label className="label">عدد أيام العلاج<input name="treatmentDays" type="number" min="1" max="365" defaultValue={plan?.treatmentDays || defaults?.defaultPlanDays || 30} className="input mt-1" required /></label>
    <label className="label">دورية التقييم<select name="reviewMode" className="input mt-1" defaultValue={mode}><option value="SESSIONS">بعد عدد من الجلسات</option><option value="DAYS">بعد عدد من الأيام</option></select></label>
    <label className="label">قيمة الدورية<input name="reviewInterval" type="number" min="1" max="365" defaultValue={plan?.reviewEveryDays || plan?.reviewEverySessions || defaults?.evaluationEvery || 5} className="input mt-1" required /></label>
  </>;
}

export function PatientTherapyProgram({ patientId, referrals, plans, therapists, doctors, halls, defaults, canManage, canFinalize }: any) {
  const defaultWorkDays = new Set((defaults?.workDays || ["0", "1", "2", "3", "4"]).map(String));
  return <div className="min-w-0 space-y-5">
    {canManage ? <form action={createPhysicalTherapyPlan.bind(null, patientId)} className="grid gap-3 rounded-lg border border-gray-200 p-4 md:grid-cols-2" autoComplete="off">
      <h2 className="text-lg font-bold md:col-span-2">إنشاء برنامج العلاج الطبيعي</h2>
      <label className="label">الإحالة الداخلية المقبولة<select name="referralRequestId" className="input mt-1" required><option value="">اختر الإحالة</option>{referrals.map((r:any)=><option key={r.id} value={r.id}>{r.requestedService}، {fmtDate(r.acceptedAt)}</option>)}</select></label>
      <label className="label">عنوان الخطة<input name="title" className="input mt-1" defaultValue="خطة العلاج الطبيعي" required /></label>
      <label className="label">نوع العلاج<select name="therapyType" className="input mt-1" defaultValue="PHYSICAL"><option value="PHYSICAL">علاج طبيعي</option><option value="OCCUPATIONAL">علاج وظيفي</option><option value="BLADDER">تأهيل المثانة</option></select></label>
      <label className="label">المعالج<select name="therapistId" className="input mt-1" required><option value="">اختر المعالج بعد مراجعة الحمل</option>{therapists.map((t:any)=><option key={t.id} value={t.id}>{t.fullName}، {t.activePlans} خطط، {t.todaySessions} جلسات اليوم</option>)}</select></label>
      <PlanFields doctors={doctors} defaults={defaults} />
      <label className="label">القاعة<select name="hallId" className="input mt-1" required><option value="">اختر القاعة</option>{halls.map((h:any)=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <label className="label">عدد الجلسات<input name="plannedSessions" type="number" min="1" max="60" defaultValue={defaults?.defaultSessions || 12} className="input mt-1" required /></label>
      <label className="label">تاريخ البداية<input name="startDate" type="date" className="input mt-1" required /></label>
      <label className="label">وقت الجلسة<input name="sessionTime" type="time" defaultValue={defaults?.workStart || "10:00"} className="input mt-1" required /></label>
      <fieldset className="md:col-span-2"><legend className="label">أيام الجلسات</legend><div className="mt-2 flex flex-wrap gap-2">{DAYS.map(([value,label])=><label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"><input type="checkbox" name="weekdays" value={value} defaultChecked={defaultWorkDays.has(String(value))} />{label}</label>)}</div></fieldset>
      <label className="label md:col-span-2">أهداف الخطة<textarea name="goals" className="input mt-1" rows={3} required /></label>
      <label className="label md:col-span-2">ملاحظات إدارية<textarea name="notes" className="input mt-1" rows={2} /></label>
      <div className="md:col-span-2"><button className="btn-primary">إنشاء الخطة وجدولة الجلسات</button></div>
    </form> : null}
    <section className="space-y-4"><h2 className="text-lg font-bold">برامج العلاج المرتبطة</h2>{plans.length === 0 ? <p className="text-sm text-gray-500">لا توجد خطة علاج مرتبطة بإحالة مقبولة.</p> : plans.map((plan:any)=><PlanCard key={plan.id} plan={plan} doctors={doctors} defaults={defaults} canManage={canManage} canFinalize={canFinalize} />)}</section>
  </div>;
}

function PlanCard({ plan, doctors, defaults, canManage, canFinalize }: any) {
  const appointments = plan.sessions?.flatMap((session:any)=>session.appointments || []) || [];
  const evaluations = plan.periodicEvaluations || [];
  const recoveryPoints = plan.finalRecoveryPercent == null ? evaluations : [...evaluations, { id: `${plan.id}-final`, recoveryPercent: plan.finalRecoveryPercent, evaluatedAt: plan.evaluatedAt || plan.closedAt || plan.createdAt, final: true }];
  return <article className="min-w-0 rounded-lg border border-gray-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{plan.title}</h3><p className="text-sm text-gray-600">{plan.center?.name || "مركز قديم غير محدد"}، {plan.therapist?.fullName || "معالج نصي قديم"}، {plan.hall?.name || "قاعة غير محددة"}</p><p className="text-sm text-gray-600">طبيب الاختصاص: {plan.specialistDoctor?.fullName || "غير محدد"}، أنشأها: {plan.createdBy?.fullName || "سجل قديم"}</p></div><span className={plan.status === "COMPLETED" ? "badge-success" : "badge-info"}>{plan.status === "COMPLETED" ? "مغلقة" : "نشطة"}</span></div>
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5"><Info label="الجلسات" value={`${plan.sessions?.[0]?.actualSessions || 0} / ${plan.plannedSessions || 0}`} /><Info label="مدة العلاج" value={`${plan.treatmentDays || "—"} يوم`} /><Info label="البداية" value={fmtDate(plan.startDate)} /><Info label="النهاية المتوقعة" value={fmtDate(plan.expectedEndDate)} /><Info label="دورية التقييم" value={plan.reviewEveryDays ? `كل ${plan.reviewEveryDays} يوم` : plan.reviewEverySessions ? `كل ${plan.reviewEverySessions} جلسات` : "—"} /></dl>
    {canManage ? <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-brand-700">تعديل الطبيب والمدة والدورية</summary><form action={updatePhysicalTherapyPlan.bind(null, plan.id)} className="mt-3 grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-2"><PlanFields doctors={doctors} plan={plan} defaults={defaults} /><div className="md:col-span-2"><button className="btn-primary">حفظ تعديل الخطة</button></div></form></details> : null}
    <details className="mt-4"><summary className="cursor-pointer font-medium text-gray-700">جدول المواعيد ({appointments.length})</summary><div className="table-wrap mt-2"><table className="w-full text-sm"><thead><tr><th className="th">التاريخ والوقت</th><th className="th">المعالج</th><th className="th">الحالة</th></tr></thead><tbody>{appointments.map((appointment:any)=><tr key={appointment.id}><td className="td">{fmtDateTime(appointment.scheduledAt)}</td><td className="td">{appointment.assignedTo || plan.therapist?.fullName}</td><td className="td">{appointment.status}</td></tr>)}</tbody></table></div></details>
    <section className="mt-5 border-t pt-4"><h4 className="font-bold">التقييمات الدورية</h4>
      {canManage ? <form action={addPeriodicTherapyEvaluation.bind(null, plan.id)} className="mt-3 grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-2"><label className="label">تاريخ التقييم<input name="evaluatedAt" type="date" className="input mt-1" /></label><label className="label">نسبة الشفاء أو التحسن<input name="recoveryPercent" type="number" min="0" max="100" className="input mt-1" required /></label><label className="label">حالة المراجع الحالية<textarea name="currentCondition" className="input mt-1" required /></label><label className="label">التقدم المحقق<textarea name="achievedProgress" className="input mt-1" required /></label><label className="label">المشاكل أو المعوقات<textarea name="obstacles" className="input mt-1" /></label><label className="label">التوصيات<textarea name="recommendations" className="input mt-1" /></label><label className="label">القرار<select name="decision" className="input mt-1"><option value="CONTINUE">الاستمرار</option><option value="MODIFY">تعديل الخطة</option><option value="REFER">الإحالة إلى طبيب الاختصاص</option></select></label><div className="self-end"><button className="btn-primary">حفظ التقييم الدوري</button></div></form> : null}
      {recoveryPoints.length ? <div className="mt-4"><div className="flex h-32 items-end gap-3 rounded-lg border border-gray-100 p-3" aria-label="تطور نسبة الشفاء">{recoveryPoints.map((evaluation:any)=><div key={evaluation.id} className="flex h-full min-w-12 flex-1 flex-col justify-end text-center"><span className="text-xs font-bold text-brand-700">{evaluation.recoveryPercent}%</span><div className={`mx-auto w-full max-w-14 rounded-t ${evaluation.final ? "bg-emerald-500" : "bg-brand-500"}`} style={{height:`${Math.max(4,evaluation.recoveryPercent)}%`}} /><span className="mt-1 text-[10px] text-gray-500">{evaluation.final ? "نهائي" : fmtDate(evaluation.evaluatedAt)}</span></div>)}</div><div className="mt-3 space-y-2">{evaluations.map((evaluation:any)=><div key={evaluation.id} className="rounded-lg border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><b>{evaluation.recoveryPercent}%، {DECISIONS[evaluation.decision] || evaluation.decision}</b><span className="text-gray-500">{fmtDate(evaluation.evaluatedAt)}، {evaluation.evaluatedBy?.fullName}</span></div><p className="mt-1">{evaluation.currentCondition}</p><p className="text-gray-600">التقدم: {evaluation.achievedProgress}</p>{evaluation.obstacles ? <p className="text-gray-600">المعوقات: {evaluation.obstacles}</p> : null}{evaluation.recommendations ? <p className="text-gray-600">التوصيات: {evaluation.recommendations}</p> : null}</div>)}</div></div> : <p className="mt-3 text-sm text-gray-500">لا توجد تقييمات دورية بعد.</p>}
    </section>
    {canFinalize ? <Link href={`/therapy/plans/${plan.id}/final`} className="btn-ghost mt-4 inline-flex">فتح التقييم النهائي</Link> : null}
  </article>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-gray-500">{label}</dt><dd>{value}</dd></div>; }
