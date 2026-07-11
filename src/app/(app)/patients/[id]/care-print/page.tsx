import { prisma } from "@/lib/db";
import { getOrg } from "@/lib/org";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { fmtDate, CARE_PERIOD, CARE_KIND } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { currentPerms } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function CarePrint({ params }: { params: Promise<{ id: string }> }) {
  const perms = await currentPerms();
  if (!perms.has("clinical.view") && !perms.has("clinical.care")) redirect("/");
  const { id } = await params;
  const org = await getOrg();

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) notFound();
  const rows = await prisma.dressingRecord.findMany({ where: { patientId: id }, orderBy: { date: "asc" } });
  const meds = await prisma.medication.findMany({ select: { id: true, name: true } });
  const medName = (mid: number | null) => (mid ? meds.find((m) => m.id === mid)?.name : null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/patients/${id}`} className="btn-ghost">↩ رجوع</Link>
        <PrintButton />
      </div>

      <div className="card space-y-5 p-8">
        <div className="print-header border-b-2 border-brand-600 pb-4 text-center">
          <div className="text-2xl font-extrabold text-brand-800">{org.name}</div>
          {org.subtitle && <div className="text-sm text-gray-600">{org.subtitle}</div>}
          <div className="mt-2 inline-block rounded bg-brand-50 px-3 py-0.5 text-sm font-medium text-brand-700">سجل التداوي والتضميد</div>
        </div>

        <div className="flex justify-between text-sm">
          <div>المريض: <span className="font-medium">{patient.fullName}</span> <span className="text-gray-400">#{patient.fileNumber}</span></div>
          <div>التاريخ: {fmtDate(new Date())}</div>
        </div>

        <table className="w-full text-sm">
          <thead><tr className="border-b text-gray-500">
            <th className="py-2 text-right">التاريخ</th><th className="py-2 text-right">الفترة</th><th className="py-2 text-right">النوع</th>
            <th className="py-2 text-right">المادة</th><th className="py-2 text-right">الكمية</th><th className="py-2 text-right">الموضع</th>
            <th className="py-2 text-right">حالة الجرح</th><th className="py-2 text-right">المنفّذ</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="py-2">{CARE_PERIOD[r.period as keyof typeof CARE_PERIOD]}</td>
                <td className="py-2">{CARE_KIND[r.kind as keyof typeof CARE_KIND]}</td>
                <td className="py-2">{medName(r.medicationId) ?? r.materialName ?? "—"}</td>
                <td className="py-2">{r.quantity ?? "—"}</td>
                <td className="py-2">{r.site || "—"}</td>
                <td className="py-2">{r.woundState || "—"}</td>
                <td className="py-2">{r.performedBy || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-gray-400">لا توجد سجلات.</td></tr>}
          </tbody>
        </table>

        <p className="text-xs text-gray-400">إجمالي السجلات: {rows.length}</p>
        <div className="grid grid-cols-2 gap-8 pt-10 text-center text-sm text-gray-600">
          <div className="border-t border-gray-300 pt-2">توقيع المنفّذ</div>
          <div className="border-t border-gray-300 pt-2">توقيع المشرف</div>
        </div>
      </div>
    </div>
  );
}
