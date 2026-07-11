import { requirePerm } from "@/lib/access";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { qrSvg } from "@/lib/qr";
import { getOrg } from "@/lib/org";
import { refCode } from "@/lib/refcode";

export const dynamic = "force-dynamic";

export default async function PatientCard({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("patients.print");
  const { id } = await params;
  const org = await getOrg();
  const patient = await prisma.patient.findUnique({ where: { id }, include: { governorate: true } });
  if (!patient) notFound();

  const base = process.env.NEXTAUTH_URL || "";
  const portalUrl = patient.accessToken ? `${base}/portal/${patient.accessToken}` : "";
  const qr = portalUrl ? await qrSvg(portalUrl) : "";

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link href={`/patients/${id}`} className="text-sm text-gray-500 hover:underline">→ رجوع</Link>
        <PrintButton />
      </div>

      <div id="card" className="rounded-2xl border-2 border-brand-700 bg-white p-6 text-center">
        <div className="text-lg font-bold text-brand-900">{org.name}</div>
        {org.subtitle && <div className="text-[11px] text-gray-500">{org.subtitle}</div>}
        <div className="mb-4 text-xs text-gray-500">بطاقة مراجع</div>
        {patient.photoUrl
          ? <img src={patient.photoUrl} alt="" className="mx-auto mb-3 h-24 w-24 rounded-full border-2 border-brand-700 object-cover" />
          : <div className="mx-auto mb-3 flex h-24 w-24 items-center justify-center rounded-full border-2 border-brand-700 bg-brand-50 text-3xl font-bold text-brand-700">{patient.fullName?.[0] ?? "؟"}</div>}
        <div className="text-2xl font-bold text-gray-800">{patient.fullName}</div>
        <div className="mt-1 text-sm text-gray-500">رقم الملف: <b>{patient.fileNumber}</b> — {patient.governorate?.name ?? ""}</div>
        <div className="mt-1 text-sm text-gray-700">الرقم المرجعي: <b className="font-mono">{refCode(patient as any)}</b></div>
        {qr ? (
          <div className="mt-4 flex flex-col items-center">
            <div className="h-44 w-44" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="mt-2 text-[11px] text-gray-400">امسح الرمز للوصول لبوابتك</div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 no-print">
            فعّل بوابة المريض أولاً من صفحة المريض لإظهار رمز QR.
          </div>
        )}
      </div>
    </div>
  );
}
