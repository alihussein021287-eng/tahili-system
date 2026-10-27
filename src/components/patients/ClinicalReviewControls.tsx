import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";
import { clinicalReviewControls, type ClinicalActor, type ClinicalTarget } from "@/lib/clinical-review-service";
import { nominateReviewAction, acceptReviewAction, revokeReviewAction, confirmProgramMedicalAction } from "@/app/(app)/clinical-review-actions";
import { confirmStage } from "@/app/(app)/patients/actions";

export async function ClinicalReviewControls({ target, patientId, centerId, completionId }: { target: ClinicalTarget; patientId: string; centerId: number; completionId: string | null }) {
  const u = (await requireSession()).user as { id: string; role: ClinicalActor["role"]; authVersion: number };
  const data = await clinicalReviewControls(prisma, { userId: u.id, role: u.role, authVersion: u.authVersion }, target);
  const a = data.assignment;
  if (!data.canNominate && a?.reviewerId !== u.id) return null;
  return <section className="card space-y-3 p-4" aria-label={target.kind === "STAGE" ? "مراجعة مرحلة المركز" : "المراجعة الطبية لإغلاق البرنامج"}>
    <h2 className="font-semibold">{target.kind === "STAGE" ? "مراجعة مرحلة المركز" : "المراجعة الطبية لإغلاق البرنامج"}</h2>
    <p className="text-sm">الترشيح لا يمنح اعتماداً طبياً؛ يلزم قبول الطبيب وإكمال العمل بصورة مستقلة.</p>
    {data.canNominate ? <form action={nominateReviewAction.bind(null, target.kind, target.id)} className="flex flex-wrap items-end gap-3">
      <label className="label">الطبيب المؤهل<select name="reviewerId" className="input mt-1" required defaultValue=""><option value="" disabled>اختر طبيباً</option>{data.candidates.map(d => <option key={d.id} value={d.id}>{d.fullName}</option>)}</select></label>
      <button className="btn-primary min-h-11">ترشيح طبيب للمراجعة</button>
    </form> : null}
    {a ? <p className="text-sm">{a.acceptedAt ? "قبل الطبيب المسؤولية" : "بانتظار قبول الطبيب"}</p> : <p>لا يوجد ترشيح فعال.</p>}
    {a && data.canNominate ? <form action={revokeReviewAction.bind(null, target.kind, target.id, a.id)}><button className="btn-ghost min-h-11">سحب الترشيح</button></form> : null}
    {a && data.canAccept ? <form action={acceptReviewAction.bind(null, target.kind, target.id, a.id)}><button className="btn-primary min-h-11">أقبل مسؤولية المراجعة الطبية</button></form> : null}
    {a?.acceptedAt && a.reviewerId === u.id && completionId ? <form action={target.kind === "PROGRAM"
      ? confirmProgramMedicalAction.bind(null, centerId, target.id, completionId, a.id)
      : confirmStage.bind(null, patientId, target.id, completionId, a.id)}>
      <button className="btn-primary min-h-11">{target.kind === "PROGRAM" ? "التأكيد الطبي لإغلاق البرنامج" : "تأكيد الطبيب للمرحلة"}</button>
    </form> : null}
  </section>;
}
