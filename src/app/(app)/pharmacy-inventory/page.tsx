import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminIntro, AdminSection, AdminSectionTabs, StatCard } from "@/components/AdminPageSections";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, MOVE_TYPE, RX_STATUS } from "@/lib/labels";

export const dynamic = "force-dynamic";

type Search = Record<string, string | undefined>;
type PharmacyInventoryTab = "overview" | "dispense" | "stock" | "batches" | "purchases" | "receipts" | "alerts" | "reports";

const TABS: { key: PharmacyInventoryTab; label: string; title: string; description: string; perms: string[] }[] = [
  { key: "overview", label: "نظرة عامة", title: "لوحة الصيدلية والمخزون", description: "ملخص سريع للوصفات، الأدوية، الدفعات، أوامر الشراء، والاستلام حسب الصلاحيات المتاحة.", perms: ["pharmacy.view", "inventory.view", "pharmacy.purchase.view"] },
  { key: "dispense", label: "صرف الوصفات", title: "صرف الوصفات", description: "وصفات داخلية مؤهلة وغير مصروفة مع فلاتر الحالة والمراجع والدواء.", perms: ["pharmacy.view"] },
  { key: "stock", label: "الأدوية والمخزون", title: "الأدوية والمخزون", description: "قائمة الأدوية والكميات وحدود التنبيه، مع إبراز النافد والمنخفض.", perms: ["pharmacy.view", "inventory.view"] },
  { key: "batches", label: "الدفعات والصلاحية", title: "الدفعات والصلاحية", description: "متابعة الدفعات حسب تاريخ الانتهاء والمورّد وأمر الشراء المرتبط إن وجد.", perms: ["pharmacy.view", "inventory.view"] },
  { key: "purchases", label: "أوامر الشراء", title: "أوامر الشراء", description: "أوامر الشراء المفتوحة والمعتمدة والمستلمة جزئياً مع فلاتر الحالة والمورّد.", perms: ["pharmacy.purchase.view"] },
  { key: "receipts", label: "الاستلام", title: "الاستلام", description: "سجل الاستلام المرتبط بأوامر الشراء والمورّدين ومستخدمي الإدخال.", perms: ["pharmacy.purchase.view"] },
  { key: "alerts", label: "النواقص والتنبيهات", title: "النواقص والتنبيهات", description: "بنود تحتاج متابعة: وصفات معلقة، مخزون منخفض، دفعات منتهية أو قريبة، وأوامر متأخرة.", perms: ["pharmacy.view", "inventory.view", "pharmacy.purchase.view"] },
  { key: "reports", label: "تقارير الصيدلية", title: "تقارير الصيدلية", description: "مؤشرات مختصرة للحركة والصرف والشراء من البيانات الموجودة دون إنشاء تقرير جديد.", perms: ["pharmacy.view", "inventory.view", "pharmacy.purchase.view"] },
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

const RX_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  PARTIAL: "bg-orange-50 text-orange-700",
  DISPENSED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
};

const MOVE_TYPE_STYLE: Record<string, string> = {
  IN: "bg-emerald-50 text-emerald-700",
  DISPENSE: "bg-sky-50 text-sky-700",
  DISPOSE: "bg-red-50 text-red-700",
  ADJUST: "bg-amber-50 text-amber-700",
};

const DAY_MS = 86400000;
const CLOSE_EXPIRY_DAYS = 60;
const OPEN_PURCHASE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"];
const CLOSED_PURCHASE_STATUSES = ["FULLY_RECEIVED", "CANCELLED"];

function hasAny(perms: Set<string>, keys: string[]) {
  return keys.some((key) => perms.has(key));
}

function normalizeTab(raw: string | undefined, visible: typeof TABS): PharmacyInventoryTab {
  return (visible.some((tab) => tab.key === raw) ? raw : visible[0]?.key) as PharmacyInventoryTab;
}

