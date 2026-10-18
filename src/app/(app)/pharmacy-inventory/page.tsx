import Link from "next/link";
import { maskOutOfScopeMovements, pharmacyPrescriptionWhere } from "@/lib/pharmacy-scope";
import { currentStockViewer, batchViewWhere, movementViewWhere, orderViewWhere, visibleQuantities } from "@/lib/pharmacy-stock";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminIntro, AdminSection, StatCard } from "@/components/AdminPageSections";
import { TableEmptyRow } from "@/components/Ui";
import { PageHeader } from "@/components/PageHeader";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { currentPerms, requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { PHARMACY_MOVED, PHARMACY_NAV, movedTabUrl } from "@/lib/hub-nav";
import { fmtDate, fmtDateTime, MOVE_TYPE } from "@/lib/labels";
import { EXPIRY_BADGE, EXPIRY_LABEL, EXPIRY_ROW, EXPIRY_SOON_DAYS, EXPIRY_URGENT_DAYS, expiryCutoffs, expiryLevel } from "@/lib/pharmacy-expiry";

export const dynamic = "force-dynamic";

type Search = Record<string, string | undefined>;
type PharmacyInventoryTab = "overview" | "batches" | "receipts" | "movements";

// The overview, batches, receipts and the movement log live here. Dispensing, stock, purchase
// orders and reports are their own pages (see PHARMACY_NAV), each with the same tab bar.
const TABS: { key: PharmacyInventoryTab; title: string; description: string; perms: string[] }[] = [
  { key: "overview", title: "لوحة الصيدلية والمخزون", description: "ما يحتاج متابعة اليوم: وصفات، نواقص، صلاحية، وشراء.", perms: ["pharmacy.view", "inventory.view", "pharmacy.purchase.view"] },
  { key: "batches", title: "الدفعات والصلاحية", description: `الأحمر «عاجل» ينتهي خلال ${EXPIRY_URGENT_DAYS} يوماً، والأصفر «قريب» خلال ${EXPIRY_SOON_DAYS} يوماً.`, perms: ["pharmacy.view", "inventory.view"] },
  { key: "receipts", title: "الاستلام", description: "سجل الاستلام المرتبط بأوامر الشراء والمورّدين ومستخدمي الإدخال.", perms: ["pharmacy.purchase.view"] },
  { key: "movements", title: "سجل الحركة", description: "حركات الإدخال والصرف والإتلاف والتعديل ضمن الفترة.", perms: ["pharmacy.view", "inventory.view"] },
];

const PURCHASE_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "مسودة", cls: "bg-gray-100 text-gray-600" },
  PENDING_APPROVAL: { label: "بانتظار الاعتماد", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "معتمد", cls: "bg-sky-50 text-sky-700" },
  ORDERED: { label: "مطلوب من المورد", cls: "bg-brand-50 text-brand-700" },
  PARTIALLY_RECEIVED: { label: "مستلم جزئياً", cls: "bg-orange-50 text-orange-700" },
  FULLY_RECEIVED: { label: "مستلم بالكامل", cls: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "ملغى", cls: "bg-red-50 text-red-700" },
};

const MOVE_TYPE_STYLE: Record<string, string> = {
  IN: "bg-emerald-50 text-emerald-700",
  DISPENSE: "bg-sky-50 text-sky-700",
  DISPOSE: "bg-red-50 text-red-700",
  ADJUST: "bg-amber-50 text-amber-700",
};

const DAY_MS = 86400000;
const OPEN_PURCHASE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"];
const CLOSED_PURCHASE_STATUSES = ["FULLY_RECEIVED", "CANCELLED"];

function hasAny(perms: Set<string>, keys: string[]) {
  return keys.some((key) => perms.has(key));
}

