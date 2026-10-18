import { prisma } from "@/lib/db";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StockGrid } from "@/components/StockGrid";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { currentPerms, getSession } from "@/lib/access";
import { redirect } from "next/navigation";
import { PHARMACY_NAV } from "@/lib/hub-nav";
import { expiryLevel } from "@/lib/pharmacy-expiry";
import { createMedication, addSupplier, deleteSupplier } from "../actions";
import { currentStockViewer, batchViewWhere } from "@/lib/pharmacy-stock";

export const dynamic = "force-dynamic";

const STATES: Record<string, string> = { low: "تحت حد التنبيه", out: "نافد", expiry: "فيه دفعة منتهية أو عاجلة أو قريبة", ok: "جيد" };

function medicationState(med: { quantity: number; minQuantity: number; batches: { quantity: number; expiryDate: Date | null }[] }, now: Date) {
  if (med.quantity <= 0) return "out";
  if (med.quantity <= med.minQuantity) return "low";
  if (med.batches.some((batch) => batch.quantity > 0 && ["expired", "urgent", "soon"].includes(expiryLevel(batch.expiryDate, now)))) return "expiry";
  return "ok";
}

/** The one medication list: every material with its batches, plus adding materials and suppliers. */
export default async function PharmacyStock({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const perms = await currentPerms();
  if (!perms.has("pharmacy.view") && !perms.has("inventory.view")) redirect("/");
  const { q, state } = await searchParams;
  const isAdminRole = (session?.user as any)?.role === "ADMIN";
  // Independent branch pharmacies: a pharmacist manages only own-branch batches; ADMIN sees every branch read-only.
  const viewer = await currentStockViewer();
  const cBatch = perms.has("pharmacy.batch") && !viewer?.isAdmin && viewer?.branchId != null;
  const cMaster = perms.has("pharmacy.batch");
  const now = new Date();
  const stateFilter = state && state in STATES ? state : "";

  const [medsRaw, suppliers] = await Promise.all([
    prisma.medication.findMany({
      where: q?.trim() ? { OR: [{ name: { contains: q.trim(), mode: "insensitive" } }, { unit: { contains: q.trim(), mode: "insensitive" } }] } : {},
      include: { batches: { where: batchViewWhere(viewer), include: { supplier: true }, orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { id: "asc" }] } },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
  ]);
  const medsBranch = medsRaw.map((med) => ({ ...med, quantity: med.batches.reduce((sum, batch) => sum + batch.quantity, 0) }));
  const meds = stateFilter ? medsBranch.filter((med) => medicationState(med, now) === stateFilter) : medsBranch;

  return (
    <div className="space-y-5">
      <PageHeader title="الأدوية والمخزون" subtitle={viewer?.isAdmin ? "مخزون كل الفروع — للقراءة فقط" : viewer?.branchId == null ? "لا يوجد فرع صيدلية مرتبط بحسابك: لا مخزون ولا عمليات" : "المواد ودفعات صيدلية فرعك والموردون"} icon="📦" />
      <HubTabs nav={PHARMACY_NAV} active="stock" label="تبويبات الصيدلية والمخزون" perms={perms} />

      <FilterBar action="/pharmacy/stock" query={q} placeholder="اسم المادة أو الوحدة…" activeCount={stateFilter ? 1 : 0} clearHref="/pharmacy/stock">
        <label className="label">الحالة<select name="state" defaultValue={stateFilter} className="input mt-1">
          <option value="">كل الحالات</option>
          {Object.entries(STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </FilterBar>

      {cMaster && (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold text-gray-700">+ مادة/دواء جديد</summary>
          <form action={createMedication} className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]"><label className="label">اسم المادة</label><input name="name" className="input" placeholder="اسم المادة" required /></div>
            <div><label className="label">حد التنبيه</label><input name="minQuantity" type="number" defaultValue={0} className="input !w-24" /></div>
            <div><label className="label">الوحدة</label><input name="unit" className="input !w-28" placeholder="حبة/علبة..." /></div>
            <button className="btn-primary" type="submit">إضافة مادة</button>
          </form>
        </details>
      )}

      {/* الموردون */}
      {cMaster && (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold text-gray-700">الموردون / جهات التجهيز ({suppliers.length})</summary>
          <div className="mt-3">
          <form action={addSupplier} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[160px]"><label className="label">اسم المورّد</label><input name="name" className="input" placeholder="اسم الجهة/المورّد" required /></div>
            <div><label className="label">الهاتف</label><input name="phone" className="input !w-36" placeholder="اختياري" /></div>
            <div className="flex-1 min-w-[140px]"><label className="label">ملاحظة</label><input name="note" className="input" placeholder="اختياري" /></div>
            <button className="btn-primary" type="submit">إضافة مورّد</button>
          </form>
          {suppliers.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {suppliers.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                  {s.name}{s.phone ? ` · ${s.phone}` : ""}
                  <form action={deleteSupplier.bind(null, s.id)}><button className="text-red-400 hover:text-red-600" title="حذف">×</button></form>
                </span>
              ))}
            </div>
          )}
          </div>
        </details>
      )}

      {meds.length === 0
        ? <p className="card p-6 text-center text-sm text-gray-400">{q || stateFilter ? "لا نتائج مطابقة." : "لا مواد بعد — أضف مادة ثم دفعاتها."}</p>
        : <StockGrid meds={JSON.parse(JSON.stringify(meds))} suppliers={suppliers} cBatch={cBatch} cDel={isAdminRole} />}
    </div>
  );
}
