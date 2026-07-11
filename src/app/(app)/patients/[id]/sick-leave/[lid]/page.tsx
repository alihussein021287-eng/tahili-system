import { prisma } from "@/lib/db";
import { getOrg } from "@/lib/org";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtDate, fmtDateTime } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { requirePerm } from "@/lib/access";
import { refCode } from "@/lib/refcode";
import { qrSvg } from "@/lib/qr";

export const dynamic = "force-dynamic";

export default async function SickLeavePrint({ params }: { params: Promise<{ id: string; lid: string }> }) {
  await requirePerm("sickleave.view");
  const { id, lid } = await params;
  const org = await getOrg();
  const [patient, leave, approval] = await Promise.all([
    prisma.patient.findUnique({ where: { id }, include: { governorate: true, injuryType: true } }),
    prisma.sickLeave.findUnique({ where: { id: lid } }),
    prisma.reportApproval.findUnique({ where: { kind_refKey: { kind: "sick-leave", refKey: lid } } }),
  ]);
  if (!patient || !leave || leave.patientId !== id) notFound();
  const approverIds = [leave.approved1ById, leave.approved2ById, leave.approved3ById].filter(Boolean) as string[];
  const approvers = approverIds.length ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, fullName: true } }) : [];
  const approverName = (uid?: string | null) => approvers.find((u) => u.id === uid)?.fullName;
  const code = refCode(patient as any);
  const qr = await qrSvg(`${code}|SL:${leave.number ?? lid.slice(-6)}`);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/patients/${id}`} className="btn-ghost">↩ رجوع</Link>
        <PrintButton />
      </div>

      <div className="card space-y-6 p-8">
        <div className="flex items-start justify-between border-b-2 border-brand-600 pb-4">
          <div className="flex-1 text-center">
            <div className="text-2xl font-extrabold text-brand-800">{org.name}</div>
            {org.subtitle && <div className="text-sm text-gray-600">{org.subtitle}</div>}
            <div className="mt-2 inline-block rounded bg-brand-50 px-4 py-1 text-base font-bold text-brand-700">إجازة مرضية</div>
          </div>
          <div className="text-center">
            <div className="h-20 w-20" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="mt-1 font-mono text-[10px] font-bold text-gray-600">{code}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>الاسم: <b>{patient.fullName}</b></div>
          <div>رقم الملف: <b>#{patient.fileNumber}</b></div>
          <div>الرقم الرسمي: <b>{leave.number ?? "—"}</b></div>
          <div>تاريخ الإصدار: <b>{fmtDate(leave.createdAt)}</b></div>
          <div>المحافظة: <b>{patient.governorate?.name ?? "—"}</b></div>
          <div>نوع الإصابة: <b>{patient.injuryType?.name ?? "—"}</b></div>
        </div>

        <div className="rounded-xl border-2 border-gray-200 p-5 text-center">
          <p className="text-base leading-8 text-gray-800">
            تُمنح للمذكور أعلاه إجازة مرضية لمدة <b className="text-brand-700">{leave.days} يوم</b>
            <br />
            اعتباراً من <b>{fmtDate(leave.startDate)}</b> ولغاية <b>{fmtDate(leave.endDate)}</b>
          </p>
          <p className="mt-3 text-sm text-gray-600">استناداً إلى التشخيص: <b>{leave.diagnosisText}</b></p>
          {leave.notes && <p className="mt-1 text-xs text-gray-500">{leave.notes}</p>}
        </div>

        {approval ? (
          <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3 text-center text-sm text-emerald-800">
            <b>✔ معتمدة إلكترونياً</b> — {approval.approvedBy}{approval.title ? ` (${approval.title})` : ""} • {fmtDateTime(approval.approvedAt)}
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 p-2 text-center text-xs text-amber-700 print:hidden">غير معتمدة بعد — تُعتمد من ملف المراجع، تبويب الإجازات المرضية.</div>
        )}

        {(leave.committee1 || leave.committee2 || leave.committee3) && (
          <div className="pt-4">
            <div className="mb-2 text-center text-sm font-semibold text-gray-700">لجنة المصادقة الطبية</div>
            <div className="grid grid-cols-3 gap-6 text-center text-sm">
              {[
                { n: leave.committee1, a: leave.approved1At, by: approverName(leave.approved1ById) },
                { n: leave.committee2, a: leave.approved2At, by: approverName(leave.approved2ById) },
                { n: leave.committee3, a: leave.approved3At, by: approverName(leave.approved3ById) },
              ].filter((c) => c.n).map((c, i) => (
                <div key={i} className="border-t border-gray-400 pt-2">
                  <b>{c.n}</b><br />
                  <span className="text-xs text-gray-500">{c.a ? "✔ صادق إلكترونياً" : "التوقيع"}</span>
                  {c.a && c.by && <div className="text-[11px] text-gray-500">بواسطة {c.by}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-8 pt-6 text-center text-sm">
          <div className="border-t border-gray-400 pt-2">الطبيب الموصي<br /><b>{leave.doctorName ?? ""}</b></div>
          <div className="border-t border-gray-400 pt-2">ختم وتوقيع المدير</div>
        </div>
      </div>
    </div>
  );
}
