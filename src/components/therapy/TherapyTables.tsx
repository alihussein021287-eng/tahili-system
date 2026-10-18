import Link from "next/link";
import type { ReactNode } from "react";
import { TableEmptyRow } from "@/components/Ui";
import { SERVICE_LABELS } from "@/lib/center-workspaces";
import { ADMISSION, APPT_STATUS, PLAN_STATUS, THERAPY, fmtDate, fmtDateTime, fmtTime } from "@/lib/labels";
import { evaluationDue } from "@/lib/therapy-plan-rules";

// Tables shared by the therapy pages (/therapy, /therapy/today, /centers, /beds) and the
// therapy overview, so each list looks the same wherever it appears.

export const CENTER_PROGRAM_STATUS: Record<string, string> = {
  ASSESSMENT: "تقييم",
  ACTIVE: "نشط",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغى",
};

export const CENTER_SESSION_STATUS: Record<string, string> = {
  SCHEDULED: "مجدولة",
  ATTENDED: "حضور مسجل",
  COMPLETED: "مكتملة",
  CANCELLED: "ملغاة",
  NO_SHOW: "لم يحضر",
};

export function badge(children: ReactNode, tone = "bg-gray-100 text-gray-600") {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{children}</span>;
}

export function emptyRow(colSpan: number, text = "لا توجد نتائج مطابقة.") {
  return <TableEmptyRow colSpan={colSpan} title={text} description="غيّر الفلاتر أو ستظهر السجلات هنا عند توفرها ضمن صلاحياتك." />;
}

export function PlanTable({ rows, compact }: { rows: any[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">المراجع</th><th className="th">الخطة</th><th className="th">المركز/القاعة</th><th className="th">المعالج</th>{!compact && <th className="th">المدة</th>}<th className="th">الحالة</th><th className="th">تنبيه</th></tr></thead>
        <tbody>
          {rows.map((plan) => {
            const due = evaluationDue(plan);
            const nearEnd = plan.status === "ACTIVE" && plan.expectedEndDate && plan.expectedEndDate < new Date(Date.now() + 7 * 86_400_000);
            return (
              <tr key={plan.id} className={due || nearEnd ? "bg-amber-50/40" : "hover:bg-gray-50"}>
                <td className="td"><Link href={`/patients/${plan.patientId}`} className="font-medium text-brand-700 hover:underline">{plan.patient.fullName}</Link><div className="text-xs text-gray-400">#{plan.patient.fileNumber}</div></td>
                <td className="td"><div className="font-medium">{plan.title}</div><div className="text-xs text-gray-400">{plan.therapyType ? THERAPY[plan.therapyType as keyof typeof THERAPY] : "عام"}</div></td>
                <td className="td">{plan.center?.name ?? "—"}{plan.hall?.name ? <div className="text-xs text-gray-400">{plan.hall.name}</div> : null}</td>
                <td className="td">{plan.therapist?.fullName ?? "—"}{plan.specialistDoctor?.fullName ? <div className="text-xs text-gray-400">الطبيب: {plan.specialistDoctor.fullName}</div> : null}</td>
                {!compact && <td className="td">{fmtDate(plan.startDate)} ← {fmtDate(plan.expectedEndDate)}</td>}
                <td className="td">{badge(PLAN_STATUS[plan.status as keyof typeof PLAN_STATUS] ?? plan.status, plan.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600")}</td>
                <td className="td"><div className="flex flex-wrap gap-1">{due ? badge("تقييم مستحق", "bg-orange-100 text-orange-800") : null}{nearEnd ? badge("قرب الانتهاء", "bg-amber-100 text-amber-800") : null}</div></td>
              </tr>
            );
          })}
          {rows.length === 0 && emptyRow(compact ? 6 : 7)}
        </tbody>
      </table>
    </div>
  );
}

export function TherapySessionTable({ rows }: { rows: any[] }) {
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">الخطة</th><th className="th">القاعة/المركز</th><th className="th">المعالج</th><th className="th">الحالة</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.status === "SCHEDULED" && row.scheduledAt < now ? "bg-red-50/40" : "hover:bg-gray-50"}>
              <td className="td">{fmtDateTime(row.scheduledAt)}</td>
              <td className="td"><Link href={`/patients/${row.patientId}`} className="font-medium text-brand-700 hover:underline">{row.patient.fullName}</Link><div className="text-xs text-gray-400">#{row.patient.fileNumber}</div></td>
              <td className="td">{row.session?.plan?.title ?? "جلسة علاج"}{row.session?.plan?.status ? <div className="text-xs text-gray-400">{PLAN_STATUS[row.session.plan.status as keyof typeof PLAN_STATUS] ?? row.session.plan.status}</div> : null}</td>
              <td className="td">{row.session?.therapyHall?.name || row.session?.hall || row.session?.center?.name || "—"}</td>
              <td className="td">{row.assignedToUser?.fullName || row.assignedTo || "—"}</td>
              <td className="td">{badge(APPT_STATUS[row.status as keyof typeof APPT_STATUS] ?? row.status, row.status === "SCHEDULED" ? "bg-sky-50 text-sky-700" : "bg-gray-100 text-gray-600")}</td>
            </tr>
          ))}
          {rows.length === 0 && emptyRow(6, "لا توجد جلسات ضمن النطاق.")}
        </tbody>
      </table>
    </div>
  );
}

