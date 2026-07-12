import { prisma } from "@/lib/db";
import { getOrg } from "@/lib/org";
import { requirePerm } from "@/lib/access";
import { PrintButton } from "@/components/PrintButton";
import { fmtDate } from "@/lib/labels";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdmissionPrint({ params }: { params: Promise<{ id: string; admissionId: string }> }) {
  await requirePerm("clinical.admission");
  const { id, admissionId } = await params;
  const [org, admission] = await Promise.all([getOrg(), prisma.admission.findFirst({ where: { id: admissionId, patientId: id }, include: { patient: true, center: true, room: true, bed: true } })]);
  if (!admission) notFound();
  const rows = [["المراجع", admission.patient.fullName], ["رقم الملف", `#${admission.patient.fileNumber}`], ["المركز", admission.center?.name], ["الغرفة", admission.room?.name], ["السرير", admission.bed?.label], ["تاريخ الدخول", fmtDate(admission.admissionDate)], ["المدة", admission.durationDays ? `${admission.durationDays} يوم` : null], ["الخروج المتوقع", fmtDate(admission.expectedDischargeDate)], ["الطبيب الموصي", admission.recommendingDoctor], ["سبب الرقود", admission.admissionReason]];
  return <main className="mx-auto max-w-3xl space-y-4"><div className="flex justify-between print:hidden"><Link href={`/patients/${id}?tab=adm`} className="btn-ghost">رجوع لملف المراجع</Link><PrintButton /></div><article className="card min-h-[850px] p-10"><header className="border-b-2 border-brand-700 pb-5 text-center"><h1 className="text-2xl font-bold text-brand-800">{org.name}</h1><p className="mt-2">استمارة قرار الرقود</p></header><dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5">{rows.map(([label,value])=><div key={label} className="border-b pb-2"><dt className="text-sm text-gray-500">{label}</dt><dd className="mt-1 font-medium">{value || "غير مثبت"}</dd></div>)}</dl><footer className="grid grid-cols-2 gap-16 pt-20 text-center text-sm"><div className="border-t pt-2">توقيع الطبيب الموصي</div><div className="border-t pt-2">اعتماد إدارة الرقود</div></footer></article></main>;
}
