import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { AdminSection, StatCard } from "@/components/AdminPageSections";
import { DataTable, StatusBadge } from "@/components/Ui";
import { fmtDateTime } from "@/lib/labels";
import { currentActor } from "@/lib/data-center/access";
import { applyLockReason, currentDatabaseName, loadOperation } from "@/lib/data-center/operations";
import { IMPORT_DOMAIN_BY_ID, decodeStaffRow } from "@/lib/data-center/registry";
import { cancelImportAction, confirmImportAction } from "../../actions";

export const dynamic = "force-dynamic";

const DISPOSITION: Record<string, string> = { READY: "جاهز", MATCHED: "مطابق لسجل قائم", DUPLICATE: "مكرر", HELD: "محجوز لقرار", INVALID: "غير صالح", EXCLUDED: "مستثنى", UPDATE_CANDIDATE: "مرشح تحديث (غير معتمد)", APPLIED: "نُفِّذ" };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { READY: "success", APPLIED: "success", HELD: "warning", UPDATE_CANDIDATE: "warning", INVALID: "danger" };
const STATUS: Record<string, string> = { PREVIEWED: "معاينة بانتظار التأكيد", APPLYING: "قيد التنفيذ", APPLIED: "نُفِّذ", PARTIAL: "نُفِّذ جزئياً", FAILED: "فشل", CANCELLED: "أُلغي" };
const SHOWN = 300;

