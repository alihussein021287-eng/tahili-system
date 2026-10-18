import { prisma } from "@/lib/db";
import { requirePatientPageScope } from "@/lib/patient-guard";
import { getOrg } from "@/lib/org";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtDateTime, fmtDate } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { requirePerm } from "@/lib/access";
import { handoffParty, handoffStatusLabel } from "@/lib/patient-handoff-presentation";
import { derivePatientPath } from "@/lib/patient-path";
import { refCode } from "@/lib/refcode";
import { qrSvg } from "@/lib/qr";

export const dynamic = "force-dynamic";

const PATH_MARK: Record<string, string> = { complete: "✓", current: "●", pending: "○", skipped: "—" };

export default async function JourneyPrint({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("journey.view");
  const { id } = await params;
  await requirePatientPageScope(id, "record");
  const org = await getOrg();
  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      governorate: true,
      residentReviews: { select: { id: true } },
      diagnoses: { select: { type: true } },
      treatmentPlans: { select: { status: true } },
      centerPrograms: { select: { status: true } },
      therapySessionLogs: { select: { id: true } },
      appointments: { select: { status: true, scheduledAt: true } },
      handoffs: {
        orderBy: [{ sentAt: "asc" }, { id: "asc" }],
        include: { fromUser: { select: { fullName: true } }, toUser: { select: { fullName: true } }, acceptedBy: { select: { fullName: true } }, fromCenter: { select: { name: true } }, toCenter: { select: { name: true } } },
      },
    },
  });
  if (!patient) notFound();

  const code = refCode(patient as any);
  const qr = await qrSvg(code);
  // The same source as the patient file: the handoffs, with recorded work marking the earlier stages.
  const handoffs = patient.handoffs ?? [];
  const path = derivePatientPath(patient as any);
  const current = path.stages[path.currentIndex];

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
          <div>المرحلة الحالية: <span className="font-medium">{current?.label ?? "—"}</span></div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border border-gray-200 p-3 text-sm">
          {path.stages.map((stage) => (
            <span key={stage.key} className={stage.status === "current" ? "font-bold text-brand-800" : stage.status === "complete" ? "text-gray-800" : "text-gray-400"}>{PATH_MARK[stage.status]} {stage.label}</span>
          ))}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300 text-gray-600">
              <th className="py-2 text-right">#</th>
              <th className="py-2 text-right">من</th>
              <th className="py-2 text-right">إلى</th>
              <th className="py-2 text-right">الحالة</th>
              <th className="py-2 text-right">المستلم</th>
              <th className="py-2 text-right">وقت الإرسال</th>
            </tr>
          </thead>
          <tbody>
            {handoffs.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-gray-400">لا توجد تسليمات مسجلة.</td></tr>
            )}
            {handoffs.map((h, i) => (
              <tr key={h.id} className="border-b align-top">
                <td className="py-2">{i + 1}</td>
                <td className="py-2">{handoffParty(h.fromUser?.fullName, h.fromRole, h.fromCenter?.name)}</td>
                <td className="py-2 font-medium">{handoffParty(h.toUser?.fullName, h.toRole, h.toCenter?.name)}{h.note && <div className="text-xs font-normal text-gray-500">{h.note}</div>}</td>
                <td className="py-2">{handoffStatusLabel(h.status)}</td>
                <td className="py-2">{h.acceptedBy?.fullName ?? "—"}</td>
                <td className="py-2 whitespace-nowrap">{fmtDateTime(h.sentAt)}</td>
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