function tabHref(key: PharmacyInventoryTab) {
  return `/pharmacy-inventory?tab=${key}`;
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

function moneyValue(value: unknown) {
  return `${new Intl.NumberFormat("ar-IQ").format(Number(value ?? 0))} د.ع`;
}

function emptyRow(colSpan: number, text = "لا توجد نتائج مطابقة.") {
  return <tr><td className="td text-center text-gray-400" colSpan={colSpan}>{text}</td></tr>;
}

function badge(label: string, cls = "bg-gray-100 text-gray-600") {
  return <span className={`badge ${cls}`}>{label}</span>;
}

function stockState(medication: { quantity: number; minQuantity: number; batches?: { quantity: number; expiryDate: Date | null }[] }) {
  if (medication.quantity <= 0) return { key: "out", label: "نافد", cls: "bg-red-50 text-red-700", row: "bg-red-50/40" };
  if (medication.quantity <= medication.minQuantity) return { key: "low", label: "منخفض", cls: "bg-amber-50 text-amber-700", row: "bg-amber-50/30" };
  if (medication.batches?.some((batch) => batch.quantity > 0 && batch.expiryDate && batch.expiryDate.getTime() < Date.now())) {
    return { key: "expired", label: "فيه دفعة منتهية", cls: "bg-red-50 text-red-700", row: "bg-red-50/30" };
  }
  if (medication.batches?.some((batch) => batch.quantity > 0 && batch.expiryDate && batch.expiryDate.getTime() <= Date.now() + CLOSE_EXPIRY_DAYS * DAY_MS)) {
    return { key: "soon", label: "قريب الانتهاء", cls: "bg-orange-50 text-orange-700", row: "bg-orange-50/20" };
  }
  return { key: "ok", label: "جيد", cls: "bg-emerald-50 text-emerald-700", row: "" };
}

function batchState(batch: { quantity: number; expiryDate: Date | null }, now: Date, soon: Date) {
  if (batch.quantity <= 0) return { key: "empty", label: "نافدة", cls: "bg-gray-100 text-gray-500", row: "" };
  if (!batch.expiryDate) return { key: "no_expiry", label: "بدون تاريخ", cls: "bg-gray-100 text-gray-600", row: "" };
  if (batch.expiryDate < now) return { key: "expired", label: "منتهية", cls: "bg-red-50 text-red-700", row: "bg-red-50/40" };
  if (batch.expiryDate <= soon) return { key: "soon", label: "قريبة الانتهاء", cls: "bg-orange-50 text-orange-700", row: "bg-orange-50/30" };
  return { key: "ok", label: "جيدة", cls: "bg-emerald-50 text-emerald-700", row: "" };
}

function rxNeed(rx: { count: number | null; quantity: string | null }) {
  return rx.count && rx.count > 0 ? rx.count : parseInt((rx.quantity || "").match(/\d+/)?.[0] || "0", 10) || 1;
}

function isPurchaseDelayed(order: { expectedDeliveryDate: Date | null; status: string }, now: Date) {
  return !!order.expectedDeliveryDate && order.expectedDeliveryDate < now && !CLOSED_PURCHASE_STATUSES.includes(order.status);
}

function orderTotal(order: { items: { orderedQuantity: number; unitPrice?: unknown }[] }) {
  return order.items.reduce((sum, item) => sum + Number(item.unitPrice ?? 0) * item.orderedQuantity, 0);
}

function buildLink(path: string, params: Record<string, string | number | undefined | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

export default async function PharmacyInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireSession();
  const sp = await searchParams;
  const perms = await currentPerms();

  const canPharmacy = perms.has("pharmacy.view");
  const canInventory = perms.has("inventory.view");
  const canStock = canPharmacy || canInventory;
  const canDispense = perms.has("pharmacy.dispense");
  const canBatch = perms.has("pharmacy.batch");
  const canPurchase = perms.has("pharmacy.purchase.view");
  const canPurchaseCreate = perms.has("pharmacy.purchase.create");
  const canPurchaseReceive = perms.has("pharmacy.purchase.receive");
  const canPurchasePrices = perms.has("pharmacy.purchase.prices");

  const visibleTabs = TABS.filter((tab) => hasAny(perms, tab.perms));
  if (!visibleTabs.length) redirect("/");
  const activeTab = normalizeTab(sp.tab, visibleTabs);
  const requestedTab = sp.tab && TABS.some((tab) => tab.key === sp.tab) ? sp.tab : activeTab;
  if (requestedTab !== activeTab) redirect(tabHref(activeTab));

  const now = new Date();
  const today = dateStart(localDateInput(now))!;
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const soon = new Date(now.getTime() + CLOSE_EXPIRY_DAYS * DAY_MS);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const navTabs = visibleTabs.map((tab) => ({ key: tab.key, label: tab.label, href: tabHref(tab.key) }));
  const activeInfo = TABS.find((tab) => tab.key === activeTab)!;

  const medicationSearch = (sp.medQ ?? "").trim();
  const medicationWhere: any = {};
  if (medicationSearch) {
    medicationWhere.OR = [
      { name: { contains: medicationSearch, mode: "insensitive" } },
      { unit: { contains: medicationSearch, mode: "insensitive" } },
    ];
  }

  const rxWhere: any = {};
  const rxState = sp.rxState ?? "pending";
  if (rxState === "pending") {
    rxWhere.isDispensed = false;
    rxWhere.status = { not: "REJECTED" };
    rxWhere.prescriptionType = "INTERNAL";
    rxWhere.eligibilityDecision = "ELIGIBLE";
  } else if (rxState === "partial") {
    rxWhere.status = "PARTIAL";
  } else if (rxState === "dispensedToday") {
    rxWhere.isDispensed = true;
    rxWhere.dispensedAt = { gte: today, lt: tomorrow };
  } else if (rxState !== "all") {
    rxWhere.status = rxState;
  }
  const rxQ = (sp.rxQ ?? "").trim();
  if (rxQ) {
    rxWhere.OR = [
      { patient: { fullName: { contains: rxQ, mode: "insensitive" } } },
      { patient: { fileNumber: { contains: rxQ, mode: "insensitive" } } },
      { medication: { name: { contains: rxQ, mode: "insensitive" } } },
      { materialName: { contains: rxQ, mode: "insensitive" } },
      { doctor: { contains: rxQ, mode: "insensitive" } },
    ];
  }

  const batchWhere: any = { quantity: { gt: 0 } };
  const batchStateFilter = sp.batchState ?? "all";
  if (batchStateFilter === "expired") batchWhere.expiryDate = { not: null, lt: now };
  else if (batchStateFilter === "soon") batchWhere.expiryDate = { not: null, gte: now, lte: soon };
  else if (batchStateFilter === "no_expiry") batchWhere.expiryDate = null;
  else {
    const range = dateRange(sp.expiryFrom, sp.expiryTo);
    if (range) batchWhere.expiryDate = range;
  }
  if (sp.batchSupplier) batchWhere.supplierId = Number(sp.batchSupplier);
  const batchQ = (sp.batchQ ?? "").trim().toLowerCase();

  const purchaseWhere: any = {};
  if (sp.purchaseStatus && sp.purchaseStatus !== "all") purchaseWhere.status = sp.purchaseStatus;
  if (sp.purchaseSupplier) purchaseWhere.supplierId = Number(sp.purchaseSupplier);
  const purchaseRange = dateRange(sp.purchaseFrom, sp.purchaseTo);
  if (purchaseRange) purchaseWhere.orderDate = purchaseRange;
  const purchaseQ = (sp.purchaseQ ?? "").trim();
  if (purchaseQ) {
    purchaseWhere.OR = [
      { orderNo: { contains: purchaseQ, mode: "insensitive" } },
      { notes: { contains: purchaseQ, mode: "insensitive" } },
    ];
  }

  const receiptWhere: any = {};
  const receiptRange = dateRange(sp.receiptFrom, sp.receiptTo);
  if (receiptRange) receiptWhere.receivedAt = receiptRange;
  if (sp.receiptSupplier) receiptWhere.purchaseOrder = { supplierId: Number(sp.receiptSupplier) };
  if (sp.receiptOrder) {
    receiptWhere.purchaseOrder = {
      ...(receiptWhere.purchaseOrder ?? {}),
      orderNo: { contains: sp.receiptOrder.trim(), mode: "insensitive" },
    };
  }

  const movementWhere: any = {};
  const movementRange = dateRange(sp.moveFrom ?? localDateInput(monthStart), sp.moveTo);
  if (movementRange) movementWhere.createdAt = movementRange;
  if (sp.moveType && sp.moveType !== "all") movementWhere.type = sp.moveType;
  if (sp.moveMedication) movementWhere.medicationId = Number(sp.moveMedication);

  const [
    stockSnapshot,
    medicationsForStats,
    medicationsRaw,
    suppliers,
    pendingRxCount,
    dispensedTodayCount,
    rxRows,
    rxAlerts,
    expiringBatchCount,
    expiredBatchCount,
    batchRowsRaw,
    expiryAlerts,
    openPurchaseCount,
    pendingApprovalCount,
    partialPurchaseCount,
    orders,
    overdueOrders,
    receipts,
    receiptCountThisMonth,
    purchaseItemAgg,
    movements,
    topDispensed,
    purchaseStatusRows,
  ] = await Promise.all([
    canStock ? prisma.medication.aggregate({ _count: { _all: true }, _sum: { quantity: true } }) : Promise.resolve(null),
    canStock ? prisma.medication.findMany({ select: { id: true, name: true, quantity: true, minQuantity: true, unit: true }, orderBy: { name: "asc" }, take: 1000 }) : Promise.resolve([]),
    canStock ? prisma.medication.findMany({
      where: medicationWhere,
      include: {
        batches: {
          where: { quantity: { gt: 0 } },
          include: { supplier: true },
          orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        },
      },
      orderBy: { name: "asc" },
      take: 300,
    }) : Promise.resolve([]),
    canStock || canPurchase ? prisma.supplier.findMany({ orderBy: { name: "asc" }, take: 300 }) : Promise.resolve([]),
    canPharmacy ? prisma.prescription.count({ where: { isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE" } }) : Promise.resolve(0),
    canPharmacy ? prisma.prescription.count({ where: { isDispensed: true, dispensedAt: { gte: today, lt: tomorrow } } }) : Promise.resolve(0),
    canPharmacy ? prisma.prescription.findMany({
      where: rxWhere,
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, medication: { select: { id: true, name: true, quantity: true, minQuantity: true, unit: true } } },
      orderBy: [{ prescribedAt: "desc" }],
      take: 200,
    }) : Promise.resolve([]),
    canPharmacy ? prisma.prescription.findMany({
      where: { isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE" },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, medication: { select: { name: true, quantity: true, minQuantity: true, unit: true } } },
      orderBy: { prescribedAt: "asc" },
      take: 20,
    }) : Promise.resolve([]),
    canStock ? prisma.medicationBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { not: null, gte: now, lte: soon } } }) : Promise.resolve(0),
    canStock ? prisma.medicationBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { not: null, lt: now } } }) : Promise.resolve(0),
    canStock ? prisma.medicationBatch.findMany({
      where: batchWhere,
      include: { medication: { select: { id: true, name: true, unit: true } }, supplier: true, purchaseOrder: { select: { id: true, orderNo: true, status: true } }, purchaseReceipt: { select: { id: true, receiptNo: true } } },
      orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { receivedAt: "desc" }],
      take: 500,
    }) : Promise.resolve([]),
    canStock ? prisma.medicationBatch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: soon } },
      include: { medication: { select: { id: true, name: true, unit: true } }, supplier: true, purchaseOrder: { select: { id: true, orderNo: true } } },
      orderBy: { expiryDate: "asc" },
      take: 80,
    }) : Promise.resolve([]),
    canPurchase ? prisma.purchaseOrder.count({ where: { status: { in: OPEN_PURCHASE_STATUSES as any } } }) : Promise.resolve(0),
    canPurchase ? prisma.purchaseOrder.count({ where: { status: "PENDING_APPROVAL" } }) : Promise.resolve(0),
    canPurchase ? prisma.purchaseOrder.count({ where: { status: "PARTIALLY_RECEIVED" } }) : Promise.resolve(0),
    canPurchase ? prisma.purchaseOrder.findMany({
      where: purchaseWhere,
      include: {
        supplier: true,
        createdBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
        _count: { select: { items: true, receipts: true } },
        items: { select: { orderedQuantity: true, receivedQuantity: true, rejectedQuantity: true, damagedQuantity: true, unitPrice: canPurchasePrices } },
      },
      orderBy: [{ status: "asc" }, { expectedDeliveryDate: "asc" }, { createdAt: "desc" }],
      take: 200,
    }) : Promise.resolve([]),
    canPurchase ? prisma.purchaseOrder.findMany({
      where: { expectedDeliveryDate: { lt: now }, status: { notIn: CLOSED_PURCHASE_STATUSES as any } },
      include: { supplier: true, _count: { select: { items: true, receipts: true } } },
      orderBy: { expectedDeliveryDate: "asc" },
      take: 30,
    }) : Promise.resolve([]),
    canPurchase ? prisma.purchaseReceipt.findMany({
      where: receiptWhere,
      include: {
        purchaseOrder: { select: { id: true, orderNo: true, status: true, supplier: true } },
        createdBy: { select: { fullName: true } },
        items: { select: { acceptedQuantity: true, rejectedQuantity: true, damagedQuantity: true, purchaseItem: { select: { medication: { select: { name: true } }, materialName: true, unit: true } } } },
      },
      orderBy: { receivedAt: "desc" },
      take: 200,
    }) : Promise.resolve([]),
    canPurchase ? prisma.purchaseReceipt.count({ where: { receivedAt: { gte: monthStart } } }) : Promise.resolve(0),
    canPurchase ? prisma.purchaseOrderItem.aggregate({ _sum: { orderedQuantity: true, receivedQuantity: true, rejectedQuantity: true, damagedQuantity: true, ...(canPurchasePrices ? { unitPrice: true } : {}) } }) : Promise.resolve(null),
    canStock ? prisma.stockMovement.findMany({
      where: movementWhere,
      include: { medication: { select: { id: true, name: true, unit: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }) : Promise.resolve([]),
    canStock ? prisma.stockMovement.groupBy({ by: ["medicationId"], where: { type: "DISPENSE", createdAt: { gte: monthStart } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 8 }) : Promise.resolve([]),
    canPurchase ? prisma.purchaseOrder.groupBy({ by: ["status"], _count: { _all: true }, orderBy: { status: "asc" } }) : Promise.resolve([]),
  ]);

  const lowMedications = medicationsForStats.filter((medication: any) => medication.quantity <= medication.minQuantity);
  const filteredMedications = medicationsRaw.filter((medication: any) => {
    const state = stockState(medication);
    if (!sp.stockState || sp.stockState === "all") return true;
    if (sp.stockState === "low") return state.key === "low";
    if (sp.stockState === "out") return state.key === "out";
    if (sp.stockState === "expiry") return state.key === "soon" || state.key === "expired";
    if (sp.stockState === "ok") return state.key === "ok";
    return true;
  });
  const medicationNameById = new Map(medicationsForStats.map((medication: any) => [medication.id, medication.name]));
  const batchRows = batchQ
    ? batchRowsRaw.filter((batch: any) => [
        batch.batchNo,
        batch.medication?.name,
        batch.medication?.unit,
        batch.supplier?.name,
        batch.purchaseOrder?.orderNo,
        batch.purchaseReceipt?.receiptNo,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(batchQ)))
    : batchRowsRaw;
  const overduePurchaseCount = overdueOrders.length;
  const totalStock = stockSnapshot?._sum.quantity ?? 0;
  const medicationCount = stockSnapshot?._count._all ?? 0;
  const receivedQuantity = purchaseItemAgg?._sum.receivedQuantity ?? 0;
  const orderedQuantity = purchaseItemAgg?._sum.orderedQuantity ?? 0;
  const rejectedOrDamagedQuantity = Number(purchaseItemAgg?._sum.rejectedQuantity ?? 0) + Number(purchaseItemAgg?._sum.damagedQuantity ?? 0);
  const topDispensedRows = topDispensed.map((row: any) => ({
    id: row.medicationId,
    name: medicationNameById.get(row.medicationId) ?? `#${row.medicationId}`,
    quantity: row._sum.quantity ?? 0,
  }));
  const maxTopDispensed = Math.max(1, ...topDispensedRows.map((row) => row.quantity));

  const quickLinks = [
    canBatch ? { href: "/pharmacy/stock", label: "إضافة دواء" } : null,
    canDispense ? { href: "/pharmacy", label: "صرف وصفة" } : canPharmacy ? { href: "/pharmacy", label: "فتح التجهيز" } : null,
    canPurchaseCreate ? { href: "/pharmacy/purchases", label: "إنشاء أمر شراء" } : null,
    canPurchaseReceive ? { href: "/pharmacy-inventory?tab=receipts", label: "متابعة الاستلام" } : null,
    canPharmacy ? { href: "/pharmacy/reports", label: "فتح تقارير الصيدلية" } : null,
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="الصيدلية والمخزون" subtitle="صفحة جامعة للوصفات، المخزون، الدفعات، الشراء، والاستلام" icon="💊" />
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات الصيدلية والمخزون" />
      <AdminIntro title={activeInfo.title} description={activeInfo.description}>
        <div className="flex flex-wrap gap-2">
          {quickLinks.map((link) => <Link key={link.href} href={link.href} className="btn-ghost btn-sm">{link.label}</Link>)}
        </div>
      </AdminIntro>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <StatCard label="وصفات بانتظار الصرف" value={canPharmacy ? pendingRxCount : "—"} tone="text-amber-700" />
        <StatCard label="وصفات مصروفة اليوم" value={canPharmacy ? dispensedTodayCount : "—"} tone="text-emerald-700" />
        <StatCard label="أدوية ناقصة" value={canStock ? lowMedications.length : "—"} tone="text-red-700" />
        <StatCard label="دفعات قريبة الانتهاء" value={canStock ? expiringBatchCount : "—"} description={canStock ? `خلال ${CLOSE_EXPIRY_DAYS} يوم` : undefined} tone="text-orange-700" />
        <StatCard label="دفعات منتهية" value={canStock ? expiredBatchCount : "—"} tone="text-red-700" />
        <StatCard label="أوامر شراء مفتوحة" value={canPurchase ? openPurchaseCount : "—"} tone="text-brand-700" />
        <StatCard label="استلامات هذا الشهر" value={canPurchase ? receiptCountThisMonth : "—"} description={canPurchase ? `${partialPurchaseCount} استلام جزئي` : undefined} />
      </section>

      {activeTab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <AdminSection id="overview-rx" title="صرف الوصفات" description="أقدم الوصفات الداخلية المؤهلة وغير المصروفة.">
            {canPharmacy ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">المراجع</th><th className="th">الدواء</th><th className="th">المطلوب</th><th className="th">المخزون</th><th className="th">التاريخ</th></tr></thead>
                  <tbody>
                    {rxAlerts.slice(0, 8).map((rx: any) => {
                      const need = rxNeed(rx);
                      const stock = rx.medication?.quantity;
                      const insufficient = stock !== undefined && stock < need;
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
            ) : <NoAccess text="تحتاج صلاحية عرض الصيدلية." />}
            {canPharmacy ? <div className="flex justify-end"><Link href="/pharmacy" className="btn-ghost btn-sm">فتح قائمة التجهيز</Link></div> : null}
          </AdminSection>

          <AdminSection id="overview-stock" title="المخزون والدفعات" description="أدوية تحت حد التنبيه ودفعات قريبة أو منتهية.">
            {canStock ? (
              <div className="grid gap-3 md:grid-cols-2">
                <MiniList title="نواقص المخزون" href="/pharmacy-inventory?tab=stock&stockState=low">
                  {lowMedications.slice(0, 7).map((medication: any) => (
                    <div key={medication.id} className="flex items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50/40 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate font-medium text-gray-800">{medication.name}</span>
                      <span className="shrink-0 text-red-700">{medication.quantity} / {medication.minQuantity}</span>
                    </div>
                  ))}
                  {lowMedications.length === 0 ? <p className="py-4 text-center text-sm text-gray-400">لا توجد نواقص حالياً.</p> : null}
                </MiniList>
                <MiniList title="الصلاحية" href="/pharmacy-inventory?tab=batches&batchState=soon">
                  {expiryAlerts.slice(0, 7).map((batch: any) => {
                    const state = batchState(batch, now, soon);
                    return (
                      <div key={batch.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${state.key === "expired" ? "border-red-100 bg-red-50/40" : "border-orange-100 bg-orange-50/40"}`}>
                        <span className="min-w-0 truncate font-medium text-gray-800">{batch.medication.name}{batch.batchNo ? ` (${batch.batchNo})` : ""}</span>
                        <span className={state.key === "expired" ? "shrink-0 text-red-700" : "shrink-0 text-orange-700"}>{fmtDate(batch.expiryDate)}</span>
                      </div>
                    );
                  })}
                  {expiryAlerts.length === 0 ? <p className="py-4 text-center text-sm text-gray-400">لا توجد دفعات قريبة أو منتهية.</p> : null}
                </MiniList>
              </div>
            ) : <NoAccess text="تحتاج صلاحية عرض المخزون أو الصيدلية." />}
          </AdminSection>

          <AdminSection id="overview-purchases" title="الشراء والاستلام" description="أوامر تحتاج اعتماداً أو استلاماً أو متابعة تأخير.">
            {canPurchase ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">رقم الأمر</th><th className="th">المورّد</th><th className="th">الحالة</th><th className="th">التسليم المتوقع</th><th className="th">المتابعة</th></tr></thead>
                  <tbody>
                    {orders.filter((order: any) => order.status !== "FULLY_RECEIVED" && order.status !== "CANCELLED").slice(0, 8).map((order: any) => {
                      const delayed = isPurchaseDelayed(order, now);
                      return (
                        <tr key={order.id} className={delayed ? "bg-red-50/40" : "hover:bg-gray-50"}>
                          <td className="td"><Link href={`/pharmacy/purchases/${order.id}`} className="font-medium text-brand-700 hover:underline">{order.orderNo}</Link></td>
                          <td className="td">{order.supplier.name}</td>
                          <td className="td">{badge(PURCHASE_STATUS[order.status]?.label ?? order.status, PURCHASE_STATUS[order.status]?.cls)}</td>
                          <td className={`td ${delayed ? "font-semibold text-red-700" : ""}`}>{fmtDate(order.expectedDeliveryDate)}</td>
                          <td className="td">{delayed ? badge("متأخر", "bg-red-50 text-red-700") : order.status === "PARTIALLY_RECEIVED" ? badge("استلام جزئي", "bg-orange-50 text-orange-700") : "—"}</td>
                        </tr>
                      );
                    })}
                    {orders.length === 0 ? emptyRow(5, "لا توجد أوامر شراء ضمن الصلاحية.") : null}
                  </tbody>
                </table>
              </div>
            ) : <NoAccess text="تحتاج صلاحية عرض أوامر الشراء." />}
          </AdminSection>

          <AdminSection id="overview-reports" title="مؤشرات مختصرة" description="لقطة من الصرف والشراء والمخزون الحالي.">
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricLine label="إجمالي الوحدات في المخزون" value={canStock ? numberValue(totalStock) : "—"} />
              <MetricLine label="عدد مواد المخزون" value={canStock ? numberValue(medicationCount) : "—"} />
              <MetricLine label="كمية الشراء المطلوبة" value={canPurchase ? numberValue(orderedQuantity) : "—"} />
              <MetricLine label="كمية الشراء المستلمة" value={canPurchase ? numberValue(receivedQuantity) : "—"} />
              <MetricLine label="المرفوض/التالف" value={canPurchase ? numberValue(rejectedOrDamagedQuantity) : "—"} />
              <MetricLine label="أوامر متأخرة" value={canPurchase ? numberValue(overduePurchaseCount) : "—"} tone="text-red-700" />
            </div>
          </AdminSection>
        </div>
      ) : null}

      {activeTab === "dispense" ? (
        <AdminSection id="dispense" title="فلترة وصرف الوصفات" description="الصرف الفعلي يتم من قائمة التجهيز القديمة المحمية، وهذه الصفحة تعرض الصفوف وتوجه للإجراء.">
          {canPharmacy ? (
            <>
              <form action="/pharmacy-inventory" className="grid gap-3 md:grid-cols-5">
                <input type="hidden" name="tab" value="dispense" />
                <label className="label">بحث<input name="rxQ" defaultValue={sp.rxQ ?? ""} className="input mt-1" placeholder="مراجع، ملف، دواء، طبيب" /></label>
                <label className="label">الحالة<select name="rxState" defaultValue={rxState} className="input mt-1">
                  <option value="pending">مؤهل بانتظار الصرف</option>
                  <option value="partial">مصروف جزئياً</option>
                  <option value="dispensedToday">مصروف اليوم</option>
                  <option value="PENDING">بانتظار التجهيز</option>
                  <option value="DISPENSED">مصروف</option>
                  <option value="REJECTED">مرفوض</option>
                  <option value="all">كل الوصفات</option>
                </select></label>
                <div className="flex items-end gap-2 md:col-span-3">
                  <button className="btn-primary" type="submit">تطبيق</button>
                  <Link href="/pharmacy-inventory?tab=dispense" className="btn-ghost">مسح</Link>
                  <Link href="/pharmacy" className="btn-ghost">فتح شاشة الصرف</Link>
                </div>
              </form>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">المراجع</th><th className="th">الدواء</th><th className="th">الكمية</th><th className="th">الحالة</th><th className="th">المخزون</th><th className="th">الطبيب</th><th className="th">التاريخ</th><th className="th">إجراء</th></tr></thead>
                  <tbody>
                    {rxRows.map((rx: any) => {
                      const need = rxNeed(rx);
                      const remaining = Math.max(0, need - (rx.dispensedQty || 0));
                      const stock = rx.medication?.quantity;
                      const insufficient = stock !== undefined && stock < remaining;
                      return (
                        <tr key={rx.id} className={insufficient ? "bg-amber-50/40 hover:bg-amber-50" : rx.status === "REJECTED" ? "bg-red-50/30 hover:bg-red-50" : "hover:bg-gray-50"}>
                          <td className="td"><Link href={`/patients/${rx.patient.id}`} className="font-medium text-brand-700 hover:underline">{rx.patient.fullName}</Link><div className="text-xs text-gray-400">#{rx.patient.fileNumber}</div></td>
                          <td className="td font-medium">{rx.medication?.name ?? rx.materialName ?? "—"}</td>
                          <td className="td">{rx.quantity ?? rx.count ?? "—"}{rx.status === "PARTIAL" ? <div className="text-xs text-amber-700">المتبقي: {remaining || "—"}</div> : null}</td>
                          <td className="td">{badge((RX_STATUS as any)[rx.status] ?? rx.status, RX_STATUS_STYLE[rx.status])}</td>
                          <td className={`td ${insufficient ? "font-semibold text-amber-700" : ""}`}>{stock ?? "غير مفهرس"}{rx.medication?.unit ? ` ${rx.medication.unit}` : ""}</td>
                          <td className="td">{rx.doctor || "—"}</td>
                          <td className="td text-gray-500">{fmtDate(rx.prescribedAt)}</td>
                          <td className="td"><Link href={rx.status === "DISPENSED" ? `/pharmacy/rx/${rx.id}` : "/pharmacy"} className="text-brand-700 hover:underline">{rx.status === "DISPENSED" ? "عرض" : "فتح الصرف"}</Link></td>
                        </tr>
                      );
                    })}
                    {rxRows.length === 0 ? emptyRow(8, "لا توجد وصفات مطابقة.") : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : <NoAccess text="تحتاج صلاحية عرض الصيدلية." />}
        </AdminSection>
      ) : null}

      {activeTab === "stock" ? (
        <AdminSection id="stock" title="الأدوية والمخزون" description="البحث بالاسم أو الوحدة؛ لا يوجد حقل باركود في النموذج الحالي.">
          {canStock ? (
            <>
              <form action="/pharmacy-inventory" className="grid gap-3 md:grid-cols-5">
                <input type="hidden" name="tab" value="stock" />
                <label className="label">بحث<input name="medQ" defaultValue={sp.medQ ?? ""} className="input mt-1" placeholder="اسم الدواء أو الوحدة" /></label>
                <label className="label">الحالة<select name="stockState" defaultValue={sp.stockState ?? "all"} className="input mt-1">
                  <option value="all">كل الحالات</option>
                  <option value="low">تحت حد التنبيه</option>
                  <option value="out">نافد</option>
                  <option value="expiry">به دفعة قريبة/منتهية</option>
                  <option value="ok">جيد</option>
                </select></label>
                <div className="flex items-end gap-2 md:col-span-3">
                  <button className="btn-primary" type="submit">تطبيق</button>
                  <Link href="/pharmacy-inventory?tab=stock" className="btn-ghost">مسح</Link>
                  {canBatch ? <Link href="/pharmacy/stock" className="btn-ghost">إدارة الدفعات</Link> : null}
                </div>
              </form>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">الدواء</th><th className="th">المتوفر</th><th className="th">الوحدة</th><th className="th">حد التنبيه</th><th className="th">أقرب انتهاء</th><th className="th">الدفعات</th><th className="th">الحالة</th><th className="th">إجراء</th></tr></thead>
                  <tbody>
                    {filteredMedications.map((medication: any) => {
                      const state = stockState(medication);
                      const firstExpiry = medication.batches.find((batch: any) => batch.expiryDate)?.expiryDate ?? null;
                      return (
                        <tr key={medication.id} className={`${state.row} hover:bg-gray-50`}>
                          <td className="td font-medium">{medication.name}</td>
                          <td className="td font-bold">{numberValue(medication.quantity)}</td>
                          <td className="td">{medication.unit || "—"}</td>
                          <td className="td">{numberValue(medication.minQuantity)}</td>
                          <td className="td">{fmtDate(firstExpiry)}</td>
                          <td className="td">{medication.batches.length}</td>
                          <td className="td">{badge(state.label, state.cls)}</td>
                          <td className="td"><Link href={buildLink("/pharmacy/stock", { q: medication.name })} className="text-brand-700 hover:underline">فتح</Link></td>
                        </tr>
                      );
                    })}
                    {filteredMedications.length === 0 ? emptyRow(8, "لا توجد أدوية مطابقة.") : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : <NoAccess text="تحتاج صلاحية عرض المخزون أو الصيدلية." />}
        </AdminSection>
      ) : null}

      {activeTab === "batches" ? (
        <AdminSection id="batches" title="الدفعات والصلاحية" description="فلترة الدفعات حسب الصلاحية والمورّد وأمر الشراء المرتبط.">
          {canStock ? (
            <>
              <form action="/pharmacy-inventory" className="grid gap-3 md:grid-cols-6">
                <input type="hidden" name="tab" value="batches" />
                <label className="label">بحث<input name="batchQ" defaultValue={sp.batchQ ?? ""} className="input mt-1" placeholder="دواء، دفعة، مورّد، أمر" /></label>
                <label className="label">الحالة<select name="batchState" defaultValue={batchStateFilter} className="input mt-1">
                  <option value="all">كل الدفعات</option>
                  <option value="expired">منتهية</option>
                  <option value="soon">قريبة الانتهاء</option>
                  <option value="no_expiry">بدون تاريخ</option>
                </select></label>
                <label className="label">المورّد<select name="batchSupplier" defaultValue={sp.batchSupplier ?? ""} className="input mt-1">
                  <option value="">كل الموردين</option>
                  {suppliers.map((supplier: any) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select></label>
                <label className="label">من انتهاء<input name="expiryFrom" type="date" defaultValue={sp.expiryFrom ?? ""} className="input mt-1" /></label>
                <label className="label">إلى انتهاء<input name="expiryTo" type="date" defaultValue={sp.expiryTo ?? ""} className="input mt-1" /></label>
                <div className="flex items-end gap-2">
                  <button className="btn-primary" type="submit">تطبيق</button>
                  <Link href="/pharmacy-inventory?tab=batches" className="btn-ghost">مسح</Link>
                </div>
              </form>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">الدواء</th><th className="th">رقم الدفعة</th><th className="th">المورّد</th><th className="th">الكمية</th><th className="th">الانتهاء</th><th className="th">الحالة</th><th className="th">أمر/استلام</th><th className="th">إدخال</th></tr></thead>
                  <tbody>
                    {batchRows.map((batch: any) => {
                      const state = batchState(batch, now, soon);
                      return (
                        <tr key={batch.id} className={`${state.row} hover:bg-gray-50`}>
                          <td className="td font-medium">{batch.medication.name}</td>
                          <td className="td">{batch.batchNo || "—"}</td>
                          <td className="td">{batch.supplier?.name || "—"}</td>
                          <td className="td font-bold">{numberValue(batch.quantity)}{batch.medication.unit ? ` ${batch.medication.unit}` : ""}</td>
                          <td className="td">{fmtDate(batch.expiryDate)}</td>
                          <td className="td">{badge(state.label, state.cls)}</td>
                          <td className="td">{batch.purchaseOrder ? <Link href={`/pharmacy/purchases/${batch.purchaseOrder.id}`} className="text-brand-700 hover:underline">{batch.purchaseOrder.orderNo}</Link> : batch.purchaseReceipt?.receiptNo ?? "—"}</td>
                          <td className="td text-gray-500">{fmtDate(batch.receivedAt)}</td>
                        </tr>
                      );
                    })}
                    {batchRows.length === 0 ? emptyRow(8, "لا توجد دفعات مطابقة.") : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : <NoAccess text="تحتاج صلاحية عرض المخزون أو الصيدلية." />}
        </AdminSection>
      ) : null}

      {activeTab === "purchases" ? (
        <AdminSection id="purchases" title="أوامر الشراء" description="لا تظهر مبالغ الشراء إلا لمن يملك صلاحية عرض الأسعار.">
          {canPurchase ? (
            <>
              <form action="/pharmacy-inventory" className="grid gap-3 md:grid-cols-6">
                <input type="hidden" name="tab" value="purchases" />
                <label className="label">بحث<input name="purchaseQ" defaultValue={sp.purchaseQ ?? ""} className="input mt-1" placeholder="رقم الأمر أو ملاحظة" /></label>
                <label className="label">الحالة<select name="purchaseStatus" defaultValue={sp.purchaseStatus ?? "all"} className="input mt-1">
                  <option value="all">كل الحالات</option>
                  {Object.entries(PURCHASE_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
                </select></label>
                <label className="label">المورّد<select name="purchaseSupplier" defaultValue={sp.purchaseSupplier ?? ""} className="input mt-1">
                  <option value="">كل الموردين</option>
                  {suppliers.map((supplier: any) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select></label>
                <label className="label">من<input name="purchaseFrom" type="date" defaultValue={sp.purchaseFrom ?? ""} className="input mt-1" /></label>
                <label className="label">إلى<input name="purchaseTo" type="date" defaultValue={sp.purchaseTo ?? ""} className="input mt-1" /></label>
                <div className="flex items-end gap-2">
                  <button className="btn-primary" type="submit">تطبيق</button>
                  <Link href="/pharmacy-inventory?tab=purchases" className="btn-ghost">مسح</Link>
                </div>
              </form>
              <div className="flex flex-wrap gap-2">
                {canPurchaseCreate ? <Link href="/pharmacy/purchases" className="btn-ghost btn-sm">إنشاء أمر شراء</Link> : null}
                <Link href="/pharmacy/purchases/reports" className="btn-ghost btn-sm">تقارير الشراء</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">رقم الأمر</th><th className="th">المورّد</th><th className="th">الحالة</th><th className="th">التاريخ</th><th className="th">التسليم المتوقع</th><th className="th">البنود</th><th className="th">الاستلامات</th>{canPurchasePrices ? <th className="th">إجمالي تقديري</th> : null}<th className="th">متابعة</th></tr></thead>
                  <tbody>
                    {orders.map((order: any) => {
                      const delayed = isPurchaseDelayed(order, now);
                      return (
                        <tr key={order.id} className={delayed ? "bg-red-50/40 hover:bg-red-50" : order.status === "PARTIALLY_RECEIVED" ? "bg-orange-50/30 hover:bg-orange-50" : "hover:bg-gray-50"}>
                          <td className="td"><Link href={`/pharmacy/purchases/${order.id}`} className="font-medium text-brand-700 hover:underline">{order.orderNo}</Link><div className="text-xs text-gray-400">{order.createdBy?.fullName || "—"}</div></td>
                          <td className="td">{order.supplier.name}</td>
                          <td className="td">{badge(PURCHASE_STATUS[order.status]?.label ?? order.status, PURCHASE_STATUS[order.status]?.cls)}</td>
                          <td className="td">{fmtDate(order.orderDate)}</td>
                          <td className={`td ${delayed ? "font-semibold text-red-700" : ""}`}>{fmtDate(order.expectedDeliveryDate)}</td>
                          <td className="td">{order._count.items}</td>
                          <td className="td">{order._count.receipts}</td>
                          {canPurchasePrices ? <td className="td">{moneyValue(orderTotal(order))}</td> : null}
                          <td className="td">{delayed ? badge("متأخر", "bg-red-50 text-red-700") : order.status === "PARTIALLY_RECEIVED" ? badge("يحتاج إكمال", "bg-orange-50 text-orange-700") : <Link href={`/pharmacy/purchases/${order.id}`} className="text-brand-700 hover:underline">فتح</Link>}</td>
                        </tr>
                      );
                    })}
                    {orders.length === 0 ? emptyRow(canPurchasePrices ? 9 : 8, "لا توجد أوامر شراء مطابقة.") : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : <NoAccess text="تحتاج صلاحية عرض أوامر الشراء." />}
        </AdminSection>
      ) : null}

      {activeTab === "receipts" ? (
        <AdminSection id="receipts" title="الاستلام" description="سجل الاستلام المرتبط بأوامر الشراء، مع كميات مقبولة ومرفوضة وتالفة.">
          {canPurchase ? (
            <>
              <form action="/pharmacy-inventory" className="grid gap-3 md:grid-cols-5">
                <input type="hidden" name="tab" value="receipts" />
                <label className="label">رقم الأمر<input name="receiptOrder" defaultValue={sp.receiptOrder ?? ""} className="input mt-1" placeholder="PO..." /></label>
                <label className="label">المورّد<select name="receiptSupplier" defaultValue={sp.receiptSupplier ?? ""} className="input mt-1">
                  <option value="">كل الموردين</option>
                  {suppliers.map((supplier: any) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select></label>
                <label className="label">من<input name="receiptFrom" type="date" defaultValue={sp.receiptFrom ?? ""} className="input mt-1" /></label>
                <label className="label">إلى<input name="receiptTo" type="date" defaultValue={sp.receiptTo ?? ""} className="input mt-1" /></label>
                <div className="flex items-end gap-2">
                  <button className="btn-primary" type="submit">تطبيق</button>
                  <Link href="/pharmacy-inventory?tab=receipts" className="btn-ghost">مسح</Link>
                </div>
              </form>
              {canPurchaseReceive ? <div className="rounded-lg border border-brand-100 bg-brand-50/40 px-3 py-2 text-sm text-brand-800">تسجيل الاستلام يتم من صفحة أمر الشراء نفسه بعد فتح الأمر المعتمد أو المطلوب من المورد.</div> : null}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">رقم الاستلام</th><th className="th">أمر الشراء</th><th className="th">المورّد</th><th className="th">التاريخ</th><th className="th">المدخل</th><th className="th">مقبول</th><th className="th">مرفوض/تالف</th><th className="th">بنود</th></tr></thead>
                  <tbody>
                    {receipts.map((receipt: any) => {
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
              </div>
            </>
          ) : <NoAccess text="تحتاج صلاحية عرض أوامر الشراء." />}
        </AdminSection>
      ) : null}

      {activeTab === "alerts" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <AdminSection id="alerts-rx" title="وصفات مؤهلة غير مصروفة" description="أولوية المتابعة حسب الأقدم.">
            {canPharmacy ? (
              <AlertList>
                {rxAlerts.map((rx: any) => (
                  <AlertItem key={rx.id} href="/pharmacy" tone="amber" title={rx.medication?.name ?? rx.materialName ?? "وصفة"} meta={`${rx.patient.fullName} · #${rx.patient.fileNumber} · ${fmtDate(rx.prescribedAt)}`} />
                ))}
                {rxAlerts.length === 0 ? <p className="py-4 text-center text-sm text-gray-400">لا توجد وصفات معلقة.</p> : null}
              </AlertList>
            ) : <NoAccess text="تحتاج صلاحية عرض الصيدلية." />}
          </AdminSection>

          <AdminSection id="alerts-low-stock" title="أدوية ناقصة" description="الكميات عند حد التنبيه أو أدنى منه.">
            {canStock ? (
              <AlertList>
                {lowMedications.slice(0, 20).map((medication: any) => (
                  <AlertItem key={medication.id} href={buildLink("/pharmacy-inventory", { tab: "stock", medQ: medication.name })} tone={medication.quantity <= 0 ? "red" : "amber"} title={medication.name} meta={`${numberValue(medication.quantity)} متوفر · حد التنبيه ${numberValue(medication.minQuantity)}${medication.unit ? ` ${medication.unit}` : ""}`} />
                ))}
                {lowMedications.length === 0 ? <p className="py-4 text-center text-sm text-gray-400">لا توجد نواقص مخزون.</p> : null}
              </AlertList>
            ) : <NoAccess text="تحتاج صلاحية عرض المخزون أو الصيدلية." />}
          </AdminSection>

          <AdminSection id="alerts-expiry" title="دفعات قريبة أو منتهية" description={`دفعات لديها كمية متبقية وتنتهي خلال ${CLOSE_EXPIRY_DAYS} يوم أو انتهت.`}>
            {canStock ? (
              <AlertList>
                {expiryAlerts.slice(0, 20).map((batch: any) => {
                  const state = batchState(batch, now, soon);
                  return (
                    <AlertItem key={batch.id} href={buildLink("/pharmacy-inventory", { tab: "batches", batchQ: batch.batchNo || batch.medication.name })} tone={state.key === "expired" ? "red" : "orange"} title={`${batch.medication.name}${batch.batchNo ? ` · ${batch.batchNo}` : ""}`} meta={`${state.label} · ${fmtDate(batch.expiryDate)} · ${numberValue(batch.quantity)}${batch.medication.unit ? ` ${batch.medication.unit}` : ""}`} />
                  );
                })}
                {expiryAlerts.length === 0 ? <p className="py-4 text-center text-sm text-gray-400">لا توجد دفعات قريبة أو منتهية.</p> : null}
              </AlertList>
            ) : <NoAccess text="تحتاج صلاحية عرض المخزون أو الصيدلية." />}
          </AdminSection>

          <AdminSection id="alerts-purchases" title="أوامر شراء تحتاج متابعة" description="أوامر متأخرة أو مستلمة جزئياً أو بانتظار الاعتماد.">
            {canPurchase ? (
              <AlertList>
                {overdueOrders.map((order: any) => (
                  <AlertItem key={order.id} href={`/pharmacy/purchases/${order.id}`} tone="red" title={order.orderNo} meta={`${order.supplier.name} · متأخر منذ ${fmtDate(order.expectedDeliveryDate)} · ${order._count.items} بند`} />
                ))}
                {orders.filter((order: any) => ["PENDING_APPROVAL", "PARTIALLY_RECEIVED"].includes(order.status)).slice(0, 10).map((order: any) => (
                  <AlertItem key={order.id} href={`/pharmacy/purchases/${order.id}`} tone={order.status === "PENDING_APPROVAL" ? "amber" : "orange"} title={order.orderNo} meta={`${order.supplier.name} · ${PURCHASE_STATUS[order.status]?.label ?? order.status} · ${order._count.receipts} استلام`} />
                ))}
                {overdueOrders.length === 0 && orders.filter((order: any) => ["PENDING_APPROVAL", "PARTIALLY_RECEIVED"].includes(order.status)).length === 0 ? <p className="py-4 text-center text-sm text-gray-400">لا توجد أوامر شراء تحتاج متابعة عاجلة.</p> : null}
              </AlertList>
            ) : <NoAccess text="تحتاج صلاحية عرض أوامر الشراء." />}
          </AdminSection>
        </div>
      ) : null}

      {activeTab === "reports" ? (
        <div className="space-y-5">
          <AdminSection id="reports-movement" title="حركة الصيدلية والمخزون" description="آخر حركات الإدخال والصرف والإتلاف والتعديل ضمن الفترة.">
            {canStock ? (
              <>
                <form action="/pharmacy-inventory" className="grid gap-3 md:grid-cols-5">
                  <input type="hidden" name="tab" value="reports" />
                  <label className="label">من<input name="moveFrom" type="date" defaultValue={sp.moveFrom ?? localDateInput(monthStart)} className="input mt-1" /></label>
                  <label className="label">إلى<input name="moveTo" type="date" defaultValue={sp.moveTo ?? ""} className="input mt-1" /></label>
                  <label className="label">النوع<select name="moveType" defaultValue={sp.moveType ?? "all"} className="input mt-1">
                    <option value="all">كل الحركات</option>
                    {Object.entries(MOVE_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select></label>
                  <label className="label">الدواء<select name="moveMedication" defaultValue={sp.moveMedication ?? ""} className="input mt-1">
                    <option value="">كل الأدوية</option>
                    {medicationsForStats.map((medication: any) => <option key={medication.id} value={medication.id}>{medication.name}</option>)}
                  </select></label>
                  <div className="flex items-end gap-2">
                    <button className="btn-primary" type="submit">تطبيق</button>
                    <Link href="/pharmacy-inventory?tab=reports" className="btn-ghost">مسح</Link>
                  </div>
                </form>
                <div className="grid gap-5 xl:grid-cols-2">
                  <div className="rounded-lg border border-gray-100 p-3">
                    <h3 className="mb-3 text-sm font-semibold text-gray-700">الأكثر صرفاً هذا الشهر</h3>
                    <div className="space-y-2">
                      {topDispensedRows.map((row) => (
                        <div key={row.id} className="flex items-center gap-2 text-sm">
                          <span className="w-32 shrink-0 truncate text-gray-700" title={row.name}>{row.name}</span>
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(row.quantity / maxTopDispensed) * 100}%` }} /></div>
                          <span className="w-12 text-left font-bold text-gray-700">{numberValue(row.quantity)}</span>
                        </div>
                      ))}
                      {topDispensedRows.length === 0 ? <p className="py-4 text-center text-sm text-gray-400">لا توجد حركات صرف هذا الشهر.</p> : null}
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-100 p-3">
                    <h3 className="mb-3 text-sm font-semibold text-gray-700">ملخص الشراء</h3>
                    {canPurchase ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <MetricLine label="المطلوب" value={numberValue(orderedQuantity)} />
                        <MetricLine label="المستلم" value={numberValue(receivedQuantity)} />
                        <MetricLine label="المرفوض/التالف" value={numberValue(rejectedOrDamagedQuantity)} tone="text-amber-700" />
                        <MetricLine label="أوامر متأخرة" value={numberValue(overduePurchaseCount)} tone="text-red-700" />
                        {canPurchasePrices ? <MetricLine label="إجمالي أسعار الوحدات" value={moneyValue(purchaseItemAgg?._sum.unitPrice ?? 0)} /> : null}
                      </div>
                    ) : <NoAccess text="تحتاج صلاحية عرض أوامر الشراء." />}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr><th className="th">التاريخ</th><th className="th">النوع</th><th className="th">الدواء</th><th className="th">الكمية</th><th className="th">المريض/السبب</th><th className="th">المنفذ</th></tr></thead>
                    <tbody>
                      {movements.map((move: any) => (
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
                </div>
              </>
            ) : <NoAccess text="تحتاج صلاحية عرض المخزون أو الصيدلية." />}
          </AdminSection>

          {canPurchase ? (
            <AdminSection id="reports-purchase-status" title="حالات أوامر الشراء" description="توزيع أوامر الشراء حسب الحالة الحالية.">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">الحالة</th><th className="th">العدد</th></tr></thead>
                  <tbody>
                    {purchaseStatusRows.map((row: any) => (
                      <tr key={row.status} className="hover:bg-gray-50">
                        <td className="td">{badge(PURCHASE_STATUS[row.status]?.label ?? row.status, PURCHASE_STATUS[row.status]?.cls)}</td>
                        <td className="td font-bold">{numberValue(row._count._all)}</td>
                      </tr>
                    ))}
                    {purchaseStatusRows.length === 0 ? emptyRow(2, "لا توجد أوامر شراء بعد.") : null}
                  </tbody>
                </table>
              </div>
            </AdminSection>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NoAccess({ text }: { text: string }) {
  return <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">{text}</div>;
}

function MiniList({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
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

function MetricLine({ label, value, tone = "text-gray-800" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
      <div className={`text-lg font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function AlertList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

function AlertItem({ href, title, meta, tone }: { href: string; title: string; meta: string; tone: "red" | "amber" | "orange" }) {
  const cls = tone === "red" ? "border-red-100 bg-red-50/40" : tone === "orange" ? "border-orange-100 bg-orange-50/40" : "border-amber-100 bg-amber-50/40";
  return (
    <Link href={href} className={`block rounded-lg border px-3 py-2 text-sm transition hover:border-brand-200 hover:bg-white ${cls}`}>
      <div className="font-medium text-gray-900">{title}</div>
      <div className="mt-1 text-xs text-gray-600">{meta}</div>
    </Link>
  );
}
