import { requirePerm } from "@/lib/access";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { ReportEditor } from "@/components/ReportEditor";
import { getOrg } from "@/lib/org";
import { currentPerms, getSession } from "@/lib/access";
import { fmtDate } from "@/lib/labels";
import { approvePatientReport, unapprovePatientReport } from "./actions";

export const dynamic = "force-dynamic";

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("patients.print");
  const { id } = await params;
  const p = await prisma.patient.findUnique({
    where: { id },
    include: {
      governorate: true, district: true, injuryType: true,
      diagnoses: { orderBy: { date: "desc" } },
      medicalReports: { orderBy: { date: "desc" } },
      therapySessions: { include: { center: true } },
      prescriptions: { include: { medication: true } },
      admissions: { include: { center: true }, orderBy: { admissionDate: "desc" } },
      treatmentPlans: { orderBy: { createdAt: "desc" } },
      woundAssessments: { orderBy: { assessmentDate: "desc" } },
      correspondence: { orderBy: { bookDate: "desc" } },
      relatives: true,
    },
  });
  if (!p) notFound();
  const org = await getOrg();
  const perms = await currentPerms();
  const session = await getSession();
  const canApprove = perms.has("reports.approve");
  const approvalRaw = await prisma.reportApproval.findUnique({ where: { kind_refKey: { kind: "patient-report", refKey: id } } });
  const approval = approvalRaw ? JSON.parse(JSON.stringify(approvalRaw)) : null;
  return (
    <div className="space-y-4">
      {canApprove && (
        <div className="no-print card p-4">
          {approval ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-gray-600">هذا التقرير معتمد بواسطة <b className="text-gray-800">{approval.approvedBy}</b>{approval.title ? ` (${approval.title})` : ""} بتاريخ {fmtDate(approval.approvedAt)}.</div>
              <form action={unapprovePatientReport.bind(null, id)}><button className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200">إلغاء الاعتماد</button></form>
            </div>
          ) : (
            <form action={approvePatientReport.bind(null, id)} className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3 font-semibold text-gray-700">اعتماد وتوقيع التقرير إلكترونياً</div>
              <div><label className="label">المعتمِد</label><input name="approvedBy" className="input" defaultValue={session?.user?.name ?? ""} required /></div>
              <div><label className="label">الصفة/المنصب</label><input name="title" className="input" placeholder="مثال: مدير المركز" /></div>
              <div className="flex items-end"><button className="btn-primary" type="submit">اعتماد وتوقيع</button></div>
            </form>
          )}
        </div>
      )}
      <ReportEditor p={p} org={org} approval={approval} />
    </div>
  );
}
