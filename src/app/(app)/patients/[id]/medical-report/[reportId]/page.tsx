import { prisma } from "@/lib/db";
import { getOrg } from "@/lib/org";
import { requirePerm } from "@/lib/access";
import { PrintButton } from "@/components/PrintButton";
import { fmtDate } from "@/lib/labels";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MedicalReportPrint({ params }: { params: Promise<{ id: string; reportId: string }> }) {
  await requirePerm("reports.print");
  const { id, reportId } = await params;
  const [org, report] = await Promise.all([
    getOrg(),
    prisma.medicalReport.findFirst({ where: { id: reportId, patientId: id }, include: { patient: true } }),
  ]);
  if (!report) notFound();
  return <main className="mx-auto max-w-3xl space-y-4">
    <div className="flex justify-between print:hidden"><Link href={`/patients/${id}?tab=reports`} className="btn-ghost">رجوع لملف المراجع</Link><PrintButton /></div>
    <article className="card min-h-[900px] p-10">
      <header className="border-b-2 border-brand-700 pb-5 text-center"><h1 className="text-2xl font-bold text-brand-800">{org.name}</h1><p className="mt-2">تقرير طبي {report.reportType === "FINAL" ? "نهائي" : "أولي"}</p></header>
      <dl className="my-6 grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4 text-sm"><div><dt className="text-gray-500">المراجع</dt><dd className="font-semibold">{report.patient.fullName}</dd></div><div><dt className="text-gray-500">رقم الملف</dt><dd>#{report.patient.fileNumber}</dd></div><div><dt className="text-gray-500">الطبيب</dt><dd>{report.doctor || "غير مثبت"}</dd></div><div><dt className="text-gray-500">التاريخ</dt><dd>{fmtDate(report.date)}</dd></div></dl>
      <section className="min-h-[520px] whitespace-pre-wrap break-words text-base leading-8">{report.content}</section>
      <footer className="grid grid-cols-2 gap-16 pt-12 text-center text-sm"><div className="border-t pt-2">توقيع الطبيب</div><div className="border-t pt-2">الختم والاعتماد</div></footer>
    </article>
  </main>;
}
