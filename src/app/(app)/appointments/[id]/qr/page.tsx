import { requirePerm } from "@/lib/access";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { THERAPY, APPT_STATUS, fmtDate, fmtTime } from "@/lib/labels";
import { qrSvg } from "@/lib/qr";

export const dynamic = "force-dynamic";

export default async function AppointmentQR({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("appointments.view");
  const { id } = await params;
  const a = await prisma.appointment.findUnique({ where: { id }, include: { patient: true } });
  if (!a) notFound();

  const type = a.type || (a.therapyType ? THERAPY[a.therapyType as keyof typeof THERAPY] : "");
  const lines = [
    "موعد - المجمع التأهيلي الطبي",
    `المريض: ${a.patient.fullName} (#${a.patient.fileNumber})`,
    `التاريخ: ${fmtDate(a.scheduledAt)} الساعة ${fmtTime(a.scheduledAt)}`,
    type ? `النوع: ${type}` : "",
    a.assignedTo ? `المسؤول: ${a.assignedTo}` : "",
  ].filter(Boolean);
  const qrData = lines.join("\n");
  const qr = await qrSvg(qrData);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link href="/appointments" className="text-sm text-gray-500 hover:underline">→ رجوع للمواعيد</Link>
        <PrintButton />
      </div>

      <div id="card" className="rounded-2xl border-2 border-brand-700 bg-white p-6 text-center">
        <div className="text-lg font-bold text-brand-900">المجمع التأهيلي الطبي</div>
        <div className="mb-4 text-xs text-gray-500">بطاقة موعد</div>

        <div className="text-2xl font-bold text-gray-800">{a.patient.fullName}</div>
        <div className="mt-1 text-sm text-gray-500">رقم الملف: <b>{a.patient.fileNumber}</b></div>

        <div className="mx-auto mt-4 max-w-xs space-y-1 text-right text-sm text-gray-700">
          <div className="flex justify-between border-b border-gray-100 py-1"><span className="text-gray-500">التاريخ</span><b>{fmtDate(a.scheduledAt)}</b></div>
          <div className="flex justify-between border-b border-gray-100 py-1"><span className="text-gray-500">الوقت</span><b>{fmtTime(a.scheduledAt)}</b></div>
          {type && <div className="flex justify-between border-b border-gray-100 py-1"><span className="text-gray-500">النوع</span><b>{type}</b></div>}
          {a.assignedTo && <div className="flex justify-between border-b border-gray-100 py-1"><span className="text-gray-500">المسؤول</span><b>{a.assignedTo}</b></div>}
          <div className="flex justify-between py-1"><span className="text-gray-500">الحالة</span><b>{APPT_STATUS[a.status as keyof typeof APPT_STATUS]}</b></div>
        </div>

        <div className="mt-5 flex flex-col items-center">
          <div className="h-48 w-48" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="mt-2 text-[11px] text-gray-400">امسح الرمز لعرض تفاصيل الموعد</div>
        </div>
      </div>
    </div>
  );
}
