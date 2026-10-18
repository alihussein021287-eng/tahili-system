import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { PHARMACY_NAV } from "@/lib/hub-nav";
import { fmtDate } from "@/lib/labels";
import { createPurchaseOrder } from "./actions";
import { currentStockViewer, orderViewWhere } from "@/lib/pharmacy-stock";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "مسودة", cls: "bg-gray-100 text-gray-600" },
  PENDING_APPROVAL: { label: "بانتظار الاعتماد", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "معتمد", cls: "bg-sky-50 text-sky-700" },
  ORDERED: { label: "مطلوب من المورد", cls: "bg-brand-50 text-brand-700" },
  PARTIALLY_RECEIVED: { label: "مستلم جزئياً", cls: "bg-orange-50 text-orange-700" },
  FULLY_RECEIVED: { label: "مستلم بالكامل", cls: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "ملغى", cls: "bg-red-50 text-red-700" },
};
const CLOSED = ["FULLY_RECEIVED", "CANCELLED"];

function day(value: string | undefined, end = false) {
  if (!value) return undefined;
  const parsed = new Date(`${value}T${end ? "23:59:59" : "00:00:00"}`);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

type Search = { q?: string; status?: string; supplier?: string; from?: string; to?: string };

/** The one list of purchase orders, with the form to start a new one folded above it. */
export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const perms = await requirePerm("pharmacy.purchase.view");
  const sp = await searchParams;
  const canPrices = perms.has("pharmacy.purchase.prices");

  const where: any = {};
  if (sp.status && sp.status in STATUS) where.status = sp.status;
  else if (sp.status === "open") where.status = { notIn: CLOSED };
  const supplierId = Number(sp.supplier);
  if (sp.supplier && Number.isInteger(supplierId)) where.supplierId = supplierId;
  const from = day(sp.from);
  const to = day(sp.to, true);
  if (from || to) where.orderDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const q = sp.q?.trim();
  if (q) where.OR = [{ orderNo: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }];

  where.AND = [orderViewWhere(await currentStockViewer())];
  const [orders, suppliers] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: true,
        createdBy: { select: { fullName: true } },
        _count: { select: { items: true, receipts: true } },
        items: { select: { orderedQuantity: true, unitPrice: canPrices } },
      },
      orderBy: [{ status: "asc" }, { expectedDeliveryDate: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  const activeCount = [sp.status, sp.supplier, sp.from, sp.to].filter(Boolean).length;

  return (
    <div className="space-y-5">
      <PageHeader title="أوامر الشراء" subtitle="الطلب والاعتماد والتوريد والاستلام" icon="🧾" />
      <HubTabs nav={PHARMACY_NAV} active="purchases" label="تبويبات الصيدلية والمخزون" perms={perms} />

      {perms.has("pharmacy.purchase.create") ? (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold text-gray-700">+ إنشاء أمر شراء</summary>
          <form action={createPurchaseOrder} className="mt-3 grid gap-3 md:grid-cols-2" encType="multipart/form-data" autoComplete="off">
            <label className="label">المورد<select name="supplierId" className="input mt-1" required><option value="">اختر المورد</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label className="label">التسليم المتوقع<input name="expectedDeliveryDate" type="date" className="input mt-1" /></label>
            <label className="label md:col-span-2">الملاحظات<textarea name="notes" className="input mt-1" rows={2} /></label>
            <label className="label">مرفق<input name="attachment" type="file" className="input mt-1" /></label>
            <div className="self-end"><button className="btn-primary">إنشاء المسودة</button></div>
          </form>
        </details>
      ) : null}

      <FilterBar action="/pharmacy/purchases" query={sp.q} placeholder="رقم الأمر، المورد، أو ملاحظة…" activeCount={activeCount} clearHref="/pharmacy/purchases">
        <label className="label">الحالة<select name="status" defaultValue={sp.status ?? ""} className="input mt-1">
          <option value="">كل الحالات</option>
          <option value="open">المفتوحة فقط</option>
          {Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
        </select></label>
        <label className="label">المورّد<select name="supplier" defaultValue={sp.supplier ?? ""} className="input mt-1"><option value="">كل الموردين</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label className="label">من<input name="from" type="date" defaultValue={sp.from ?? ""} className="input mt-1" /></label>
        <label className="label">إلى<input name="to" type="date" defaultValue={sp.to ?? ""} className="input mt-1" /></label>
      </FilterBar>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="th">رقم الأمر</th><th className="th">المورّد</th><th className="th">الحالة</th><th className="th">التاريخ</th><th className="th">التسليم المتوقع</th><th className="th">البنود</th><th className="th">الاستلامات</th>{canPrices ? <th className="th">إجمالي تقديري</th> : null}</tr></thead>
          <tbody>
            {orders.map((order) => {
              const delayed = !!order.expectedDeliveryDate && order.expectedDeliveryDate < now && !CLOSED.includes(order.status);
              const total = order.items.reduce((sum, item: any) => sum + Number(item.unitPrice ?? 0) * item.orderedQuantity, 0);
              return (
                <tr key={order.id} className={delayed ? "bg-red-50/40 hover:bg-red-50" : order.status === "PARTIALLY_RECEIVED" ? "bg-orange-50/30 hover:bg-orange-50" : "hover:bg-gray-50"}>
                  <td className="td"><Link href={`/pharmacy/purchases/${order.id}`} className="font-medium text-brand-700 hover:underline">{order.orderNo}</Link><div className="text-xs text-gray-400">{order.createdBy?.fullName || "—"}</div></td>
                  <td className="td">{order.supplier.name}</td>
                  <td className="td"><span className={`badge ${STATUS[order.status]?.cls ?? ""}`}>{STATUS[order.status]?.label ?? order.status}</span></td>
                  <td className="td">{fmtDate(order.orderDate)}</td>
                  <td className={`td ${delayed ? "font-semibold text-red-700" : ""}`}>{fmtDate(order.expectedDeliveryDate)}{delayed ? " · متأخر" : ""}</td>
                  <td className="td">{order._count.items}</td>
                  <td className="td">{order._count.receipts}</td>
                  {canPrices ? <td className="td">{new Intl.NumberFormat("ar-IQ").format(total)} د.ع</td> : null}
                </tr>
              );
            })}
            {orders.length === 0 ? <tr><td colSpan={canPrices ? 8 : 7} className="td py-8 text-center text-gray-500">لا توجد أوامر شراء مطابقة.</td></tr> : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
