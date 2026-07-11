import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms, getSession } from "@/lib/access";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

import { fmtTime, fmtDate } from "@/lib/labels";
import { checkIn, checkOut, deleteAttendance } from "./actions";

export const dynamic = "force-dynamic";
const SHIFT_LBL: Record<string, string> = { MORNING: "صباحية", EVENING: "مسائية", NIGHT: "ليلية", FULL: "دوام كامل" };
const LTYPE_LBL: Record<string, string> = { ANNUAL: "اعتيادية", SICK: "مرضية", EMERGENCY: "اضطرارية", UNPAID: "بدون راتب", OTHER: "أخرى" };

export default async function AttendancePage() {
  const session = await getSession();
  await requirePerm("attendance.view");
  const perms = await currentPerms();
  const isAdminRole = ((await getSession())?.user as any)?.role === "ADMIN";
  const editable = perms.has("attendance.manage");
  const startToday = new Date(new Date().toDateString());

  const tomorrow = new Date(startToday.getTime() + 86400000);
  const [employees, today, todayShifts, onLeave] = await Promise.all([
    prisma.employee.findMany({ orderBy: { name: "asc" } }),
    prisma.attendance.findMany({ where: { date: { gte: startToday } }, orderBy: { checkIn: "desc" } }),
    prisma.shift.findMany({ where: { date: { gte: startToday, lt: tomorrow } }, orderBy: { name: "asc" } }),
    prisma.leave.findMany({ where: { status: "APPROVED", fromDate: { lte: startToday }, toDate: { gte: startToday } }, orderBy: { name: "asc" } }),
  ]);
  const present = today.filter((a) => !a.checkOut).length;

  return (
    <div className="space-y-5">
      <PageHeader title="حضور الموظفين" subtitle={`حاضرون الآن: ${present}`} icon="🕒" />

      {(todayShifts.length > 0 || onLeave.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-4">
            <div className="mb-2 font-semibold text-gray-700">مناوبات اليوم</div>
            {todayShifts.length === 0 ? <p className="text-sm text-gray-400">لا مناوبات مجدولة لليوم.</p> :
              <div className="flex flex-wrap gap-2">{todayShifts.map((sh) => <span key={sh.id} className="badge-brand">{sh.name} · {SHIFT_LBL[sh.type]}</span>)}</div>}
          </div>
          <div className="card p-4">
            <div className="mb-2 font-semibold text-gray-700">في إجازة اليوم</div>
            {onLeave.length === 0 ? <p className="text-sm text-gray-400">لا أحد بإجازة اليوم.</p> :
              <div className="flex flex-wrap gap-2">{onLeave.map((lv) => <span key={lv.id} className="badge-warning">{lv.name} · {LTYPE_LBL[lv.type]}</span>)}</div>}
          </div>
        </div>
      )}

      {editable && (
        <form action={checkIn} className="card flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 min-w-[200px]">
            <label className="label">تسجيل حضور موظف</label>
<Combobox name="name" required placeholder="اختر الموظف" options={employees.map((e:any)=>e.name)} />
          </div>
          <button className="btn-primary" type="submit">✓ تسجيل حضور</button>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr><th className="th">الموظف</th><th className="th">التاريخ</th><th className="th">الحضور</th><th className="th">الانصراف</th><th className="th">الحالة</th>{editable && <th className="th"></th>}</tr></thead>
          <tbody>
            {today.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={6}>لا تسجيلات اليوم.</td></tr>}
            {today.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="td font-medium">{a.name}</td>
                <td className="td">{fmtDate(a.date)}</td>
                <td className="td">{a.checkIn ? fmtTime(a.checkIn) : "—"}</td>
                <td className="td">{a.checkOut ? fmtTime(a.checkOut) : "—"}</td>
                <td className="td">{a.checkOut ? <span className="badge-neutral">انصرف</span> : <span className="badge-success">حاضر</span>}</td>
                {editable && <td className="td">
                  <div className="flex items-center gap-2">
                    {!a.checkOut && <form action={checkOut.bind(null, a.id)}><button className="text-xs text-brand-700 hover:underline">تسجيل انصراف</button></form>}
                    {isAdminRole && <form action={deleteAttendance.bind(null, a.id)}><button className="text-red-400 hover:text-red-600" title="حذف">×</button></form>}
                  </div>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