function dateStart(value?: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function dateEnd(value?: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function localDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateRange(from?: string, to?: string) {
  const start = dateStart(from);
  const end = dateEnd(to);
  return start || end ? { gte: start ?? undefined, lte: end ?? undefined } : undefined;
}

function numberValue(value: unknown) {
  return new Intl.NumberFormat("ar-IQ").format(Number(value ?? 0));
}

function emptyRow(colSpan: number, text = "لا توجد نتائج مطابقة.") {
  return <TableEmptyRow colSpan={colSpan} title={text} description="غيّر الفلاتر أو ستظهر السجلات هنا عند توفرها ضمن صلاحياتك." />;
}

function badge(label: string, cls = "bg-gray-100 text-gray-600") {
  return <span className={`badge ${cls}`}>{label}</span>;
}

function rxNeed(rx: { count: number | null; quantity: string | null }) {
  return rx.count && rx.count > 0 ? rx.count : parseInt((rx.quantity || "").match(/\d+/)?.[0] || "0", 10) || 1;
}

function isPurchaseDelayed(order: { expectedDeliveryDate: Date | null; status: string }, now: Date) {
  return !!order.expectedDeliveryDate && order.expectedDeliveryDate < now && !CLOSED_PURCHASE_STATUSES.includes(order.status);
}

export default async function PharmacyInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireSession();
  const sp = await searchParams;
  const moved = sp.tab ? movedTabUrl(PHARMACY_MOVED, sp.tab, sp) : null;
  if (moved) redirect(moved);
  const perms = await currentPerms();

  const canPharmacy = perms.has("pharmacy.view");
  const canInventory = perms.has("inventory.view");
  const canStock = canPharmacy || canInventory;
  const canPurchase = perms.has("pharmacy.purchase.view");
  const canPurchaseReceive = perms.has("pharmacy.purchase.receive");

  const visibleTabs = TABS.filter((tab) => hasAny(perms, tab.perms));
  if (!visibleTabs.length) redirect("/");
  const activeTab = (visibleTabs.some((tab) => tab.key === sp.tab) ? sp.tab : visibleTabs[0].key) as PharmacyInventoryTab;
  if (sp.tab && sp.tab !== activeTab) redirect(`/pharmacy-inventory?tab=${activeTab}`);
  const activeInfo = TABS.find((tab) => tab.key === activeTab)!;

  const now = new Date();
  const today = dateStart(localDateInput(now))!;
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const { urgent, soon } = expiryCutoffs(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const isOverview = activeTab === "overview";

  // Independent branch pharmacies: a branch account sees only its own pharmacy; ADMIN sees all branches (read-only).
  const viewer = await currentStockViewer();
  const bw = batchViewWhere(viewer);
  const mv = movementViewWhere(viewer);
  const ow = orderViewWhere(viewer);
  const rxw = await pharmacyPrescriptionWhere();
  const batchWhere: any = { quantity: { gt: 0 }, ...bw };
  const batchStateFilter = sp.batchState ?? "all";
  if (batchStateFilter === "expired") batchWhere.expiryDate = { not: null, lt: now };
  else if (batchStateFilter === "urgent") batchWhere.expiryDate = { not: null, gte: now, lte: urgent };
  else if (batchStateFilter === "soon") batchWhere.expiryDate = { not: null, gte: now, lte: soon };
  else if (batchStateFilter === "no_expiry") batchWhere.expiryDate = null;
  else {
    const range = dateRange(sp.expiryFrom, sp.expiryTo);
    if (range) batchWhere.expiryDate = range;
  }
  const batchSupplier = Number(sp.batchSupplier);
  if (sp.batchSupplier && Number.isInteger(batchSupplier)) batchWhere.supplierId = batchSupplier;
  const batchQ = (sp.batchQ ?? "").trim().toLowerCase();

  const receiptWhere: any = { purchaseOrder: ow };
  const receiptRange = dateRange(sp.receiptFrom, sp.receiptTo);
  if (receiptRange) receiptWhere.receivedAt = receiptRange;
  const receiptSupplier = Number(sp.receiptSupplier);
  if (sp.receiptSupplier && Number.isInteger(receiptSupplier)) receiptWhere.purchaseOrder = { ...ow, supplierId: receiptSupplier };
  if (sp.receiptOrder?.trim()) {
    receiptWhere.purchaseOrder = { ...(receiptWhere.purchaseOrder ?? {}), orderNo: { contains: sp.receiptOrder.trim(), mode: "insensitive" } };
  }

  const movementWhere: any = { ...mv };
  const movementRange = dateRange(sp.moveFrom ?? localDateInput(monthStart), sp.moveTo);
  if (movementRange) movementWhere.createdAt = movementRange;
  if (sp.moveType && sp.moveType in MOVE_TYPE) movementWhere.type = sp.moveType;
  const moveMedication = Number(sp.moveMedication);
  if (sp.moveMedication && Number.isInteger(moveMedication)) movementWhere.medicationId = moveMedication;
  const moveQ = (sp.moveQ ?? "").trim();
  if (moveQ) {
    movementWhere.OR = [
      { medication: { name: { contains: moveQ, mode: "insensitive" } } },
      { patientName: { contains: moveQ, mode: "insensitive" } },
      { reason: { contains: moveQ, mode: "insensitive" } },
    ];
  }

  const [
    medicationsForStats,
    suppliers,
    pendingRxCount,
    dispensedTodayCount,
    rxAlerts,
    urgentBatchCount,
    soonBatchCount,
    expiredBatchCount,
    batchRowsRaw,
    expiryAlerts,
    openPurchaseCount,
    partialPurchaseCount,
    openOrders,
    receipts,
    receiptCountThisMonth,
    movements,
  ] = await Promise.all([
    canStock && (isOverview || activeTab === "movements") ? prisma.medication.findMany({ select: { id: true, name: true, quantity: true, minQuantity: true, unit: true }, orderBy: { name: "asc" }, take: 1000 }) : Promise.resolve([]),
    canStock || canPurchase ? prisma.supplier.findMany({ orderBy: { name: "asc" }, take: 300 }) : Promise.resolve([]),
    canPharmacy && isOverview ? prisma.prescription.count({ where: { ...rxw, isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", visitId: { not: null } } }) : Promise.resolve(0),
    canPharmacy && isOverview ? prisma.prescription.count({ where: { ...rxw, isDispensed: true, dispensedAt: { gte: today, lt: tomorrow } } }) : Promise.resolve(0),
    canPharmacy && isOverview ? prisma.prescription.findMany({
      where: { ...rxw, isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", visitId: { not: null } },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, medication: { select: { id: true, name: true, quantity: true, minQuantity: true, unit: true } } },
      orderBy: { prescribedAt: "asc" },
      take: 8,
    }) : Promise.resolve([]),
    canStock && isOverview ? prisma.medicationBatch.count({ where: { ...bw, quantity: { gt: 0 }, expiryDate: { not: null, gte: now, lte: urgent } } }) : Promise.resolve(0),
    canStock && isOverview ? prisma.medicationBatch.count({ where: { ...bw, quantity: { gt: 0 }, expiryDate: { not: null, gt: urgent, lte: soon } } }) : Promise.resolve(0),
    canStock && isOverview ? prisma.medicationBatch.count({ where: { ...bw, quantity: { gt: 0 }, expiryDate: { not: null, lt: now } } }) : Promise.resolve(0),
    canStock && activeTab === "batches" ? prisma.medicationBatch.findMany({
      where: batchWhere,
      include: { medication: { select: { id: true, name: true, unit: true } }, supplier: true, purchaseOrder: { select: { id: true, orderNo: true, status: true } }, purchaseReceipt: { select: { id: true, receiptNo: true } } },
      orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { receivedAt: "desc" }],
      take: 500,
    }) : Promise.resolve([]),
    canStock && isOverview ? prisma.medicationBatch.findMany({
      where: { ...bw, quantity: { gt: 0 }, expiryDate: { not: null, lte: soon } },
      include: { medication: { select: { id: true, name: true, unit: true } } },
      orderBy: { expiryDate: "asc" },
      take: 8,
    }) : Promise.resolve([]),
    canPurchase && isOverview ? prisma.purchaseOrder.count({ where: { ...ow, status: { in: OPEN_PURCHASE_STATUSES as any } } }) : Promise.resolve(0),
    canPurchase && isOverview ? prisma.purchaseOrder.count({ where: { ...ow, status: "PARTIALLY_RECEIVED" } }) : Promise.resolve(0),
    canPurchase && isOverview ? prisma.purchaseOrder.findMany({
      where: { ...ow, status: { in: OPEN_PURCHASE_STATUSES as any } },
      include: { supplier: true },
      orderBy: [{ expectedDeliveryDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 8,
    }) : Promise.resolve([]),
    canPurchase && activeTab === "receipts" ? prisma.purchaseReceipt.findMany({
      where: receiptWhere,
      include: {
        purchaseOrder: { select: { id: true, orderNo: true, status: true, supplier: true } },
        createdBy: { select: { fullName: true } },
        items: { select: { acceptedQuantity: true, rejectedQuantity: true, damagedQuantity: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: 200,
    }) : Promise.resolve([]),
    canPurchase && isOverview ? prisma.purchaseReceipt.count({ where: { purchaseOrder: ow, receivedAt: { gte: monthStart } } }) : Promise.resolve(0),
    canStock && activeTab === "movements" ? prisma.stockMovement.findMany({
      where: movementWhere,
      include: { medication: { select: { id: true, name: true, unit: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }).then((rows) => maskOutOfScopeMovements(rows, Boolean(moveQ))) : Promise.resolve([]),
  ]);

  const branchQty = await visibleQuantities(viewer);
  const lowMedications = (medicationsForStats as any[]).map((medication) => ({ ...medication, quantity: branchQty.get(medication.id) ?? 0 })).filter((medication) => medication.quantity <= medication.minQuantity);
  // Stock beside a queued prescription = its ORIGIN branch dispensable stock.
  const rxStockRows = (rxAlerts as any[]).length ? await prisma.medicationBatch.groupBy({
    by: ["branchId", "medicationId"], _sum: { quantity: true },
    where: { medicationId: { in: (rxAlerts as any[]).map((r) => r.medicationId).filter((id: number | null) => id != null) }, branchId: { not: null }, quantity: { gt: 0 }, OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }] },
  }) : [];
  const rxStock = new Map(rxStockRows.map((r) => [`${r.branchId}:${r.medicationId}`, r._sum.quantity ?? 0]));
  for (const rx of rxAlerts as any[]) if (rx.medication) rx.medication = { ...rx.medication, quantity: rx.originBranchId == null ? 0 : rxStock.get(`${rx.originBranchId}:${rx.medicationId}`) ?? 0 };
  const batchRows = batchQ
    ? (batchRowsRaw as any[]).filter((batch) => [batch.batchNo, batch.medication?.name, batch.medication?.unit, batch.supplier?.name, batch.purchaseOrder?.orderNo, batch.purchaseReceipt?.receiptNo]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(batchQ)))
    : (batchRowsRaw as any[]);
  const supplierOptions = (suppliers as any[]).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>);
  const hiddenTab = (tab: string) => <input type="hidden" name="tab" value={tab} />;

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="الصيدلية والمخزون" subtitle="الوصفات، المخزون، الدفعات، الشراء، والاستلام" icon="💊" />
      <HubTabs nav={PHARMACY_NAV} active={activeTab} label="تبويبات الصيدلية والمخزون" perms={perms} />
      <AdminIntro title={activeInfo.title} description={activeInfo.description} />

      {isOverview ? (
        <>
          <section className="space-y-3" aria-labelledby="pharmacy-summary-title">
            <h2 id="pharmacy-summary-title" className="font-semibold text-gray-900">ملخص الصيدلية والمخزون</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {canPharmacy ? <StatCard label="وصفات بانتظار الصرف" value={pendingRxCount} tone="text-amber-700" /> : null}
              {canPharmacy ? <StatCard label="وصفات مصروفة اليوم" value={dispensedTodayCount} tone="text-emerald-700" /> : null}
              {canStock ? <StatCard label="أدوية ناقصة" value={lowMedications.length} tone="text-red-700" /> : null}
              {canStock ? <StatCard label="دفعات منتهية" value={expiredBatchCount} tone="text-red-800" /> : null}
              {canStock ? <StatCard label="عاجل" value={urgentBatchCount} description={`تنتهي خلال ${EXPIRY_URGENT_DAYS} يوماً`} tone="text-red-700" /> : null}
              {canStock ? <StatCard label="قريب" value={soonBatchCount} description={`تنتهي خلال ${EXPIRY_SOON_DAYS} يوماً`} tone="text-amber-700" /> : null}
              {canPurchase ? <StatCard label="أوامر شراء مفتوحة" value={openPurchaseCount} tone="text-brand-700" /> : null}
              {canPurchase ? <StatCard label="استلامات هذا الشهر" value={receiptCountThisMonth} description={`${partialPurchaseCount} استلام جزئي`} /> : null}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            {canPharmacy ? (
              <AdminSection id="overview-rx" title="أقدم الوصفات بانتظار الصرف" description="الصرف نفسه من صفحة صرف الوصفات.">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr><th className="th">المراجع</th><th className="th">الدواء</th><th className="th">المطلوب</th><th className="th">المخزون</th><th className="th">التاريخ</th></tr></thead>
                    <tbody>
                      {(rxAlerts as any[]).map((rx) => {
                        const stock = rx.medication?.quantity;
                        const insufficient = stock !== undefined && stock < rxNeed(rx);
                        return (
                          <tr key={rx.id} className={insufficient ? "bg-amber-50/40" : "hover:bg-gray-50"}>
                            <td className="td"><Link href={`/patients/${rx.patient.id}`} className="font-medium text-brand-700 hover:underline">{rx.patient.fullName}</Link><div className="text-xs text-gray-400">#{rx.patient.fileNumber}</div></td>
                            <td className="td">{rx.medication?.name ?? rx.materialName ?? "—"}</td>
                            <td className="td">{rx.quantity ?? rx.count ?? "—"}</td>
                            <td className={`td ${insufficient ? "font-semibold text-amber-700" : ""}`}>{stock ?? "غير مفهرس"}{rx.medication?.unit ? ` ${rx.medication.unit}` : ""}</td>
                            <td className="td text-gray-500">{fmtDate(rx.prescribedAt)}</td>
                          </tr>
                        );
                      })}
                      {rxAlerts.length === 0 ? emptyRow(5, "لا توجد وصفات داخلية مؤهلة بانتظار الصرف.") : null}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end"><Link href="/pharmacy" className="btn-ghost btn-sm">فتح صرف الوصفات</Link></div>
              </AdminSection>
            ) : null}

            {canStock ? (
              <AdminSection id="overview-stock" title="النواقص والصلاحية" description="أدوية تحت حد التنبيه، ودفعات منتهية أو عاجلة أو قريبة.">
                <div className="grid gap-3 md:grid-cols-2">
                  <MiniList title="نواقص المخزون" href="/pharmacy/stock?state=low">
                    {lowMedications.slice(0, 7).map((medication: any) => (
                      <div key={medication.id} className="flex items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50/40 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate font-medium text-gray-800">{medication.name}</span>
                        <span className="shrink-0 text-red-700">{medication.quantity} / {medication.minQuantity}</span>
                      </div>
                    ))}
                    {lowMedications.length === 0 ? <p className="py-4 text-center text-sm text-gray-400">لا توجد نواقص حالياً.</p> : null}
                  </MiniList>
                  <MiniList title="الصلاحية" href="/pharmacy-inventory?tab=batches&batchState=soon">
                    {(expiryAlerts as any[]).map((batch) => {
                      const level = expiryLevel(batch.expiryDate, now);
                      return (
                        <div key={batch.id} className={`flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm ${EXPIRY_ROW[level]}`}>
                          <span className="min-w-0 truncate font-medium text-gray-800">{batch.medication.name}{batch.batchNo ? ` (${batch.batchNo})` : ""}</span>
                          <span className="flex shrink-0 items-center gap-2">{badge(EXPIRY_LABEL[level], EXPIRY_BADGE[level])}<span className="text-gray-600">{fmtDate(batch.expiryDate)}</span></span>
                        </div>
                      );
                    })}
                    {expiryAlerts.length === 0 ? <p className="py-4 text-center text-sm text-gray-400">لا توجد دفعات قريبة أو منتهية.</p> : null}
                  </MiniList>
                </div>
              </AdminSection>
            ) : null}

            {canPurchase ? (
              <AdminSection id="overview-purchases" title="أوامر شراء مفتوحة" description="أوامر تحتاج اعتماداً أو استلاماً أو متابعة تأخير.">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr><th className="th">رقم الأمر</th><th className="th">المورّد</th><th className="th">الحالة</th><th className="th">التسليم المتوقع</th></tr></thead>
                    <tbody>
                      {(openOrders as any[]).map((order) => {
                        const delayed = isPurchaseDelayed(order, now);
                        return (
                          <tr key={order.id} className={delayed ? "bg-red-50/40" : "hover:bg-gray-50"}>
                            <td className="td"><Link href={`/pharmacy/purchases/${order.id}`} className="font-medium text-brand-700 hover:underline">{order.orderNo}</Link></td>
                            <td className="td">{order.supplier.name}</td>
                            <td className="td">{badge(PURCHASE_STATUS[order.status]?.label ?? order.status, PURCHASE_STATUS[order.status]?.cls)}</td>
                            <td className={`td ${delayed ? "font-semibold text-red-700" : ""}`}>{fmtDate(order.expectedDeliveryDate)}{delayed ? " · متأخر" : ""}</td>
                          </tr>
                        );
                      })}
                      {openOrders.length === 0 ? emptyRow(4, "لا توجد أوامر شراء مفتوحة.") : null}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end"><Link href="/pharmacy/purchases" className="btn-ghost btn-sm">كل أوامر الشراء</Link></div>
              </AdminSection>
            ) : null}
          </div>
        </>
      ) : null}

      {activeTab === "batches" && canStock ? (
        <>
          <FilterBar action="/pharmacy-inventory" queryName="batchQ" query={sp.batchQ} placeholder="دواء، دفعة، مورّد، أمر شراء…" activeCount={[sp.batchState && sp.batchState !== "all" ? sp.batchState : null, sp.batchSupplier, sp.expiryFrom, sp.expiryTo].filter(Boolean).length} clearHref="/pharmacy-inventory?tab=batches" hidden={hiddenTab("batches")}>
            <label className="label">الحالة<select name="batchState" defaultValue={batchStateFilter} className="input mt-1">
              <option value="all">كل الدفعات</option>
              <option value="expired">منتهية</option>
              <option value="urgent">عاجل (خلال {EXPIRY_URGENT_DAYS} يوماً)</option>
              <option value="soon">قريب (خلال {EXPIRY_SOON_DAYS} يوماً)</option>
              <option value="no_expiry">بدون تاريخ</option>
            </select></label>
            <label className="label">المورّد<select name="batchSupplier" defaultValue={sp.batchSupplier ?? ""} className="input mt-1"><option value="">كل الموردين</option>{supplierOptions}</select></label>
            <label className="label">ينتهي من<input name="expiryFrom" type="date" defaultValue={sp.expiryFrom ?? ""} className="input mt-1" /></label>
            <label className="label">ينتهي إلى<input name="expiryTo" type="date" defaultValue={sp.expiryTo ?? ""} className="input mt-1" /></label>
          </FilterBar>
          <section className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">الدواء</th><th className="th">رقم الدفعة</th><th className="th">المورّد</th><th className="th">الكمية</th><th className="th">الانتهاء</th><th className="th">الحالة</th><th className="th">أمر/استلام</th><th className="th">إدخال</th></tr></thead>
              <tbody>
                {batchRows.map((batch) => {
                  const level = expiryLevel(batch.expiryDate, now);
                  return (
                    <tr key={batch.id} className={`${EXPIRY_ROW[level]} hover:bg-gray-50`}>
                      <td className="td font-medium">{batch.medication.name}</td>
                      <td className="td">{batch.batchNo || "—"}</td>
                      <td className="td">{batch.supplier?.name || "—"}</td>
                      <td className="td font-bold">{numberValue(batch.quantity)}{batch.medication.unit ? ` ${batch.medication.unit}` : ""}</td>
                      <td className="td">{fmtDate(batch.expiryDate)}</td>
                      <td className="td">{badge(EXPIRY_LABEL[level], EXPIRY_BADGE[level])}</td>
                      <td className="td">{batch.purchaseOrder ? <Link href={`/pharmacy/purchases/${batch.purchaseOrder.id}`} className="text-brand-700 hover:underline">{batch.purchaseOrder.orderNo}</Link> : batch.purchaseReceipt?.receiptNo ?? "—"}</td>
                      <td className="td text-gray-500">{fmtDate(batch.receivedAt)}</td>
                    </tr>
                  );
                })}
                {batchRows.length === 0 ? emptyRow(8, "لا توجد دفعات مطابقة.") : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {activeTab === "receipts" && canPurchase ? (
        <>
          <FilterBar action="/pharmacy-inventory" queryName="receiptOrder" query={sp.receiptOrder} placeholder="رقم أمر الشراء…" activeCount={[sp.receiptSupplier, sp.receiptFrom, sp.receiptTo].filter(Boolean).length} clearHref="/pharmacy-inventory?tab=receipts" hidden={hiddenTab("receipts")}>
            <label className="label">المورّد<select name="receiptSupplier" defaultValue={sp.receiptSupplier ?? ""} className="input mt-1"><option value="">كل الموردين</option>{supplierOptions}</select></label>
            <label className="label">من<input name="receiptFrom" type="date" defaultValue={sp.receiptFrom ?? ""} className="input mt-1" /></label>
            <label className="label">إلى<input name="receiptTo" type="date" defaultValue={sp.receiptTo ?? ""} className="input mt-1" /></label>
          </FilterBar>
          {canPurchaseReceive ? <div className="rounded-lg border border-brand-100 bg-brand-50/40 px-3 py-2 text-sm text-brand-800">تسجيل الاستلام يتم من صفحة أمر الشراء نفسه بعد فتح الأمر المعتمد أو المطلوب من المورد.</div> : null}
          <section className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">رقم الاستلام</th><th className="th">أمر الشراء</th><th className="th">المورّد</th><th className="th">التاريخ</th><th className="th">المدخل</th><th className="th">مقبول</th><th className="th">مرفوض/تالف</th><th className="th">بنود</th></tr></thead>
              <tbody>
                {(receipts as any[]).map((receipt) => {
                  const accepted = receipt.items.reduce((sum: number, item: any) => sum + item.acceptedQuantity, 0);
                  const rejectedDamaged = receipt.items.reduce((sum: number, item: any) => sum + item.rejectedQuantity + item.damagedQuantity, 0);
                  return (
                    <tr key={receipt.id} className={rejectedDamaged > 0 ? "bg-amber-50/30 hover:bg-amber-50" : "hover:bg-gray-50"}>
                      <td className="td font-medium">{receipt.receiptNo}</td>
                      <td className="td"><Link href={`/pharmacy/purchases/${receipt.purchaseOrder.id}`} className="text-brand-700 hover:underline">{receipt.purchaseOrder.orderNo}</Link></td>
                      <td className="td">{receipt.purchaseOrder.supplier.name}</td>
                      <td className="td">{fmtDateTime(receipt.receivedAt)}</td>
                      <td className="td">{receipt.createdBy?.fullName || "—"}</td>
                      <td className="td font-bold text-emerald-700">{numberValue(accepted)}</td>
                      <td className={`td ${rejectedDamaged > 0 ? "font-semibold text-amber-700" : ""}`}>{numberValue(rejectedDamaged)}</td>
                      <td className="td">{receipt.items.length}</td>
                    </tr>
                  );
                })}
                {receipts.length === 0 ? emptyRow(8, "لا توجد استلامات مطابقة.") : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {activeTab === "movements" && canStock ? (
        <>
          <FilterBar action="/pharmacy-inventory" queryName="moveQ" query={sp.moveQ} placeholder="دواء، مريض، أو سبب…" activeCount={[sp.moveFrom, sp.moveTo, sp.moveType && sp.moveType !== "all" ? sp.moveType : null, sp.moveMedication].filter(Boolean).length} clearHref="/pharmacy-inventory?tab=movements" hidden={hiddenTab("movements")}>
            <label className="label">من<input name="moveFrom" type="date" defaultValue={sp.moveFrom ?? localDateInput(monthStart)} className="input mt-1" /></label>
            <label className="label">إلى<input name="moveTo" type="date" defaultValue={sp.moveTo ?? ""} className="input mt-1" /></label>
            <label className="label">النوع<select name="moveType" defaultValue={sp.moveType ?? "all"} className="input mt-1"><option value="all">كل الحركات</option>{Object.entries(MOVE_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="label">الدواء<select name="moveMedication" defaultValue={sp.moveMedication ?? ""} className="input mt-1"><option value="">كل الأدوية</option>{(medicationsForStats as any[]).map((medication) => <option key={medication.id} value={medication.id}>{medication.name}</option>)}</select></label>
          </FilterBar>
          <section className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">التاريخ</th><th className="th">النوع</th><th className="th">الدواء</th><th className="th">الكمية</th><th className="th">المريض/السبب</th><th className="th">المنفذ</th></tr></thead>
              <tbody>
                {(movements as any[]).map((move) => (
                  <tr key={move.id} className="hover:bg-gray-50">
                    <td className="td text-gray-500">{fmtDateTime(move.createdAt)}</td>
                    <td className="td">{badge((MOVE_TYPE as any)[move.type] ?? move.type, MOVE_TYPE_STYLE[move.type])}</td>
                    <td className="td font-medium">{move.medication?.name ?? "—"}</td>
                    <td className={`td font-bold ${move.type === "DISPENSE" || move.type === "DISPOSE" ? "text-red-700" : move.type === "IN" ? "text-emerald-700" : "text-amber-700"}`}>{move.type === "IN" ? "+" : move.type === "ADJUST" ? "±" : "−"}{numberValue(move.quantity)}{move.medication?.unit ? ` ${move.medication.unit}` : ""}</td>
                    <td className="td">{move.patientName || move.reason || "—"}</td>
                    <td className="td">{move.byName || "—"}</td>
                  </tr>
                ))}
                {movements.length === 0 ? emptyRow(6, "لا توجد حركات ضمن الفلاتر.") : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}

function MiniList({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-100 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <Link href={href} className="text-xs text-brand-700 hover:underline">عرض الكل</Link>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
