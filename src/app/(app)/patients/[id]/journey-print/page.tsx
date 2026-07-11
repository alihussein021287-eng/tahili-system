import { prisma } from "@/lib/db";
import { getOrg } from "@/lib/org";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtDateTime, fmtDate } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { requirePerm } from "@/lib/access";
import { ROLE_LABELS } from "@/lib/permissions";
import { refCode } from "@/lib/refcode";
import { qrSvg } from "@/lib/qr";

export const dynamic = "force-dynamic";

const ST: any = { WAITING: "بالانتظار", IN_PROGRESS: "قيد التنفيذ", CONFIRMED: "مؤكّدة", SKIPPED: "متجاوَزة" };

export default async function JourneyPrint({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("journey.view");
  const { id } = await params;
  const org = await getOrg();
  const patient = await prisma.patient.findUnique({
    where: { id },
    include: { governorate: true, careStages: { orderBy: { sequence: "asc" } } },
  });
  if (!patient) notFound();

  const code = refCode(patient as any);
  const qr = await qrSvg(code);
  const stages = patient.careStages ?? [];
  const done = stages.filter((s) => s.status === "CONFIRMED").length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/patients/${id}`} className="btn-ghost">↩ رجوع</Link>
        <PrintButton />
      </div>

      <div className="card space-y-5 p-8">
        <div className="flex items-start justify-between border-b-2 border-brand-600 pb-4">
          <div className="text-center">
            <div className="text-2xl font-extrabold text-brand-800">{org.name}</div>
            {org.subtitle && <div className="text-sm text-gray-600">{org.subtitle}</div>}
            <div className="mt-2 inline-block rounded bg-brand-50 px-3 py-0.5 text-sm font-medium text-brand-700">مسار متابعة المريض</div>
          </div>
          <div className="text-center">
            <div className="h-24 w-24" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="mt-1 font-mono text-xs font-bold text-gray-700">{code}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div>المريض: <span className="font-medium">{patient.fullName}</span></div>
          <div>الرقم المرجعي: <span className="font-mono font-medium">{code}</span></div>
          <div>رقم الملف: <span className="font-medium">#{patient.fileNumber}</span></div>
          <div>المحافظة: <span className="font-medium">{patient.governorate?.name ?? "—"}</span></div>
          <div>تاريخ الطباعة: <span className="font-medium">{fmtDate(new Date())}</span></div>
          <div>التقدّم: <span className="font-medium">{done}/{stages.length} محطة</span></div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300 text-gray-600">
              <th className="py-2 text-right">#</th>
              <th className="py-2 text-right">المحطة</th>
              <th className="py-2 text-right">الدور المسؤول</th>
              <th className="py-2 text-right">الحالة</th>
              <th className="py-2 text-right">المؤكِّد</th>
              <th className="py-2 text-right">وقت التأكيد</th>
            </tr>
          </thead>
          <tbody>
            {stages.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-gray-400">لا يوجد مسار.</td></tr>
            )}
            {stages.map((s, i) => (
              <tr key={s.id} className="border-b align-top">
                <td className="py-2">{i + 1}</td>
                <td className="py-2 font-medium">{s.station}</td>
                <td className="py-2">{s.responsibleRole ? (ROLE_LABELS as any)[s.responsibleRole] : "أي مخوّل"}</td>
                <td className="py-2">{ST[s.status] ?? s.status}</td>
                <td className="py-2">{s.confirmedBy ?? "—"}</td>
                <td className="py-2 whitespace-nowrap">{s.confirmedAt ? fmtDateTime(s.confirmedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-8 pt-8 text-center text-sm">
          <div className="border-t border-gray-400 pt-2">توقيع المسؤول</div>
          <div className="border-t border-gray-400 pt-2">ختم المركز</div>
        </div>
      </div>
    </div>
  );
}
