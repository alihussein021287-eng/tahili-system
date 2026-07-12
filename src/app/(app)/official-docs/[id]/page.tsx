import { currentPerms, requirePerm } from "@/lib/access";
import { prisma } from "@/lib/db";
import { DOC_DIRECTION, DOC_TYPE, fmtDate } from "@/lib/labels";
import { getOrg } from "@/lib/org";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/PrintButton";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateOfficialDocument } from "../actions";

export const dynamic = "force-dynamic";

function dateInput(d?: Date | string | null) {
  if (!d) return "";
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export default async function OfficialDocView({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requirePerm("officialdocs.view");
  const { id } = await params;
  const sp = await searchParams;
  const perms = await currentPerms();
  const canManage = perms.has("officialdocs.manage");
  const [doc, patients, org] = await Promise.all([
    prisma.officialDocument.findUnique({
      where: { id },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true, phone: true } }, referralRequest: { select: { id: true } } },
    }),
    canManage ? prisma.patient.findMany({ where: { archivedAt: null }, select: { id: true, fullName: true, fileNumber: true }, orderBy: { fullName: "asc" }, take: 500 }) : Promise.resolve([]),
    getOrg(),
  ]);
  if (!doc) notFound();

  return (
    <div className="space-y-5">
      <PageHeader title="عرض وثيقة رسمية" subtitle={`${DOC_TYPE[doc.docType as keyof typeof DOC_TYPE]} - ${doc.number}`} icon="📄" />
      {sp.msg && <div className="no-print rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{sp.msg}</div>}
      {sp.err && <div className="no-print rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{sp.err}</div>}
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/official-docs" className="btn-ghost">رجوع للأرشيف</Link>
        <div className="flex flex-wrap gap-2">
          {doc.patient && <Link href={`/patients/${doc.patient.id}`} className="btn-ghost">ملف المراجع</Link>}
          {doc.attachmentUrl && <a href={doc.attachmentUrl} target="_blank" className="btn-ghost">فتح المرفق</a>}
          <PrintButton />
        </div>
      </div>

      <div id="report" className="card mx-auto max-w-3xl p-8">
        <div className="print-header border-b-2 border-brand-700 pb-4 text-center">
          {(org.officialHeader1 || org.officialHeader2 || org.officialHeader3) && <div className="text-sm font-semibold text-gray-700">{[org.officialHeader1, org.officialHeader2, org.officialHeader3].filter(Boolean).join(" - ")}</div>}
          <div className="text-2xl font-bold text-brand-900">{org.officialHeader4 || org.name}</div>
          {org.subtitle && <div className="text-sm text-gray-600">{org.subtitle}</div>}
          <div className="mt-1 text-xs text-gray-500">{[org.officialAddress || org.address, org.officialPhone || org.phone].filter(Boolean).join(" - ")}</div>
        </div>
        <div className="my-5 text-center">
          <div className="text-lg font-bold text-gray-900">وثيقة رسمية مؤرشفة</div>
          <div className="mt-1 text-sm text-gray-500">{DOC_TYPE[doc.docType as keyof typeof DOC_TYPE]} - {DOC_DIRECTION[doc.direction as keyof typeof DOC_DIRECTION]}</div>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="رقم الكتاب" value={doc.number} />
          <Info label="التاريخ" value={fmtDate(doc.docDate)} />
          <Info label="الجهة" value={doc.entity || "—"} />
          <Info label="المراجع" value={doc.patient ? `${doc.patient.fullName} - ملف #${doc.patient.fileNumber}` : "وثيقة عامة"} />
          <div className="sm:col-span-2"><Info label="الموضوع" value={doc.subject} /></div>
        </div>
        {doc.body && (
          <div className="mt-5 rounded-xl border border-gray-200 p-4 text-sm leading-7 text-gray-800">
            {doc.body}
          </div>
        )}
        {doc.attachmentUrl && <div className="mt-4 text-sm text-gray-600">المرفق محفوظ إلكترونياً داخل النظام.</div>}
      </div>

      {canManage && !doc.referralRequest && (
        <form action={updateOfficialDocument.bind(null, doc.id)} className="no-print card grid gap-3 p-4 md:grid-cols-4">
          <div className="md:col-span-4 font-semibold text-gray-700">تعديل بيانات الأرشفة</div>
          <div><label className="label">رقم الكتاب *</label><input name="number" className="input" defaultValue={doc.number} required /></div>
          <div><label className="label">التاريخ *</label><input name="docDate" type="date" className="input" defaultValue={dateInput(doc.docDate)} required /></div>
          <Combobox name="docType" label="النوع" allowFree={false} defaultValue={doc.docType} options={Object.entries(DOC_TYPE).map(([value, label]: any) => ({ value, label }))} />
          <Combobox name="direction" label="الاتجاه" allowFree={false} defaultValue={doc.direction} options={Object.entries(DOC_DIRECTION).map(([value, label]: any) => ({ value, label }))} />
          <div className="md:col-span-2"><label className="label">الموضوع *</label><input name="subject" className="input" defaultValue={doc.subject} required /></div>
          <div><label className="label">الجهة</label><input name="entity" className="input" defaultValue={doc.entity ?? ""} /></div>
          <Combobox name="patientId" label="المراجع المرتبط" allowFree={false} defaultValue={doc.patientId ?? ""} placeholder="وثيقة عامة" options={[{ value: "", label: "وثيقة عامة" }, ...patients.map((p: any) => ({ value: String(p.id), label: `${p.fullName} (#${p.fileNumber})` }))]} />
          <div className="md:col-span-3"><label className="label">ملاحظات</label><textarea name="body" className="input" rows={3} defaultValue={doc.body ?? ""} /></div>
          <div><label className="label">استبدال المرفق</label><input name="attachment" type="file" className="input" /></div>
          <div className="md:col-span-4"><button className="btn-primary" type="submit">حفظ التعديلات</button></div>
        </form>
      )}
      {doc.referralRequest && <div className="no-print rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">هذه الوثيقة مرتبطة بطلب إحالة وتُدار من صفحة الطلب.</div>}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 font-semibold text-gray-800">{value}</div>
    </div>
  );
}
