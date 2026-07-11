import { prisma } from "@/lib/db";
import { getOrg } from "@/lib/org";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { fmtDate, fmtDateTime } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { currentPerms } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function PrescriptionPrint({ params }: { params: Promise<{ id: string }> }) {
  const perms = await currentPerms();
  if (!perms.has("pharmacy.print") && !perms.has("pharmacy.view")) redirect("/");
  const { id } = await params;
  const org = await getOrg();

  const rx = await prisma.prescription.findUnique({
    where: { id },
    include: { patient: true, medication: true },
  });
  if (!rx) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/pharmacy" className="btn-ghost">↩ رجوع للصيدلية</Link>
        <PrintButton />
      </div>

      <div className="card space-y-5 p-8">
        <div className="print-header border-b-2 border-brand-600 pb-4 text-center">
          <div className="text-2xl font-extrabold text-brand-800">{org.name}</div>
          {org.subtitle && <div className="text-sm text-gray-600">{org.subtitle}</div>}
          {(org.address || org.phone) && <div className="text-xs text-gray-500">{[org.address, org.phone].filter(Boolean).join(" — ")}</div>}
          <div className="mt-2 inline-block rounded bg-brand-50 px-3 py-0.5 text-sm font-medium text-brand-700">وصفة طبية</div>
        </div>

        <div className="flex justify-between text-sm">
          <div>رقم الوصفة: <span className="font-mono font-medium">{rx.id.slice(0, 8).toUpperCase()}</span></div>
          <div>التاريخ: {fmtDate(rx.prescribedAt)}</div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-4 text-sm">
          <div>المريض: <span className="font-medium">{rx.patient.fullName}</span></div>
          <div>رقم الملف: <span className="font-medium">#{rx.patient.fileNumber}</span></div>
          {rx.doctor && <div>الطبيب: <span className="font-medium">{rx.doctor}</span></div>}
          <div>الحالة: <span className="font-medium">{rx.isDispensed ? `جُهّزت${rx.dispensedBy ? " — " + rx.dispensedBy : ""}` : "بانتظار التجهيز"}</span></div>
        </div>

        <table className="w-full text-sm">
          <thead><tr className="border-b text-gray-500">
            <th className="py-2 text-right">المادة/العلاج</th>
            <th className="py-2 text-right">الكمية</th>
            <th className="py-2 text-right">الاستخدام</th>
            <th className="py-2 text-right">المدة</th>
          </tr></thead>
          <tbody>
            <tr className="border-b">
              <td className="py-3 font-medium">{rx.medication?.name ?? rx.materialName ?? "—"}</td>
              <td className="py-3">{rx.quantity || "—"}</td>
              <td className="py-3">{rx.usage || "—"}</td>
              <td className="py-3">{rx.duration || "—"}</td>
            </tr>
          </tbody>
        </table>

        {rx.isDispensed && rx.dispensedAt && (
          <p className="text-xs text-gray-400">تاريخ التجهيز: {fmtDateTime(rx.dispensedAt)}</p>
        )}

        <div className="grid grid-cols-2 gap-8 pt-8 text-center text-sm text-gray-600">
          <div className="border-t border-gray-300 pt-2">توقيع الطبيب</div>
          <div className="border-t border-gray-300 pt-2">توقيع الصيدلي</div>
        </div>
      </div>
    </div>
  );
}
