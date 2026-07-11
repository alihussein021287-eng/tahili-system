"use client";
import Link from "next/link";
import { Combobox } from "@/components/Combobox";
import { addCareRecord, deleteCareRecord } from "@/app/(app)/patients/actions";
import { CARE_PERIOD, CARE_KIND, fmtDate } from "@/lib/labels";

const PERIOD_CLR: Record<string, string> = { MORNING: "bg-amber-50 text-amber-700", EVENING: "bg-indigo-50 text-indigo-700", NIGHT: "bg-slate-100 text-slate-700" };
const KIND_CLR: Record<string, string> = { TREAT: "bg-sky-50 text-sky-700", DRESS: "bg-emerald-50 text-emerald-700", BOTH: "bg-brand-50 text-brand-700" };

export function CareSection({ rows = [], editable, patientId, medications = [], afterMutate }: any) {
  const w = (action: any) => async (fd: FormData) => { await action(fd); afterMutate?.(); };
  const sorted = [...rows].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-700">سجل التداوي والتضميد</h3>
        {rows.length > 0 && <Link href={`/patients/${patientId}/care-print`} className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">🖨 طباعة السجل</Link>}
      </div>

      {editable && (
        <form action={w(addCareRecord.bind(null, patientId))} className="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 md:grid-cols-4">
          <label className="text-xs text-gray-500">التاريخ<input name="date" type="date" className="input mt-1 w-full" /></label>
          <label className="text-xs text-gray-500">الفترة
            <Combobox name="period" allowFree={false} options={Object.entries(CARE_PERIOD).map(([value,label]:any)=>({value,label}))} />
          </label>
          <label className="text-xs text-gray-500">النوع
            <Combobox name="kind" allowFree={false} options={Object.entries(CARE_KIND).map(([value,label]:any)=>({value,label}))} />
          </label>
          <label className="text-xs text-gray-500">المنفّذ<input name="performedBy" className="input mt-1 w-full" placeholder="الممرض/المعالج" /></label>

          <label className="text-xs text-gray-500">المادة من المخزون
<Combobox name="medicationId" allowFree={false} placeholder="لا شيء" options={medications.map((m:any)=>({value:String(m.id),label:`${m.name}${typeof m.quantity==="number"?` (${m.quantity})`:""}`}))} />
          </label>
          <label className="text-xs text-gray-500">أو مادة (نص)<input name="materialName" className="input mt-1 w-full" placeholder="اسم المادة" /></label>
          <label className="text-xs text-gray-500">الكمية المستهلكة<input name="quantity" type="number" min="0" className="input mt-1 w-full" placeholder="تُخصم من المخزون" /></label>
          <label className="text-xs text-gray-500">موضع التضميد<input name="site" className="input mt-1 w-full" placeholder="الساق اليمنى..." /></label>

          <label className="col-span-2 text-xs text-gray-500">حالة الجرح / الوصف<input name="woundState" className="input mt-1 w-full" placeholder="نظيف / التهاب / تحسّن..." /></label>
          <label className="col-span-2 text-xs text-gray-500">ملاحظات<input name="notes" className="input mt-1 w-full" /></label>
          <button className="btn-primary md:col-span-1" type="submit">تسجيل</button>
        </form>
      )}

      {rows.length === 0 && <p className="text-sm text-gray-400">لا يوجد تداوي أو تضميد مُسجّل بعد.</p>}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="th">التاريخ</th><th className="th">الفترة</th><th className="th">النوع</th>
              <th className="th">المادة</th><th className="th">الكمية</th><th className="th">الموضع</th>
              <th className="th">حالة الجرح</th><th className="th">المنفّذ</th><th className="th">ملاحظات</th>{editable && <th className="th"></th>}
            </tr></thead>
            <tbody>
              {sorted.map((r: any) => {
                const med = medications.find((m: any) => m.id === r.medicationId);
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="td whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="td"><span className={`badge ${PERIOD_CLR[r.period] || ""}`}>{CARE_PERIOD[r.period as keyof typeof CARE_PERIOD]}</span></td>
                    <td className="td"><span className={`badge ${KIND_CLR[r.kind] || ""}`}>{CARE_KIND[r.kind as keyof typeof CARE_KIND]}</span></td>
                    <td className="td">{med?.name ?? r.materialName ?? "—"}</td>
                    <td className="td">{r.quantity ?? "—"}</td>
                    <td className="td">{r.site || "—"}</td>
                    <td className="td">{r.woundState || "—"}</td>
                    <td className="td">{r.performedBy || "—"}</td>
                    <td className="td">{r.notes || "—"}</td>
                    {editable && <td className="td"><form action={w(deleteCareRecord.bind(null, patientId, r.id))}><button className="btn-icon-danger" title="حذف">×</button></form></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
