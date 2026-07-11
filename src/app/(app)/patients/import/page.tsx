import { requireSession } from "@/lib/access";
import { requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { canEdit } from "@/lib/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PatientImportTool } from "@/components/PatientImportTool";

export const dynamic = "force-dynamic";

export default async function ImportPatients({ searchParams }: { searchParams: Promise<{ err?: string; result?: string; details?: string }> }) {
  await requirePerm("patients.import");
  const session = await requireSession();
  if (!canEdit((session?.user as any)?.role)) redirect("/patients");
  const { err, result, details } = await searchParams;

  return (
    <div className="space-y-4">
      <PageHeader title="استيراد جماعي للمراجعين" subtitle="CSV مع معاينة قبل الحفظ ومنع تكرار قوي" icon="⤒" />
      <div className="flex items-center justify-end">
        <Link href="/patients" className="text-sm text-gray-500 hover:underline">→ رجوع</Link>
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {result && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{result}</div>}
      {details && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{details}</div>}

      <div className="card p-5">
        <h2 className="mb-2 font-semibold text-gray-700">تعليمات CSV</h2>
        <ol className="mb-3 list-decimal space-y-1 pr-5 text-sm text-gray-600">
          <li>افتح ملفك بـ Excel، وتأكد الأعمدة بالترتيب: الاسم الرباعي، رقم الهاتف، اسم الأم، سنة التولد، السكن، ملاحظات.</li>
          <li>من Excel: <b>ملف ← حفظ باسم ← اختر النوع «CSV UTF-8 (Comma delimited)»</b>.</li>
          <li>ارفع ملف الـ CSV أو الصق البيانات، راجع المعاينة، ثم احفظ.</li>
          <li>منع التكرار القوي يعتمد على: الاسم + الهاتف + سنة التولد.</li>
        </ol>
      </div>

      <PatientImportTool />
      <p className="text-xs text-gray-400">يمكن تعديل بيانات أي مراجع لاحقاً مثل المحافظة، الإصابة، الفرع، والصورة من ملفه.</p>
    </div>
  );
}
