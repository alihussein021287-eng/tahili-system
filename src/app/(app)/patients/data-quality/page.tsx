import Link from "next/link";
import { requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { DATA_QUALITY_LABELS, getPatientDataQuality } from "@/lib/data-quality";
import { fmtDate } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function DataQualityPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requirePerm("patients.view");
  const sp = await searchParams;
  const selected = sp.kind ?? "";
  const report = await getPatientDataQuality(selected);

  return (
    <div className="space-y-5">
      <PageHeader title="جودة بيانات المراجعين" subtitle={`${report.scanned} ملف مفحوص · ${report.totalIssues} مؤشر يحتاج مراجعة`} icon="☑" />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/patients" className="btn-ghost">← المراجعون</Link>
        <a href={`/api/export/data-quality${selected ? `?kind=${encodeURIComponent(selected)}` : ""}`} className="btn-ghost">تصدير CSV</a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/patients/data-quality" className={`card p-4 hover:ring-2 hover:ring-brand-100 ${!selected ? "ring-2 ring-brand-200" : ""}`}>
          <div className="text-2xl font-bold text-gray-800">{report.totalIssues}</div>
          <div className="text-sm text-gray-500">كل مؤشرات الجودة</div>
        </Link>
        {report.counts.map((c) => (
          <Link key={c.kind} href={`/patients/data-quality?kind=${c.kind}`} className={`card p-4 hover:ring-2 hover:ring-brand-100 ${selected === c.kind ? "ring-2 ring-brand-200" : ""}`}>
            <div className={`text-2xl font-bold ${c.count ? "text-amber-700" : "text-emerald-700"}`}>{c.count}</div>
            <div className="text-sm text-gray-500">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <div className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-700">
          {selected && selected in DATA_QUALITY_LABELS ? DATA_QUALITY_LABELS[selected as keyof typeof DATA_QUALITY_LABELS] : "كل المشاكل"} <span className="text-gray-400">({report.issues.length})</span>
        </div>
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">المشكلة</th><th className="th">رقم الملف</th><th className="th">المراجع</th><th className="th">الهاتف</th>
            <th className="th">التولد</th><th className="th">المحافظة</th><th className="th">الإصابة</th><th className="th">التفاصيل</th><th className="th">رابط</th>
          </tr></thead>
          <tbody>
            {report.issues.map((i, idx) => (
              <tr key={`${i.kind}-${i.patientId}-${idx}`} className="hover:bg-gray-50">
                <td className="td"><span className="badge bg-amber-50 text-amber-700">{i.label}</span></td>
                <td className="td font-medium">#{i.fileNumber}</td>
                <td className="td">{i.fullName}{i.archivedAt && <div className="text-xs text-red-700">مؤرشف منذ {fmtDate(i.archivedAt)}</div>}</td>
                <td className="td">{i.phone || "—"}</td>
                <td className="td">{i.birthYear || "—"}</td>
                <td className="td">{i.governorate || "—"}</td>
                <td className="td">{i.injuryType || "—"}</td>
                <td className="td max-w-md text-gray-600">{i.detail}</td>
                <td className="td"><Link href={`/patients/${i.patientId}`} className="text-brand-700 hover:underline">فتح الملف</Link></td>
              </tr>
            ))}
            {report.issues.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={9}>لا توجد نتائج لهذا الفلتر.</td></tr>}
          </tbody>
        </table>
        {report.totalIssues > 500 && <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">يعرض الجدول أول 500 مؤشر فقط. استخدم الفلاتر أو CSV للمراجعة.</div>}
      </div>
    </div>
  );
}