export default async function ImportOperationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; d?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.has("datacenter.view")) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const op = await loadOperation(prisma, actor, id);
  if (!op || op.kind !== "IMPORT") notFound();
  const domain = IMPORT_DOMAIN_BY_ID[op.domain];
  const counts = (op.counts ?? {}) as Record<string, number>;
  const filter = sp.d && DISPOSITION[sp.d] ? sp.d : undefined;
  const rows = await prisma.dataOperationRow.findMany({ where: { operationId: id, ...(filter ? { disposition: filter } : {}) }, orderBy: { rowNumber: "asc" }, take: SHOWN, select: { rowNumber: true, disposition: true, reasons: true, fieldErrors: true } });
  const lock = applyLockReason(await currentDatabaseName(prisma));
  const canApply = !!domain && actor.permissions.has(domain.permission) && actor.permissions.has("datacenter.import.apply");
  const pending = op.status === "PREVIEWED";
  const problems = (counts.invalid ?? 0) + (counts.held ?? 0) + (counts.duplicate ?? 0) + (counts.updateCandidates ?? 0);

  return (
    <div className="min-w-0 space-y-6" dir="rtl">
      <PageHeader title={`معاينة استيراد: ${domain?.title ?? op.domain}`} subtitle={`${op.fileName ?? ""} — ${op.branch?.name ?? ""} — ${fmtDateTime(op.createdAt)}`} icon="🗄">
        <Link href="/data-center?tab=history" className="btn-ghost">العودة للسجل</Link>
      </PageHeader>
      {sp.err ? <div role="alert" className="card-danger p-3 text-sm text-red-800">{sp.err}</div> : null}
      {pending && lock ? <div className="card-warning p-3 text-sm text-amber-900" data-testid="apply-lock-banner">🔒 {lock}</div> : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8" aria-label="ملخص الأعداد">
        <StatCard label="الإجمالي" value={op.rowCount ?? 0} />
        <StatCard label="جاهز" value={counts.ready ?? 0} tone="text-emerald-700" />
        <StatCard label="مطابق" value={counts.matched ?? 0} />
        <StatCard label="مكرر" value={counts.duplicate ?? 0} />
        <StatCard label="محجوز" value={counts.held ?? 0} tone="text-amber-700" />
        <StatCard label="غير صالح" value={counts.invalid ?? 0} tone="text-red-700" />
        <StatCard label="مستثنى" value={counts.excluded ?? 0} />
        <StatCard label="نُفِّذ" value={counts.applied ?? 0} tone="text-brand-700" />
      </section>

      {Array.isArray((op.counts as { unmappedHeaders?: string[] } | null)?.unmappedHeaders) && ((op.counts as { unmappedHeaders: string[] }).unmappedHeaders).length ? (
        <div className="card-warning p-3 text-sm text-amber-900" data-testid="unmapped-headers">أعمدة في ملفك غير مدعومة ولن تُستورد: {((op.counts as { unmappedHeaders: string[] }).unmappedHeaders).join("، ")}. استعمل القالب الرسمي.</div>
      ) : null}
      {pending ? <p className="text-sm text-gray-700" data-testid="destination">الوجهة: <b>{op.branch?.name ?? "—"}</b> — سيُنشأ {counts.ready ?? 0} سجل جاهز فقط؛ الصفوف غير الصالحة والمحجوزة والمكررة والمطابقة لا تُكتب.</p> : null}
      {domain?.sheets ? <p className="text-sm text-gray-700" data-testid="staff-ready-breakdown">الجاهز للإنشاء: {counts.readyPersonnel ?? 0} سجل موظف، {counts.readyAccounts ?? 0} حساب غير مفعّل، {counts.readyMemberships ?? 0} عضوية مركز — في عملية واحدة متكاملة.</p> : null}
      <AdminSection id="status" title="الحالة والإيصال">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-gray-500">الحالة</dt><dd data-testid="op-status">{STATUS[op.status] ?? op.status}</dd></div>
          <div><dt className="text-gray-500">إصدار القالب</dt><dd>{op.templateVersion ?? "—"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-gray-500">بصمة الملف (SHA-256)</dt><dd className="break-all font-mono text-xs">{op.fileSha256}</dd></div>
          <div className="sm:col-span-2"><dt className="text-gray-500">بصمة خطة التنفيذ</dt><dd className="break-all font-mono text-xs">{op.planSha256}</dd></div>
          {op.appliedAt ? <div><dt className="text-gray-500">وقت التنفيذ</dt><dd>{fmtDateTime(op.appliedAt)}</dd></div> : null}
          {op.error ? <div className="sm:col-span-2"><dt className="text-gray-500">ملاحظة</dt><dd>{op.error}</dd></div> : null}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {problems > 0 ? (
            <>
              <a className="btn-ghost btn-sm" href={`/api/data-center/operations/${id}/errors?format=xlsx`}>تقرير الأخطاء XLSX</a>
              <a className="btn-ghost btn-sm" href={`/api/data-center/operations/${id}/errors?format=csv`}>CSV</a>
            </>
          ) : null}
          {pending ? (
            <>
              {canApply ? (
                <form action={confirmImportAction.bind(null, id, op.planSha256 ?? "")}>
                  <button type="submit" className="btn-primary btn-sm" disabled={!!lock} aria-disabled={!!lock}>تأكيد التنفيذ ({counts.ready ?? 0} جاهز)</button>
                </form>
              ) : <span className="text-xs text-gray-500">لا تملك صلاحية تنفيذ الاستيراد؛ المعاينة فقط.</span>}
              <form action={cancelImportAction.bind(null, id)}><button type="submit" className="btn-danger-soft btn-sm">إلغاء المعاينة</button></form>
            </>
          ) : null}
        </div>
      </AdminSection>

      <AdminSection id="rows" title="الصفوف" description={`أول ${SHOWN} صفاً؛ لا تُعرض قيم الخلايا حفاظاً على الخصوصية، فقط الحالة وسبب الرفض.`}>
        <nav className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="تصفية الصفوف">
          <Link href={`/data-center/import/${id}`} className="btn-ghost btn-xs">الكل</Link>
          {Object.keys(DISPOSITION).map((k) => <Link key={k} href={`/data-center/import/${id}?d=${k}`} className="btn-ghost btn-xs">{DISPOSITION[k]}</Link>)}
        </nav>
        <DataTable label="صفوف المعاينة" className="-mx-5 -mb-5 rounded-none border-x-0 border-b-0">
          <table className="w-full">
            <thead><tr>{domain?.sheets ? <th className="th">الورقة</th> : null}<th className="th">الصف</th><th className="th">الحالة</th><th className="th">التفاصيل</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const errs = (r.fieldErrors as { field: string; message: string }[] | null) ?? [];
                return (
                  <tr key={r.rowNumber}>
                    {domain?.sheets ? <td className="td">{{ personnel: "الأشخاص", accounts: "الحسابات", memberships: "العضويات" }[decodeStaffRow(r.rowNumber).sheet]}</td> : null}
                    <td className="td">{domain?.sheets ? decodeStaffRow(r.rowNumber).row : r.rowNumber}</td>
                    <td className="td"><StatusBadge tone={TONE[r.disposition] ?? "neutral"}>{DISPOSITION[r.disposition] ?? r.disposition}</StatusBadge></td>
                    <td className="td text-xs">{errs.length ? errs.map((e) => `${e.field}: ${e.message}`).join(" • ") : r.reasons ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      </AdminSection>
    </div>
  );
}
