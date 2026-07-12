import Link from "next/link";
import { createPhysicalTherapyPlan } from "@/app/(app)/therapy/actions";
import { Combobox } from "@/components/Combobox";
import { fmtDate } from "@/lib/labels";

const DAYS = [[0,"الأحد"],[1,"الاثنين"],[2,"الثلاثاء"],[3,"الأربعاء"],[4,"الخميس"],[5,"الجمعة"],[6,"السبت"]] as const;

export function PatientTherapyProgram({ patientId, referrals, plans, therapists, halls, canManage, canFinalize }: any) {
  return <div className="space-y-5">
    {canManage ? <form action={createPhysicalTherapyPlan.bind(null, patientId)} className="card grid gap-3 p-4 md:grid-cols-2" autoComplete="off">
      <h2 className="text-lg font-bold md:col-span-2">إنشاء برنامج العلاج الطبيعي</h2>
      <label className="label">الإحالة الداخلية المقبولة<select name="referralRequestId" className="input mt-1" required><option value="">اختر الإحالة</option>{referrals.map((r:any)=><option key={r.id} value={r.id}>{r.requestedService}، {fmtDate(r.acceptedAt)}</option>)}</select></label>
      <label className="label">عنوان الخطة<input name="title" className="input mt-1" defaultValue="خطة العلاج الطبيعي" required /></label>
      <label className="label">نوع العلاج<select name="therapyType" className="input mt-1" defaultValue="PHYSICAL"><option value="PHYSICAL">علاج طبيعي</option><option value="OCCUPATIONAL">علاج وظيفي</option><option value="BLADDER">تأهيل المثانة</option></select></label>
      <label className="label">المعالج<select name="therapistId" className="input mt-1" required><option value="">اختر المعالج بعد مراجعة الحمل</option>{therapists.map((t:any)=><option key={t.id} value={t.id}>{t.fullName}، {t.activePlans} خطط، {t.todaySessions} جلسات اليوم</option>)}</select></label>
      <label className="label">القاعة<select name="hallId" className="input mt-1" required><option value="">اختر القاعة</option>{halls.map((h:any)=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <label className="label">عدد الجلسات<input name="plannedSessions" type="number" min="1" max="60" defaultValue="12" className="input mt-1" required /></label>
      <label className="label">تاريخ البداية<input name="startDate" type="date" className="input mt-1" required /></label>
      <label className="label">وقت الجلسة<input name="sessionTime" type="time" className="input mt-1" required /></label>
      <fieldset className="md:col-span-2"><legend className="label">أيام الجلسات</legend><div className="mt-2 flex flex-wrap gap-2">{DAYS.map(([value,label])=><label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"><input type="checkbox" name="weekdays" value={value} />{label}</label>)}</div></fieldset>
      <label className="label md:col-span-2">أهداف الخطة<textarea name="goals" className="input mt-1" rows={3} required /></label>
      <label className="label md:col-span-2">ملاحظات إدارية<textarea name="notes" className="input mt-1" rows={2} /></label>
      <div className="md:col-span-2"><button className="btn-primary">إنشاء الخطة وجدولة الجلسات</button></div>
    </form> : null}
    <section className="space-y-3"><h2 className="text-lg font-bold">برامج العلاج المرتبطة</h2>{plans.length === 0 ? <p className="text-sm text-gray-500">لا توجد خطة علاج مرتبطة بإحالة مقبولة.</p> : plans.map((plan:any)=><article key={plan.id} className="rounded-xl border border-gray-200 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{plan.title}</h3><p className="text-sm text-gray-600">{plan.therapist?.fullName || "معالج نصي قديم"}، {plan.hall?.name || "قاعة غير محددة"}</p></div><span className={plan.status === "COMPLETED" ? "badge-success" : "badge-info"}>{plan.status === "COMPLETED" ? "مغلقة" : "نشطة"}</span></div><dl className="mt-3 grid gap-2 text-sm md:grid-cols-4"><div><dt className="text-gray-500">الجلسات</dt><dd>{plan.sessions?.[0]?.actualSessions || 0} / {plan.plannedSessions || 0}</dd></div><div><dt className="text-gray-500">البداية</dt><dd>{fmtDate(plan.startDate)}</dd></div><div><dt className="text-gray-500">النهاية المتوقعة</dt><dd>{fmtDate(plan.expectedEndDate)}</dd></div><div><dt className="text-gray-500">الوقت</dt><dd>{plan.sessionTime || "—"}</dd></div></dl><p className="mt-3 whitespace-pre-wrap break-words text-sm">{plan.goals}</p>{canFinalize ? <Link href={`/therapy/plans/${plan.id}/final`} className="btn-ghost mt-3 inline-flex">فتح التقييم النهائي</Link> : null}</article>)}</section>
  </div>;
}
