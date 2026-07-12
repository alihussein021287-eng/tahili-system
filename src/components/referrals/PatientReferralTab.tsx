import Link from "next/link";
import { createReferralFromPatient } from "@/app/(app)/referrals/actions";
import { ReferralStatus } from "./ReferralStatus";

export function PatientReferralTab({ patientId, rows, canCreate, centers, reviewers, residentReviews }: {
  patientId: string;
  rows: any[];
  canCreate: boolean;
  centers: any[];
  reviewers: any[];
  residentReviews: any[];
}) {
  return (
    <section className="space-y-4" aria-labelledby="patient-referrals-title">
      <div>
        <h2 id="patient-referrals-title" className="text-lg font-bold text-gray-900">طلبات الفحوص والإحالات</h2>
        <p className="mt-1 text-sm text-gray-500">تابع الإحالات الداخلية وطلبات الفحص أو الإرسال الخارجي من ملف المراجع.</p>
      </div>
      {canCreate ? (
        <details className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
          <summary className="cursor-pointer font-semibold text-brand-800">إنشاء طلب جديد</summary>
          <form action={createReferralFromPatient.bind(null, patientId)} className="mt-4 grid gap-3 md:grid-cols-2" autoComplete="off">
            <label className="label">نطاق الوجهة<select name="destinationScope" className="input mt-1" required defaultValue="EXTERNAL"><option value="EXTERNAL">جهة خارجية</option><option value="INTERNAL_SPECIALIST">طبيب اختصاص داخلي</option><option value="INTERNAL_CENTER">مركز علاجي داخلي</option></select></label>
            <label className="label">نوع الطلب<select name="type" className="input mt-1" required defaultValue="LAB"><option value="LAB">مختبر خارجي</option><option value="RADIOLOGY">أشعة خارجية</option><option value="IMAGING">تصوير خارجي</option><option value="SPECIALIST">طبيب اختصاص</option><option value="TREATMENT_CENTER">مركز علاجي</option><option value="HOSPITAL">مستشفى</option><option value="OTHER">أخرى</option></select></label>
            <label className="label">الجهة الخارجية<input name="externalEntity" className="input mt-1" placeholder="مثال: مستشفى المدينة…" /></label>
            <label className="label">المركز الداخلي<select name="destinationCenterId" className="input mt-1" defaultValue=""><option value="">غير محدد</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
            <label className="label">الطبيب المراجع<select name="assignedReviewerId" className="input mt-1" defaultValue=""><option value="">غير محدد</option>{reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.fullName}</option>)}</select></label>
            <label className="label">تقييم الطبيب المقيم<select name="residentReviewId" className="input mt-1" defaultValue=""><option value="">دون ربط</option>{residentReviews.map((review) => <option key={review.id} value={review.id}>{new Intl.DateTimeFormat("ar-IQ").format(new Date(review.date))}</option>)}</select></label>
            <label className="label md:col-span-2">الخدمة أو الاختصاص المطلوب<input name="requestedService" className="input mt-1" required placeholder="اكتب الفحص أو الاختصاص المطلوب…" /></label>
            <label className="label md:col-span-2">السبب السريري<textarea name="clinicalReason" className="input mt-1" rows={3} required placeholder="اكتب سبب الطلب باختصار…" /></label>
            <div className="md:col-span-2"><button type="submit" className="btn-primary">حفظ الطلب كمسودة</button></div>
          </form>
        </details>
      ) : null}
      <div className="grid gap-3">
        {rows.map((row) => <Link key={row.id} href={`/referrals/${row.id}`} className="rounded-xl border border-gray-200 p-4 hover:border-brand-300 hover:bg-brand-50/30 focus-visible:ring-2 focus-visible:ring-brand-500"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-gray-900">{row.requestedService}</span><ReferralStatus status={row.status} /></div><div className="mt-2 text-xs text-gray-500">{row.externalEntity || row.destinationCenter?.name || row.assignedReviewer?.fullName || "إحالة داخلية"}</div></Link>)}
        {rows.length === 0 ? <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">لا توجد طلبات فحص أو إحالة لهذا المراجع.</p> : null}
      </div>
    </section>
  );
}