export function CenterProgramTable({ rows }: { rows: any[] }) {
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الخدمة</th><th className="th">المسؤول</th><th className="th">النهاية المتوقعة</th><th className="th">الحالة</th><th className="th">تنبيه</th></tr></thead>
        <tbody>
          {rows.map((program) => {
            const overdue = program.status === "ACTIVE" && program.expectedEndDate && program.expectedEndDate < now;
            return (
              <tr key={program.id} className={overdue ? "bg-amber-50/50" : "hover:bg-gray-50"}>
                <td className="td"><Link href={`/patients/${program.patientId}`} className="font-medium text-brand-700 hover:underline">{program.patient.fullName}</Link><div className="text-xs text-gray-400">#{program.patient.fileNumber}</div></td>
                <td className="td">{program.center?.name ?? "—"}</td>
                <td className="td">{SERVICE_LABELS[program.serviceType] ?? program.serviceType}</td>
                <td className="td">{program.assignedTo?.fullName ?? "غير مسند"}</td>
                <td className="td">{fmtDate(program.expectedEndDate)}</td>
                <td className="td">{badge(CENTER_PROGRAM_STATUS[program.status] ?? program.status, program.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600")}</td>
                <td className="td">{overdue ? badge("متأخر", "bg-amber-100 text-amber-800") : program.sessions?.[0] ? `جلسة قادمة ${fmtDate(program.sessions[0].scheduledAt)}` : "—"}</td>
              </tr>
            );
          })}
          {rows.length === 0 && emptyRow(7, "لا توجد برامج ضمن الفلاتر.")}
        </tbody>
      </table>
    </div>
  );
}

export function CenterSessionTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الخدمة</th><th className="th">المورد</th><th className="th">المسؤول</th><th className="th">الحالة</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              <td className="td">{fmtTime(row.scheduledAt)}</td>
              <td className="td"><Link href={`/patients/${row.patientId}`} className="text-brand-700 hover:underline">{row.patient.fullName}</Link></td>
              <td className="td">{row.center?.name ?? "—"}</td>
              <td className="td">{SERVICE_LABELS[row.program?.serviceType] ?? row.program?.serviceType ?? "—"}</td>
              <td className="td">{row.resource?.name ?? "—"}</td>
              <td className="td">{row.assignedTo?.fullName ?? "—"}</td>
              <td className="td">{badge(CENTER_SESSION_STATUS[row.status] ?? row.status)}</td>
            </tr>
          ))}
          {rows.length === 0 && emptyRow(7, "لا توجد جلسات مراكز اليوم.")}
        </tbody>
      </table>
    </div>
  );
}

export function AdmissionsTable({ rows }: { rows: any[] }) {
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الغرفة/السرير</th><th className="th">الدخول</th><th className="th">الخروج المتوقع</th><th className="th">الحالة</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const overdue = row.expectedDischargeDate && row.expectedDischargeDate < now;
            return (
              <tr key={row.id} className={overdue ? "bg-red-50/40" : "hover:bg-gray-50"}>
                <td className="td"><Link href={`/patients/${row.patientId}`} className="font-medium text-brand-700 hover:underline">{row.patient.fullName}</Link><div className="text-xs text-gray-400">#{row.patient.fileNumber}</div></td>
                <td className="td">{row.center?.name ?? "—"}</td>
                <td className="td">{row.room?.name ?? "غير مخصص"}{row.bed?.label ? ` / ${row.bed.label}` : ""}</td>
                <td className="td">{fmtDate(row.admissionDate)}</td>
                <td className="td">{fmtDate(row.expectedDischargeDate)}</td>
                <td className="td">{badge(overdue ? "انتهت المدة" : ADMISSION[row.status as keyof typeof ADMISSION] ?? row.status, overdue ? "bg-red-100 text-red-800" : "bg-amber-50 text-amber-700")}</td>
              </tr>
            );
          })}
          {rows.length === 0 && emptyRow(6, "لا يوجد رقود نشط ضمن النطاق.")}
        </tbody>
      </table>
    </div>
  );
}

