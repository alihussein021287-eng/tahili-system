import { prisma } from "@/lib/db";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { PharmacyNav } from "@/components/PharmacyNav";
import { StockGrid } from "@/components/StockGrid";
import { requirePerm, currentPerms, getSession } from "@/lib/access";
import { fmtDate } from "@/lib/labels";
import { createMedication, addSupplier, deleteSupplier } from "../actions";

export const dynamic = "force-dynamic";

function expiryState(d: Date | null, now: Date, soon: Date): "expired" | "soon" | "ok" | "none" {
  if (!d) return "none";
  const date = new Date(d);
  if (date < now) return "expired";
  if (date <= soon) return "soon";
  return "ok";
}

export default async function PharmacyStock({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePerm("pharmacy.view");
  const { q } = await searchParams;
  const perms = await currentPerms();
  const isAdminRole = ((await getSession())?.user as any)?.role === "ADMIN";
  const cBatch = perms.has("pharmacy.batch");

  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 86400000);

  const [meds, suppliers] = await Promise.all([
    prisma.medication.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : {},
      include: { batches: { include: { supplier: true }, orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { id: "asc" }] } },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="المخزون والدفعات" subtitle="إدارة المواد والدفعات والموردين" icon="📦" />
      <PharmacyNav />

      {/* الموردون */}
      {cBatch && (
        <div className="card p-4">
          <h2 className="mb-3 font-semibold text-gray-700">الموردون / جهات التجهيز</h2>
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
      )}

      {/* بحث + إضافة مادة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-gray-700">المواد والدفعات</h2>
        <form className="flex items-center gap-2">
          <input name="q" defaultValue={q ?? ""} placeholder="بحث عن مادة..." className="input !py-1 !w-52 text-sm" />
          <button className="btn-ghost text-sm" type="submit">بحث</button>
          {q && <Link href="/pharmacy/stock" className="text-sm text-gray-400 hover:underline">مسح</Link>}
        </form>
      </div>

      {cBatch && (
        <form action={createMedication} className="card flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 min-w-[180px]"><label className="label">مادة/دواء جديد</label><input name="name" className="input" placeholder="اسم المادة" required /></div>
          <div><label className="label">حد التنبيه</label><input name="minQuantity" type="number" defaultValue={0} className="input !w-24" /></div>
          <div><label className="label">الوحدة</label><input name="unit" className="input !w-28" placeholder="حبة/علبة..." /></div>
          <button className="btn-primary" type="submit">إضافة مادة</button>
        </form>
      )}

      {meds.length === 0
        ? <p className="card p-6 text-center text-sm text-gray-400">{q ? "لا نتائج للبحث." : "لا مواد بعد — أضف مادة ثم دفعاتها."}</p>
        : <StockGrid meds={JSON.parse(JSON.stringify(meds))} suppliers={suppliers} cBatch={cBatch} cDel={isAdminRole} />}
    </div>
  );
}
