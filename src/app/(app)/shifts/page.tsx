import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { currentPerms, requirePerm, getSession } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate } from "@/lib/labels";
import { addShift, deleteShift, requestLeave, setLeaveStatus, deleteLeave } from "./actions";

export const dynamic = "force-dynamic";

const SHIFT: Record<string, string> = { MORNING: "صباحية", EVENING: "مسائية", NIGHT: "ليلية", FULL: "دوام كامل" };
const LTYPE: Record<string, string> = { ANNUAL: "اعتيادية", SICK: "مرضية", EMERGENCY: "اضطرارية", UNPAID: "بدون راتب", OTHER: "أخرى" };
const LSTATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "قيد الموافقة", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "مقبولة", cls: "bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "مرفوضة", cls: "bg-red-50 text-red-700" },
};

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requirePerm("shifts.view");
  const sp = await searchParams;
  const perms = await currentPerms();
  const isAdminRole = ((await getSession())?.user as any)?.role === "ADMIN";
  const canManage = perms.has("shifts.manage");
  const canApprove = perms.has("shifts.approve");

  const today = new Date(new Date().toDateString());
  const weekEnd = new Date(today.getTime() + 7 * 86400000);

  const [users, weekShifts, leaves] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { fullName: true }, orderBy: { fullName: "asc" } }),
    prisma.shift.findMany({ where: { date: { gte: today, lt: weekEnd } }, orderBy: [{ date: "asc" }, { name: "asc" }] }),
    prisma.leave.findMany({ where: { toDate: { gte: today } }, orderBy: [{ status: "asc" }, { fromDate: "asc" }] }),
  ]);
  const names = Array.from(new Set(users.map((u) => u.fullName)));

  return (
    <div className="space-y-5">
      <PageHeader title="المناوبات والإجازات" subtitle="جدولة دوام الموظفين وإدارة الإجازات" icon="🗓" />
      {sp.saved && <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-800">{sp.saved}</div>}


      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={addShift} className="card grid gap-3 p-4">
            <div className="font-semibold text-gray-700">إضافة مناوبة</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Combobox name="name" label="الموظف" allowFree options={names} required /></div>
              <div><label className="label">التاريخ</label><input name="date" type="date" className="input" required /></div>
              <div><label className="label">النوع</label>
<Combobox name="type" allowFree={false} defaultValue="MORNING" options={Object.entries(SHIFT).map(([value,label]:any)=>({value,label}))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">من</label><input name="startTime" type="time" className="input" /></div>
                <div><label className="label">إلى</label><input name="endTime" type="time" className="input" /></div>
              </div>
            </div>
            <button className="btn-primary" type="submit">إضافة المناوبة</button>
          </form>

          <form action={requestLeave} className="card grid gap-3 p-4">
            <div className="font-semibold text-gray-700">طلب إجازة</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Combobox name="name" label="الموظف" allowFree options={names} required /></div>
              <div><label className="label">النوع</label>
<Combobox name="type" allowFree={false} defaultValue="ANNUAL" options={Object.entries(LTYPE).map(([value,label]:any)=>({value,label}))} />
              </div>
              <div><label className="label">من تاريخ</label><input name="fromDate" type="date" className="input" required /></div>
              <div><label className="label">إلى تاريخ</label><input name="toDate" type="date" className="input" required /></div>
              <div className="sm:col-span-2"><label className="label">السبب</label><input name="reason" className="input" /></div>
            </div>
            <button className="btn-primary" type="submit">تقديم الطلب</button>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-700">مناوبات الأسبوع <span className="text-gray-400">({weekShifts.length})</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">التاريخ</th><th className="th">الموظف</th><th className="th">النوع</th><th className="th">التوقيت</th>{canManage && <th className="th"></th>}</tr></thead>
            <tbody>
              {weekShifts.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={5}>لا مناوبات هذا الأسبوع.</td></tr>}
              {weekShifts.map((sh) => (
                <tr key={sh.id} className="hover:bg-gray-50">
                  <td className="td">{fmtDate(sh.date)}</td>
                  <td className="td font-medium text-gray-800">{sh.name}</td>
                  <td className="td">{SHIFT[sh.type]}</td>
                  <td className="td">{sh.startTime || "—"}{sh.endTime ? ` - ${sh.endTime}` : ""}</td>
                  {isAdminRole && <td className="td"><form action={deleteShift.bind(null, sh.id)}><button className="text-xs text-red-600 hover:underline">حذف</button></form></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-3 font-semibold text-gray-700">الإجازات الحالية والقادمة <span className="text-gray-400">({leaves.length})</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">الموظف</th><th className="th">النوع</th><th className="th">من</th><th className="th">إلى</th><th className="th">الحالة</th><th className="th"></th></tr></thead>
            <tbody>
              {leaves.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={6}>لا إجازات.</td></tr>}
              {leaves.map((lv) => (
                <tr key={lv.id} className="hover:bg-gray-50">
                  <td className="td font-medium text-gray-800">{lv.name}</td>
                  <td className="td">{LTYPE[lv.type]}{lv.reason ? ` — ${lv.reason}` : ""}</td>
                  <td className="td">{fmtDate(lv.fromDate)}</td>
                  <td className="td">{fmtDate(lv.toDate)}</td>
                  <td className="td"><span className={`badge ${LSTATUS[lv.status]?.cls}`}>{LSTATUS[lv.status]?.label}</span></td>
                  <td className="td">
                    <div className="flex gap-1.5">
                      {canApprove && lv.status === "PENDING" && (
                        <>
                          <form action={setLeaveStatus.bind(null, lv.id, "APPROVED")}><button className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700">قبول</button></form>
                          <form action={setLeaveStatus.bind(null, lv.id, "REJECTED")}><button className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700">رفض</button></form>
                        </>
                      )}
                      {isAdminRole && <form action={deleteLeave.bind(null, lv.id)}><button className="px-2 py-1 text-xs text-gray-400 hover:text-red-600">حذف</button></form>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
