import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, requireSession } from "@/lib/access";
import { listAuthoredRecords } from "@/lib/authored-records";
import { fmtDate } from "@/lib/labels";

export const dynamic = "force-dynamic";

/** Read-only view of records the signed-in clinician authored for patients of handoffs that are now DONE. */
export default async function AuthoredRecords() {
  const session = await requireSession();
  const userId = (session.user as { id?: string }).id;
  const perms = await currentPerms();
  if (!userId || !perms.has("clinical.view")) notFound();
  const { reports, prescriptions, sickLeaves } = await listAuthoredRecords(userId);
  await prisma.auditLog.create({ data: { userId, action: "AUTHORED_READ", tableName: "authored_records", recordId: userId, newValue: { reports: reports.length, prescriptions: prescriptions.length, sickLeaves: sickLeaves.length } } }).catch(() => undefined);
  const empty = reports.length + prescriptions.length + sickLeaves.length === 0;
  return (
    <div className="space-y-5">
      <PageHeader title="سجلاتي المؤلَّفة (قراءة فقط)" subtitle="سجلات ثبتت نسبتها إليك بعد إتمام التسليم؛ لا تفتح ملف المراجع ولا تسمح بالتعديل" icon="📄">
        <Link href="/my-work" className="btn-ghost bg-white text-brand-700">← قائمة عملي</Link>
      </PageHeader>
      {empty ? <p className="card p-6 text-center text-sm text-gray-500">لا توجد سجلات مؤلَّفة بعد تسليم مكتمل.</p> : null}
      {reports.length ? <section className="card space-y-3 p-4"><h2 className="font-semibold">التقارير الطبية</h2>
        {reports.map((r) => <article key={r.id} className="rounded-lg border p-3 text-sm"><div className="text-xs text-gray-500">{r.patient.fullName} · #{r.patient.fileNumber} · {fmtDate(r.date)}</div><p className="mt-1 whitespace-pre-wrap">{r.content}</p></article>)}</section> : null}
      {prescriptions.length ? <section className="card space-y-3 p-4"><h2 className="font-semibold">الوصفات</h2>
        {prescriptions.map((r) => <article key={r.id} className="rounded-lg border p-3 text-sm"><div className="text-xs text-gray-500">{r.patient.fullName} · #{r.patient.fileNumber} · {fmtDate(r.prescribedAt)}</div><p className="mt-1">{r.medication?.name ?? r.materialName ?? "—"} — {r.quantity ?? r.count ?? "—"}</p></article>)}</section> : null}
      {sickLeaves.length ? <section className="card space-y-3 p-4"><h2 className="font-semibold">الإجازات المرضية</h2>
        {sickLeaves.map((r) => <article key={r.id} className="rounded-lg border p-3 text-sm"><div className="text-xs text-gray-500">{r.patient.fullName} · #{r.patient.fileNumber} · {fmtDate(r.startDate)} → {fmtDate(r.endDate)}</div><p className="mt-1">{r.diagnosisText}</p></article>)}</section> : null}
    </div>
  );
}
