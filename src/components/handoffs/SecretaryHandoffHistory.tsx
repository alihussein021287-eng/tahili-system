import { fmtDateTime } from "@/lib/labels";
import { handoffParty, handoffStatusLabel } from "@/lib/patient-handoff-presentation";
import type { SecretaryHandoffRow } from "@/lib/secretary-handoff-history";

export function SecretaryHandoffHistory({ rows }: { rows: readonly SecretaryHandoffRow[] }) {
  return <section id="operational-handoffs" className="card min-w-0 p-4 sm:p-5" aria-labelledby="operational-handoffs-title">
    <h2 id="operational-handoffs-title" className="mb-3 text-lg font-semibold text-gray-900 dark:text-slate-100">سجل التسليمات المرتبطة بعملك</h2>
    {rows.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">لا توجد تسليمات مرتبطة بعملك لهذا المراجع.</p> :
      <ol className="space-y-3" aria-label="تسلسل التحويلات">
        {rows.map((row) => <li key={row.id} className="min-w-0 rounded-lg border border-gray-100 p-3 text-sm dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <time dateTime={row.sentAt.toISOString()} className="text-gray-500 dark:text-slate-400">{fmtDateTime(row.sentAt)}</time>
            <span className="badge-brand">{handoffStatusLabel(row.status)}</span>
          </div>
          <p className="mt-2 break-words text-gray-800 dark:text-slate-100">من <bdi>{handoffParty(row.fromUser?.fullName, row.fromRole, row.fromCenter?.name)}</bdi> إلى <bdi>{handoffParty(row.toUser?.fullName, row.toRole, row.toCenter?.name)}</bdi></p>
        </li>)}
      </ol>}
  </section>;
}
