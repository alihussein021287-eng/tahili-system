import { prisma } from "@/lib/db";
import { currentPerms, requireSession } from "@/lib/access";
import { consentActor } from "@/lib/patient-consent-service";
import type { ClinicalActor } from "@/lib/clinical-review-service";
import { ConsentUploadForm } from "./ConsentUploadForm";
import { withdrawConsentAction } from "@/app/(app)/scope-closure-actions";
export async function PatientConsents({ patientId }: { patientId: string }) {
  const perms = await currentPerms(); if (!["consents.view", "consents.record", "consents.withdraw"].some(p => perms.has(p))) return null;
  const u = (await requireSession()).user as { id: string; role: ClinicalActor["role"]; authVersion: number };
  const actor = { userId: u.id, role: u.role, authVersion: u.authVersion };
  const archived = !!(await prisma.patient.findUnique({ where: { id: patientId }, select: { archivedAt: true } }))?.archivedAt;
  const canRecord = !archived && perms.has("consents.record") && perms.has("files.upload");
  const canView = perms.has("consents.view") && perms.has("files.view");
  if (canRecord) await consentActor(prisma, actor, "consents.record", patientId, "files.upload");
  if (canView) await consentActor(prisma, actor, "consents.view", patientId, "files.view");
  const records = canView ? await prisma.patientConsent.findMany({ where: { patientId }, orderBy: { recordedAt: "desc" }, take: 100,
    select: { id: true, procedure: true, documentCode: true, documentVersion: true, signerName: true, signerCapacity: true, signedAt: true, status: true, withdrawalReason: true, recordedBy: { select: { fullName: true } } } }) : [];
  return <section className="card space-y-4 p-4" aria-label="الموافقات الموقعة"><h2 className="text-lg font-semibold">الموافقات الموقعة</h2>
    {canRecord ? <ConsentUploadForm patientId={patientId} /> : null}
    {records.map(c => <article key={c.id} className="space-y-2 rounded-lg border p-3"><p className="break-words">{c.procedure} — {c.documentCode} / {c.documentVersion}</p><p>{c.signerName} — {c.signerCapacity} — {c.signedAt.toISOString().slice(0, 10)}</p><p>{c.status === "SIGNED" ? "موافقة موقعة مسجلة" : `مسحوبة: ${c.withdrawalReason}`} — سجّلها {c.recordedBy.fullName}</p>
      {perms.has("files.download") ? <a className="btn-ghost" href={`/api/patients/${encodeURIComponent(patientId)}/consents/${encodeURIComponent(c.id)}`}>تنزيل الدليل المحمي</a> : null}
      {!archived && perms.has("consents.withdraw") && c.status === "SIGNED" ? <form action={withdrawConsentAction.bind(null, patientId, c.id)} className="flex flex-wrap gap-2"><label className="label">سبب السحب<input className="input" name="reason" maxLength={1000} required /></label><button className="btn-ghost self-end">توثيق سحب الموافقة</button></form> : null}
    </article>)}{canView && records.length === 0 ? <p>لا توجد موافقات موقعة مسجلة؛ لا تُستنتج من الحضور أو تقدم العلاج.</p> : null}
  </section>;
}
