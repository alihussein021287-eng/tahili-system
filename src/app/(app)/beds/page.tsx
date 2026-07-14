import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms, getSession } from "@/lib/access";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

import Link from "next/link";
import { fmtDate } from "@/lib/labels";
import { addRoom, addBed, updateRoom, deleteRoom, assignBed } from "./actions";

export const dynamic = "force-dynamic";

export default async function Beds() {
  const session = await getSession();
  await requirePerm("beds.view");
  const perms = await currentPerms();
  const isAdminRole = ((await getSession())?.user as any)?.role === "ADMIN";
  const cManage = perms.has("beds.manage");
  const cAssign = perms.has("beds.assign");

  const [rooms, active] = await Promise.all([
    prisma.room.findMany({ include: { beds: { orderBy: { label: "asc" } } }, orderBy: { name: "asc" } }),
    prisma.admission.findMany({ where: { status: "ADMITTED" }, include: { patient: true, bed: true } }),
  ]);

  const totalBeds = rooms.reduce((a, r) => a + r.capacity, 0);
  const occupied = active.filter((a) => a.roomId != null).length;
  const unassigned = active.filter((a) => a.roomId == null);
  const free = Math.max(0, totalBeds - occupied);
  const pct = totalBeds > 0 ? Math.round((occupied / totalBeds) * 100) : 0;

  return (
    <div className="space-y-5">
      <PageHeader title="الرقود والفندقة" subtitle="إشغال الغرف ومتابعة الرقود" icon="🛏" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-5"><div className="text-2xl font-bold text-gray-800">{totalBeds}</div><div className="text-sm text-gray-500">إجمالي الأسرّة</div></div>
        <div className="card p-5"><div className="text-2xl font-bold text-amber-700">{occupied}</div><div className="text-sm text-gray-500">مشغولة</div></div>
        <div className="card p-5"><div className="text-2xl font-bold text-green-700">{free}</div><div className="text-sm text-gray-500">فارغة</div></div>
        <div className="card p-5">
          <div className="text-2xl font-bold text-brand-700">{pct}%</div>
          <div className="mb-1 text-sm text-gray-500">نسبة الإشغال</div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      {unassigned.length > 0 && (
        <div className="card border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 text-sm font-semibold text-amber-800">⚠ رقود بدون سرير مخصّص ({unassigned.length})</div>
          <div className="space-y-2">
            {unassigned.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2">
                <Link href={`/patients/${a.patientId}`} className="font-medium text-brand-700 hover:underline">{a.patient.fullName}</Link>
                {cAssign && (
                  <form action={assignBed.bind(null, a.id)} className="flex items-center gap-1">
                    <div className="w-52"><Combobox name="bedId" allowFree={false} placeholder="اختر سريراً"
                      options={rooms.flatMap((r: any) => r.beds.filter((b:any)=>!b.occupied).map((b:any) => ({ value: String(b.id), label: `${r.name} / ${b.label}` })))} /></div>
                    <button className="text-xs text-brand-700 hover:underline">تخصيص</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {cManage && (
        <form action={addRoom} className="card flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 min-w-[180px]"><label className="label">اسم الغرفة</label><input name="name" className="input" placeholder="مثال: غرفة 1 / جناح الرجال" /></div>
          <div><label className="label">عدد الأسرّة</label><input name="capacity" type="number" min="1" defaultValue={1} className="input !w-28" /></div>
          <div className="flex-1 min-w-[160px]"><label className="label">ملاحظات</label><input name="notes" className="input" /></div>
          <button className="btn-primary" type="submit">➕ إضافة غرفة</button>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rooms.length === 0 && <p className="text-sm text-gray-400">لا توجد غرف. أضف غرفة لتتبّع الإشغال.</p>}
        {rooms.map((room) => {
          const occ = active.filter((a) => a.roomId === room.id);
          const f = Math.max(0, room.capacity - occ.length);
          const p = room.capacity > 0 ? Math.round((occ.length / room.capacity) * 100) : 0;
          const full = occ.length >= room.capacity;
          return (
            <div key={room.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-gray-800">{room.name}</div>
                <span className={`badge ${full ? "bg-red-50 text-red-700" : f > 0 ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>{full ? "ممتلئة" : `${f} سرير فارغ`}</span>
              </div>
              <div className="mt-2 mb-1 flex justify-between text-xs text-gray-500"><span>{occ.length} / {room.capacity} مشغول</span><span>{p}%</span></div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${full ? "bg-red-500" : "bg-brand-600"}`} style={{ width: `${p}%` }} /></div>
              {room.notes && <div className="mt-1 text-xs text-gray-400">{room.notes}</div>}
              <div className="mt-3 space-y-1">
                {occ.length === 0 && <div className="text-xs text-gray-400">— لا يوجد راقدون —</div>}
                {occ.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-sm">
                    <Link href={`/patients/${a.patientId}`} className="text-brand-700 hover:underline">{a.patient.fullName}</Link>
                    <span className="text-xs text-gray-400">دخل {fmtDate(a.admissionDate)}</span>
                  </div>
                ))}
              </div>
              {cManage && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                  <form action={addBed.bind(null, room.id)} className="flex items-center gap-1">
                    <input name="label" className="input !w-24 !py-0.5 text-xs" placeholder="رقم السرير…" aria-label="رقم السرير" />
                    <button className="text-xs text-brand-700 hover:underline">إضافة سرير</button>
                  </form>
                  <form action={updateRoom.bind(null, room.id)} className="flex items-center gap-1">
                    <input name="capacity" type="number" min="1" defaultValue={room.capacity} className="input !w-16 !py-0.5 text-xs" title="عدد الأسرّة" />
                    <button className="text-xs text-brand-700 hover:underline">حفظ السعة</button>
                  </form>
                  {isAdminRole && <form action={deleteRoom.bind(null, room.id)}><button className="text-xs text-red-400 hover:text-red-600">حذف الغرفة</button></form>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
