import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/access";
import { getOrg } from "@/lib/org";
import { PrintButton } from "@/components/PrintButton";
import { fmtDate } from "@/lib/labels";

export default async function ReferralOfficialPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("referrals.print");
  const { id } = await params;
  const [request, org] = await Promise.all([prisma.referralRequest.findUnique({ where: { id }, include: { patient: true, officialDocument: true } }), getOrg()]);
  if (!request?.officialDocument) notFound();
  const doc = request.officialDocument;
  return <div className="space-y-4"><div className="no-print flex justify-between gap-2"><Link href={`/referrals/${id}`} className="btn-ghost">العودة إلى الطلب</Link><PrintButton /></div><article id="report" className="card mx-auto max-w-3xl bg-white p-8 text-black print:border-0 print:shadow-none"><header className="border-b-2 border-brand-700 pb-4 text-center"><div className="text-sm font-semibold">{[org.officialHeader1,org.officialHeader2,org.officialHeader3].filter(Boolean).join("، ")}</div><h1 className="mt-1 text-2xl font-bold">{org.officialHeader4 || org.name}</h1></header><div className="mt-6 flex justify-between text-sm"><span>العدد: {doc.number}</span><span>التاريخ: {fmtDate(doc.docDate)}</span></div><h2 className="mt-8 text-center text-xl font-bold">كتاب إرسال</h2><p className="mt-8 leading-8">إلى: {doc.entity}</p><p className="mt-3 leading-8">الموضوع: {doc.subject}</p><p className="mt-6 whitespace-pre-wrap leading-8">{doc.body || `نرسل إليكم المراجع ${request.patient.fullName}، رقم الملف ${request.patient.fileNumber}، لغرض ${request.requestedService}.`}</p><div className="mt-16 text-left">التوقيع والختم</div></article></div>;
}
