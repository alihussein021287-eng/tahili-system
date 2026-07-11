import { prisma } from "@/lib/db";
import { refCode } from "@/lib/refcode";
import { notFound } from "next/navigation";
import { PATIENT_STATUS, THERAPY, CONFIRM_STATUS, fmtDate, fmtTime } from "@/lib/labels";
import { respondAppointment } from "./actions";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function Portal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const patient = await prisma.patient.findUnique({
    where: { accessToken: token },
    select: {
      id: true,
      fullName: true,
      fileNumber: true,
      createdAt: true,
      status: true,
      governorate: { select: { name: true } },
      appointments: {
        where: { status: "SCHEDULED", scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        take: 10,
        select: { id: true, type: true, therapyType: true, scheduledAt: true, patientResponse: true },
      },
      careStages: {
        orderBy: { sequence: "asc" },
        select: { id: true, station: true, status: true, confirmedAt: true },
      },
    },
  });
  if (!patient) notFound();

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-xl bg-brand-700 p-5 text-center text-white">
          <div className="text-lg font-bold">المجمع التأهيلي الطبي</div>
          <div className="text-sm text-brand-100">بوابة المراجع</div>
        </div>

        <div className="rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-800">{patient.fullName}</h1>
            </div>
            <div className="text-left"><span className="rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-700">ملف #{patient.fileNumber}</span><div className="mt-1 font-mono text-xs text-gray-400">{refCode(patient as any)}</div></div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400">الحالة:</span> <b>{PATIENT_STATUS[patient.status as keyof typeof PATIENT_STATUS]}</b></div>
            <div><span className="text-gray-400">المحافظة:</span> <b>{patient.governorate?.name ?? "—"}</b></div>
          </div>
        </div>

        {patient.careStages.length > 0 && (() => {
          const stages = patient.careStages;
          const M: any = { WAITING: ["بالانتظار", "bg-gray-300", "bg-gray-100 text-gray-600"], IN_PROGRESS: ["قيد التنفيذ", "bg-amber-500", "bg-amber-100 text-amber-700"], CONFIRMED: ["مكتملة", "bg-emerald-600", "bg-emerald-100 text-emerald-700"], SKIPPED: ["متجاوَزة", "bg-gray-300", "bg-gray-100 text-gray-400"] };
          const done = stages.filter((s: any) => s.status === "CONFIRMED").length;
          const cur = stages.find((s: any) => s.status === "WAITING" || s.status === "IN_PROGRESS");
          return (
            <div className="rounded-xl border bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-gray-700">مسار متابعتك</h2>
                <span className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700">{cur ? `الآن: ${cur.station}` : "مكتمل ✔"} • {done}/{stages.length}</span>
              </div>
              <ol className="relative border-r-2 border-gray-200 pr-5">
                {stages.map((st: any) => {
                  const m = M[st.status] || M.WAITING;
                  return (
                    <li key={st.id} className="relative mb-4">
                      <span className={`absolute -right-[27px] top-1 h-3.5 w-3.5 rounded-full ring-4 ring-white ${m[1]}`} />
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-800">{st.station}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m[2]}`}>{m[0]}</span>
                      </div>
                      {st.status === "CONFIRMED" && st.confirmedAt && <div className="text-[11px] text-gray-400">{new Date(st.confirmedAt).toLocaleDateString("ar")}</div>}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })()}

        <div className="rounded-xl border bg-white p-5">
          <h2 className="mb-3 font-semibold text-gray-700">المواعيد القادمة</h2>
          {patient.appointments.length === 0 ? <p className="text-sm text-gray-400">لا مواعيد قادمة.</p> : (
            <ul className="space-y-2">
              {patient.appointments.map((a) => (
                <li key={a.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <div className="flex justify-between">
                    <span>{a.type || (a.therapyType ? THERAPY[a.therapyType as keyof typeof THERAPY] : "موعد")}</span>
                    <span className="font-medium">{fmtDate(a.scheduledAt)} — {fmtTime(a.scheduledAt)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {(a as any).patientResponse ? (
                      <span className={`rounded px-2 py-0.5 text-xs ${(a as any).patientResponse === "CONFIRMED" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{CONFIRM_STATUS[(a as any).patientResponse as keyof typeof CONFIRM_STATUS]}</span>
                    ) : (
                      <>
                        <form action={respondAppointment.bind(null, token, a.id, "CONFIRMED")}><button className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700">أؤكّد الحضور</button></form>
                        <form action={respondAppointment.bind(null, token, a.id, "CANCELLED")}><button className="rounded bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200">ألغي الموعد</button></form>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-center"><PrintButton /></div>
        <p className="text-center text-xs text-gray-400">هذه صفحة خاصة بك — لا تشاركها مع أحد.</p>
      </div>
    </div>
  );
}
