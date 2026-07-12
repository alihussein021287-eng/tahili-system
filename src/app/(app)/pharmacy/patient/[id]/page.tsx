import { prisma } from "@/lib/db";
import { getOrg } from "@/lib/org";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { fmtDate } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { currentPerms } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function PatientPrescriptionsPrint({ params }: { params: Promise<{ id: string }> }) {
  const perms = await currentPerms();
  if (!perms.has("pharmacy.print") && !perms.has("pharmacy.view")) redirect("/");
  const { id } = await params;
  const org = await getOrg();

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) notFound();

  const rxs = await prisma.prescription.findMany({
    where: { patientId: id, isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE" },
    include: { medication: true },
    orderBy: { prescribedAt: "asc" },
  });

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
          <div className="mt-2 inline-block rounded bg-brand-50 px-3 py-0.5 text-sm font-medium text-brand-700">وصفة طبية — كشف الأدوية</div>
        </div>

        <div className="flex justify-between text-sm">
          <div>المريض: <span className="font-medium">{patient.fullName}</span> <span className="text-gray-400">#{patient.fileNumber}</span></div>
          <div>التاريخ: {fmtDate(new Date())}</div>
        </div>

        <table className="w-full text-sm">
          <thead><tr className="border-b text-gray-500">
            <th className="py-2 pr-1 text-right">#</th>
            <th className="py-2 text-right">المادة/العلاج</th>
            <th className="py-2 text-right">الكمية</th>
            <th className="py-2 text-right">الاستخدام</th>
            <th className="py-2 text-right">المدة</th>
            <th className="py-2 text-right">الطبيب</th>
            <th className="py-2 text-right">التاريخ</th>
          </tr></thead>
          <tbody>
            {rxs.map((rx, i) => (
              <tr key={rx.id} className="border-b align-top">
                <td className="py-3 pr-1 text-gray-400">{i + 1}</td>
                <td className="py-3 font-medium">{rx.medication?.name ?? rx.materialName ?? "—"}</td>
                <td className="py-3">{rx.quantity || "—"}</td>
                <td className="py-3">{rx.usage || "—"}</td>
                <td className="py-3">{rx.duration || "—"}</td>
                <td className="py-3">{rx.doctor || "—"}</td>
                <td className="py-3 whitespace-nowrap">{fmtDate(rx.prescribedAt)}</td>
              </tr>
            ))}
            {rxs.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-gray-400">لا توجد وصفات معلّقة لهذا المريض.</td></tr>}
          </tbody>
        </table>

        <p className="text-xs text-gray-400">إجمالي الوصفات: {rxs.length}</p>

        <div className="grid grid-cols-2 gap-8 pt-10 text-center text-sm text-gray-600">
          <div className="border-t border-gray-300 pt-2">توقيع الطبيب</div>
          <div className="border-t border-gray-300 pt-2">توقيع الصيدلي</div>
        </div>
      </div>
    </div>
  );
}
