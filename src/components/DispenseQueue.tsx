"use client";
import { useState } from "react";
import Link from "next/link";
import { fmtDate } from "@/lib/labels";
import { dispensePrescription, rejectPrescription } from "@/app/(app)/pharmacy/actions";

type Rx = { id: string; medication: { name: string; quantity?: number; minQuantity?: number; unit?: string | null } | null; materialName: string | null; quantity: string | null; count: number | null; doctor: string | null; prescribedAt: string; status: string; dispensedQty: number };
type Group = { patient: { id: string; fullName: string; fileNumber: string }; items: Rx[] };

const rxNeed = (rx: Rx) => (rx.count && rx.count > 0 ? rx.count : parseInt((rx.quantity || "").match(/\d+/)?.[0] || "0", 10) || 1);

export function DispenseQueue({ groups, cDispense, cPrint }: { groups: Group[]; cDispense: boolean; cPrint: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = groups.find((g) => g.patient.id === openId) ?? null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {groups.map((g) => {
          const hasPartial = g.items.some((r) => r.status === "PARTIAL");
          return (
            <button key={g.patient.id} onClick={() => setOpenId(g.patient.id)}
              className="group relative flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-center transition hover:border-brand-300 hover:shadow-md">
              {hasPartial && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-amber-400" title="فيه وصفة جزئية" />}
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-xl group-hover:bg-brand-100">👤</span>
              <span className="line-clamp-2 text-sm font-semibold leading-tight text-gray-800">{g.patient.fullName}</span>
              <span className="text-[10px] text-gray-400">#{g.patient.fileNumber}</span>
              <span className="badge-brand">{g.items.length} وصفة</span>
            </button>
          );
        })}
        {groups.length === 0 && <p className="col-span-full py-8 text-center text-sm text-gray-400">لا توجد وصفات بانتظار التجهيز.</p>}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenId(null)}>
          <div className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl">👤</span>
                <Link href={`/patients/${open.patient.id}`} className="font-bold text-brand-700 hover:underline">{open.patient.fullName}</Link>
                <span className="text-xs text-gray-400">#{open.patient.fileNumber}</span>
                <span className="badge-brand">{open.items.length} وصفة</span>
              </div>
              <div className="flex items-center gap-2">
                {cPrint && open.items.length > 0 && <Link href={`/pharmacy/patient/${open.patient.id}`} className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">🖨 طباعة كل الوصفات</Link>}
                <button onClick={() => setOpenId(null)} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
              </div>
            </div>

            <div className="space-y-2.5 p-5">
              {open.items.length === 0 && <p className="py-6 text-center text-sm text-gray-400">تم تجهيز كل وصفات هذا المريض ✓</p>}
              {open.items.map((rx) => {
                const partial = rx.status === "PARTIAL";
                const need = rxNeed(rx);
                const remaining = Math.max(0, need - (rx.dispensedQty || 0));
                const stockQty = rx.medication?.quantity;
                const stockLow = stockQty !== undefined && stockQty <= (rx.medication?.minQuantity ?? 0);
                return (
                  <div key={rx.id} className="rounded-xl border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-gray-800">{rx.medication?.name ?? rx.materialName ?? "—"}</span>
                        {partial && <span className="badge-warning mr-2">صُرف {rx.dispensedQty}</span>}
                        <div className="mt-0.5 text-xs text-gray-400">
                          المطلوب: {rx.quantity || "—"} · المتبقي: {remaining || "—"} {rx.doctor ? `· ${rx.doctor}` : ""} · {fmtDate(rx.prescribedAt)}
                        </div>
                        {stockQty !== undefined && (
                          <div className={`mt-1 text-xs ${stockLow ? "text-red-700" : stockQty < remaining ? "text-amber-700" : "text-gray-500"}`}>
                            المتوفر بالمخزون: {stockQty}{rx.medication?.unit ? ` ${rx.medication.unit}` : ""}{stockQty < remaining ? " · غير كافٍ للصرف الكامل" : ""}
                          </div>
                        )}
                      </div>
                    </div>

                    {cDispense && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                        <form action={dispensePrescription.bind(null, rx.id)} className="flex items-center gap-1.5">
                          <label className="text-xs text-gray-500">الكمية الفعلية</label>
                          <input name="qty" type="number" min="1" defaultValue={remaining || need} className="input !w-20 !py-1 text-sm" />
                          <button name="partial" value="0" className="btn-primary !py-1.5 text-xs" type="submit">تجهيز كامل</button>
                          <button name="partial" value="1" className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-200" type="submit">جزئي</button>
                        </form>
                        <details className="relative mr-auto">
                          <summary className="cursor-pointer list-none rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100">رفض</summary>
                          <form action={rejectPrescription.bind(null, rx.id)} className="absolute left-0 z-10 mt-1 w-60 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                            <input name="reason" className="input !py-1 text-xs" placeholder="سبب الرفض" />
                            <button className="btn-ghost mt-1 w-full !py-1 text-xs text-red-600" type="submit">تأكيد الرفض</button>
                          </form>
                        </details>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
