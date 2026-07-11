"use client";
import { useState } from "react";
import { Combobox } from "@/components/Combobox";
import { fmtDate } from "@/lib/labels";
import { setMinQuantity, addBatch, updateBatch, deleteBatch, disposeBatch } from "@/app/(app)/pharmacy/actions";

type Batch = { id: number; batchNo: string | null; quantity: number; expiryDate: string | null; receivedAt: string; supplierId: number | null; supplier?: { name: string } | null };
type Med = { id: number; name: string; quantity: number; minQuantity: number; unit: string | null; batches: Batch[] };
type Supplier = { id: number; name: string };

function medState(m: Med, now: number, soon: number) {
  if (m.quantity <= 0) return { label: "نافد", cls: "bg-red-100 text-red-700", card: "border-red-300 bg-red-50/50" };
  if (m.quantity <= m.minQuantity) return { label: "منخفض", cls: "bg-amber-100 text-amber-800", card: "border-amber-300 bg-amber-50/40" };
  const hasExpired = m.batches.some((b) => b.quantity > 0 && expState(b.expiryDate, now, soon) === "expired");
  if (hasExpired) return { label: "فيه منتهي", cls: "bg-red-100 text-red-700", card: "border-red-200 bg-red-50/30" };
  const hasSoon = m.batches.some((b) => b.quantity > 0 && expState(b.expiryDate, now, soon) === "soon");
  if (hasSoon) return { label: "قريب النفاذ", cls: "bg-amber-100 text-amber-800", card: "border-amber-200 bg-amber-50/30" };
  return { label: "جيد", cls: "bg-emerald-100 text-emerald-700", card: "border-gray-200 bg-white hover:border-brand-300" };
}

function expState(d: string | null, now: number, soon: number) {
  if (!d) return "none";
  const t = new Date(d).getTime();
  if (t < now) return "expired";
  if (t <= soon) return "soon";
  return "ok";
}

