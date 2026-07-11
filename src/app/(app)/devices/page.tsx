import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms } from "@/lib/access";
import Link from "next/link";
import { DEVICE_STATUS, fmtDate } from "@/lib/labels";
import { createDevice, recordMaintenance, markReplaced, deleteDevice, createMaintenanceTask } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_CLR: Record<string, string> = {
  DELIVERED: "bg-brand-50 text-brand-700", DUE: "bg-red-50 text-red-700",
  MAINTAINED: "bg-green-50 text-green-700", REPLACED: "bg-gray-100 text-gray-500",
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default async function Devices({ searchParams }: { searchParams: Promise<{ status?: string; patientId?: string; q?: string; due?: string; saved?: string }> }) {
  await requirePerm("devices.view");
  const perms = await currentPerms();
  const cCreate = perms.has("devices.create");
  const cMaintain = perms.has("devices.maintain");
  const cDelete = perms.has("devices.delete");
  const cTask = perms.has("tasks.create");
  const editable = cCreate || cMaintain || cDelete;
  const sp = await searchParams;
  const now = new Date();

  const where: any = {};
  if (sp.status) where.status = sp.status;
  if (sp.patientId) where.patientId = sp.patientId;
  if (sp.q) where.OR = [
    { patient: { fullName: { contains: sp.q, mode: "insensitive" } } },
    { type: { contains: sp.q, mode: "insensitive" } },
    { serialNo: { contains: sp.q, mode: "insensitive" } },
  ];
  if (sp.due) where.AND = [{ nextMaintenanceAt: { lte: now } }, { status: { not: "REPLACED" } }];

  const [devices, patients, total, dueCount, delivered, replaced, maintained] = await Promise.all([
    prisma.device.findMany({ where, include: { patient: true }, orderBy: [{ nextMaintenanceAt: "asc" }, { deliveredAt: "desc" }], take: 400 }),
    prisma.patient.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true, fileNumber: true } }),
    prisma.device.count(),
    prisma.device.count({ where: { nextMaintenanceAt: { lte: now }, status: { not: "REPLACED" } } }),
    prisma.device.count({ where: { status: "DELIVERED" } }),
    prisma.device.count({ where: { status: "REPLACED" } }),
    prisma.device.count({ where: { status: "MAINTAINED" } }),
  ]);

  const isDue = (d: any) => d.nextMaintenanceAt && new Date(d.nextMaintenanceAt) <= now && d.status !== "REPLACED";

  return (
    <div className="space-y-5">
      <PageHeader title="التسليم والصيانة" subtitle="الأجهزة والأطراف الصناعية" icon="🔧" />

      {sp.saved && <div className="rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-800">{sp.saved}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="card p-5"><div className="text-2xl font-bold text-gray-800">{total}</div><div className="text-sm text-gray-500">إجمالي الأجهزة المسلّمة</div></div>
        <Link href="/devices?due=1" className="card p-5 hover:ring-2 hover:ring-red-200"><div className="text-2xl font-bold text-red-700">{dueCount}</div><div className="text-sm text-gray-500">بحاجة صيانة الآن</div></Link>
        <Link href="/devices?status=DELIVERED" className="card p-5 hover:ring-2 hover:ring-brand-200"><div className="text-2xl font-bold text-brand-700">{delivered}</div><div className="text-sm text-gray-500">تم التسليم</div></Link>
        <div className="card p-5"><div className="text-2xl font-bold text-green-700">{maintained}</div><div className="text-sm text-gray-500">تمت صيانتها</div></div>
        <Link href="/devices?status=REPLACED" className="card p-5 hover:ring-2 hover:ring-gray-200"><div className="text-2xl font-bold text-gray-700">{replaced}</div><div className="text-sm text-gray-500">مستبدلة</div></Link>
      </div>

      {cCreate && (
        <form action={createDevice} className="card grid gap-3 p-4 md:grid-cols-3">
          <div>
            <Combobox name="patientId" label="المريض" required allowFree={false} defaultValue={sp.patientId ?? ""}
              options={patients.map((p: any) => ({ value: String(p.id), label: `${p.fullName} (#${p.fileNumber})` }))} />
          </div>
          <Combobox name="type" label="نوع الجهاز" options={["طرف صناعي", "كرسي متحرك", "كرسي كهربائي", "مشّاية", "عكازات", "سماعة طبية"]} />
          <div><label className="label">الرقم التسلسلي (اختياري)</label><input name="serialNo" className="input" /></div>
          <div><label className="label">تاريخ التسليم</label><input name="deliveredAt" type="date" className="input" defaultValue={todayISO()} /></div>
          <div><label className="label">موعد الصيانة القادمة (اختياري)</label><input name="nextMaintenanceAt" type="date" className="input" /></div>
          <div><label className="label">ملاحظات</label><input name="notes" className="input" /></div>
          <div className="md:col-span-3"><button className="btn-primary" type="submit">تسجيل تسليم جهاز</button></div>
        </form>
      )}

      <div className="card overflow-x-auto p-0">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm text-gray-500">تصفية:</span>
          <Link href="/devices" className={`badge ${!sp.status && !sp.due ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"}`}>الكل</Link>
          <Link href="/devices?due=1" className={`badge ${sp.due ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"}`}>بحاجة صيانة</Link>
          <Link href="/devices?status=DELIVERED" className={`badge ${sp.status === "DELIVERED" ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"}`}>تم التسليم</Link>
          <Link href="/devices?status=REPLACED" className={`badge ${sp.status === "REPLACED" ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"}`}>مستبدل</Link>
          <Link href="/devices?status=MAINTAINED" className={`badge ${sp.status === "MAINTAINED" ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"}`}>تمت صيانته</Link>
          <form action="/devices" className="ms-auto flex items-center gap-2">
            {sp.patientId && <input type="hidden" name="patientId" value={sp.patientId} />}
            <input name="q" defaultValue={sp.q ?? ""} className="input !py-1 !w-48" placeholder="بحث بالمريض أو الجهاز..." />
            <button className="text-xs text-brand-700 hover:underline" type="submit">بحث</button>
          </form>
        </div>
        {sp.patientId && (
          <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
            الفلتر الحالي حسب المراجع. <Link href="/devices" className="text-brand-700 hover:underline">عرض كل الأجهزة</Link>
          </div>
        )}
        <table className="min-w-full text-sm">
          <thead><tr>
            <th className="th">اسم الجهاز</th><th className="th">المراجع</th><th className="th">تاريخ التسليم</th>
            <th className="th">حالة الجهاز</th><th className="th">موعد الصيانة القادم</th><th className="th">ملاحظات</th>
            {(editable || cTask) && <th className="th">إجراء</th>}
          </tr></thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className={`hover:bg-gray-50 ${isDue(d) ? "bg-red-50/40" : ""}`}>
                <td className="td">
                  <div className="font-medium text-gray-800">{d.type}</div>
                  <div className="text-xs text-gray-400">{d.serialNo || "بدون رقم تسلسلي"}</div>
                </td>
                <td className="td">
                  <Link href={`/patients/${d.patientId}`} className="text-brand-700 hover:underline">{d.patient.fullName}</Link>
                  <div className="text-xs text-gray-400">ملف #{d.patient.fileNumber}</div>
                </td>
                <td className="td">{fmtDate(d.deliveredAt)}</td>
                <td className="td"><span className={`badge ${STATUS_CLR[d.status]}`}>{DEVICE_STATUS[d.status as keyof typeof DEVICE_STATUS]}</span></td>
                <td className={`td ${isDue(d) ? "font-bold text-red-700" : ""}`}>
                  {d.nextMaintenanceAt ? fmtDate(d.nextMaintenanceAt) : "—"}
                  {isDue(d) && <div className="mt-1 text-xs font-semibold text-red-700">متأخر/يحتاج صيانة</div>}
                </td>
                <td className="td max-w-xs text-gray-600">{d.notes || "—"}</td>
                {(editable || cTask) && (
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-2">
                      {cMaintain && d.status !== "REPLACED" && (
                        <form action={recordMaintenance.bind(null, d.id)} className="flex items-center gap-1">
                          <input name="nextMaintenanceAt" type="date" className="input !w-32 !py-1" title="موعد الصيانة القادمة" />
                          <button className="text-xs text-green-700 hover:underline" title="تسجيل صيانة">تمت الصيانة</button>
                        </form>
                      )}
                      {cMaintain && d.status !== "REPLACED" && <form action={markReplaced.bind(null, d.id)}><button className="text-xs text-amber-700 hover:underline">استبدال</button></form>}
                      {cTask && d.status !== "REPLACED" && <form action={createMaintenanceTask.bind(null, d.id)}><button className="text-xs text-brand-700 hover:underline">مهمة صيانة</button></form>}
                      {cDelete && <form action={deleteDevice.bind(null, d.id)}><button className="btn-icon-danger" title="حذف">×</button></form>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {devices.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={(editable || cTask) ? 7 : 6}>لا توجد أجهزة مسجّلة.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