export function StockGrid({ meds, suppliers, cBatch, cDel = false }: { meds: Med[]; suppliers: Supplier[]; cBatch: boolean; cDel?: boolean }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const now = Date.now();
  const soon = now + 60 * 86400000;
  const open = meds.find((m) => m.id === openId) ?? null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {meds.map((m) => {
          const state = medState(m, now, soon);
          const hasExpired = m.batches.some((b) => b.quantity > 0 && expState(b.expiryDate, now, soon) === "expired");
          const hasSoon = m.batches.some((b) => b.quantity > 0 && expState(b.expiryDate, now, soon) === "soon");
          return (
            <button key={m.id} onClick={() => setOpenId(m.id)}
              className={`group relative flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition hover:shadow-md ${state.card}`}>
              {(hasExpired || hasSoon) && <span className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full ${hasExpired ? "bg-red-500" : "bg-amber-400"}`} title={hasExpired ? "دفعة منتهية" : "دفعة قريبة النفاذ"} />}
              <span className={`flex h-11 w-11 items-center justify-center rounded-full text-xl ${m.quantity <= m.minQuantity ? "bg-red-100" : "bg-brand-50 group-hover:bg-brand-100"}`}>💊</span>
              <span className="line-clamp-2 text-sm font-semibold leading-tight text-gray-800">{m.name}</span>
              <span className={`badge ${state.cls}`}>{state.label}</span>
              <span className="text-xs font-bold text-gray-700">{m.quantity}{m.unit ? ` ${m.unit}` : ""}</span>
              <span className="text-[10px] text-gray-400">{m.batches.length} دفعة · حد التنبيه {m.minQuantity}</span>
            </button>
          );
        })}
        {meds.length === 0 && <p className="col-span-full py-8 text-center text-sm text-gray-400">لا مواد لعرضها.</p>}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenId(null)}>
          <div className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* رأس النافذة */}
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl">💊</span>
                <span className="font-bold text-gray-800">{open.name}</span>
                <span className={`badge ${open.quantity <= open.minQuantity ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>المتوفّر: {open.quantity}{open.unit ? ` ${open.unit}` : ""}</span>
                {open.quantity <= open.minQuantity && <span className="badge-danger">تحت حد التنبيه ({open.minQuantity})</span>}
                <span className={`badge ${medState(open, now, soon).cls}`}>{medState(open, now, soon).label}</span>
              </div>
              <button onClick={() => setOpenId(null)} className="text-2xl leading-none text-gray-400 hover:text-gray-700">×</button>
            </div>

            <div className="space-y-4 p-5">
              {cBatch && (
                <form action={setMinQuantity.bind(null, open.id)} className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
                  <div><label className="label">حد التنبيه</label><input name="minQuantity" type="number" defaultValue={open.minQuantity} className="input !w-24" /></div>
                  <div><label className="label">الوحدة</label><input name="unit" defaultValue={open.unit ?? ""} className="input !w-28" placeholder="حبة/علبة..." /></div>
                  <button className="btn-ghost text-sm" type="submit">حفظ الإعدادات</button>
                </form>
              )}

              {/* الدفعات */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-600">الدفعات ({open.batches.length})</h3>
                <div className="space-y-2">
                  {open.batches.map((b) => {
                    const st = expState(b.expiryDate, now, soon);
                    const ring = st === "expired" ? "border-red-300 bg-red-50/50" : st === "soon" ? "border-amber-300 bg-amber-50/50" : "border-gray-200 bg-white";
                    const stLabel = b.quantity <= 0 ? "نافدة" : st === "expired" ? "منتهية" : st === "soon" ? "قريبة النفاذ" : "جيدة";
                    const stCls = b.quantity <= 0 || st === "expired" ? "bg-red-100 text-red-700" : st === "soon" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700";
                    return (
                      <div key={b.id} className={`flex flex-wrap items-end gap-2 rounded-lg border p-2.5 ${ring}`}>
                        <span className={`self-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${stCls}`}>{stLabel}</span>
                        {cBatch ? (
                          <>
                            <form action={updateBatch.bind(null, b.id)} className="flex flex-1 flex-wrap items-end gap-2">
                              <label className="block"><span className="mb-0.5 block text-[10px] text-gray-400">رقم الدفعة</span><input name="batchNo" defaultValue={b.batchNo ?? ""} className="input !w-24 !py-1 text-xs" placeholder="—" /></label>
                              <label className="block"><span className="mb-0.5 block text-[10px] text-gray-400">الكمية</span><input name="quantity" type="number" defaultValue={b.quantity} className="input !w-20 !py-1 text-xs" /></label>
                              <label className="block"><span className="mb-0.5 block text-[10px] text-gray-400">النفاذية{st === "expired" ? " · منتهية" : st === "soon" ? " · قريبة" : ""}</span><input name="expiryDate" type="date" defaultValue={b.expiryDate ? new Date(b.expiryDate).toISOString().slice(0, 10) : ""} className={`input !w-36 !py-1 text-xs ${st === "expired" ? "!border-red-300 !text-red-700" : st === "soon" ? "!border-amber-300 !text-amber-700" : ""}`} /></label>
                              <label className="block"><span className="mb-0.5 block text-[10px] text-gray-400">المورّد</span><Combobox name="supplierId" allowFree={false} defaultValue={b.supplierId ? String(b.supplierId) : ""} placeholder="—" options={suppliers.map((x:any)=>({value:String(x.id),label:x.name}))} /></label>
                              <button className="btn-primary !py-1.5 text-xs" type="submit">حفظ</button>
                            </form>
                            <div className="flex items-center gap-1.5">
                              {b.quantity > 0 && <form action={disposeBatch.bind(null, b.id)}><button className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-200" title="إتلاف المتبقّي">إتلاف</button></form>}
                              {cDel && <form action={deleteBatch.bind(null, b.id)}><button className="btn-danger-soft btn-sm" title="حذف الدفعة">حذف</button></form>}
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                            <span className="text-gray-500">رقم: <span className="text-gray-800">{b.batchNo || "—"}</span></span>
                            <span className="text-gray-500">الكمية: <b className="text-gray-800">{b.quantity}</b></span>
                            <span className={st === "expired" ? "font-bold text-red-700" : st === "soon" ? "text-amber-700" : "text-gray-500"}>النفاذية: {b.expiryDate ? fmtDate(b.expiryDate) : "—"}{st === "expired" ? " ⚠ منتهية" : st === "soon" ? " ⚠ قريبة" : ""}</span>
                            <span className="text-gray-500">المورّد: <span className="text-gray-800">{b.supplier?.name || "—"}</span></span>
                          </div>
                        )}
                        <span className="self-center text-[10px] text-gray-400">أُدخلت {fmtDate(b.receivedAt)}</span>
                      </div>
                    );
                  })}
                  {open.batches.length === 0 && <p className="rounded-lg border border-dashed border-gray-200 py-5 text-center text-sm text-gray-400">لا دفعات بعد — أضف دفعة من الأسفل.</p>}
                </div>
              </div>

              {cBatch && (
                <form action={addBatch.bind(null, open.id)} className="flex flex-wrap items-end gap-2 rounded-lg bg-brand-50/50 p-3">
                  <div><label className="label">رقم الدفعة</label><input name="batchNo" className="input !w-24" placeholder="اختياري" /></div>
                  <div><label className="label">الكمية</label><input name="quantity" type="number" defaultValue={0} className="input !w-20" /></div>
                  <div><label className="label">النفاذية</label><input name="expiryDate" type="date" className="input" /></div>
                  <div><label className="label">المورّد</label><Combobox name="supplierId" allowFree={false} placeholder="اختياري" options={suppliers.map((x:any)=>({value:String(x.id),label:x.name}))} /></div>
                  <div><label className="label">الاستلام</label><input name="receivedAt" type="date" className="input" /></div>
                  <button className="btn-primary !py-1.5 text-sm" type="submit">+ دفعة</button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
