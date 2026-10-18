import Link from "next/link";
import { pharmacyPrescriptionWhere } from "@/lib/pharmacy-scope";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { DispenseQueue } from "@/components/DispenseQueue";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { requirePerm } from "@/lib/access";
import { baghdadDayRange } from "@/lib/display-utils";
import { PHARMACY_NAV } from "@/lib/hub-nav";
import { fmtDate, RX_STATUS } from "@/lib/labels";

export const dynamic = "force-dynamic";

const RX_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  PARTIAL: "bg-orange-50 text-orange-700",
  DISPENSED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
};

const STATES: Record<string, string> = {
  pending: "بانتظار الصرف (قائمة التجهيز)",
  partial: "مصروفة جزئياً",
  dispensedToday: "مصروفة اليوم",
  DISPENSED: "كل المصروفة",
  REJECTED: "مرفوضة",
  all: "كل الوصفات",
};

function rxSearch(q: string) {
  return [
    { patient: { fullName: { contains: q, mode: "insensitive" } } },
    ...(Number.isNaN(Number(q)) ? [] : [{ patient: { fileNumber: Number(q) } }]),
    { medication: { name: { contains: q, mode: "insensitive" } } },
    { materialName: { contains: q, mode: "insensitive" } },
    { doctor: { contains: q, mode: "insensitive" } },
  ];
}

function rxNeed(rx: { count: number | null; quantity: string | null }) {
  return rx.count && rx.count > 0 ? rx.count : parseInt((rx.quantity || "").match(/\d+/)?.[0] || "0", 10) || 1;
}

/** Dispensing: the work queue by patient, and (with another state picked) the prescription history. */
export default async function PharmacyPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  const perms = await requirePerm("pharmacy.view");
  const sp = await searchParams;
  const cDispense = perms.has("pharmacy.dispense");
  const cPartial = perms.has("pharmacy.dispense.partial");
  const cPrint = perms.has("pharmacy.print");
  const state = sp.state && sp.state in STATES ? sp.state : "pending";
  const q = (sp.q ?? "").trim();

  const where: any = {};
  if (state === "pending") Object.assign(where, { isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", visitId: { not: null } });
  else if (state === "partial") where.status = "PARTIAL";
  else if (state === "dispensedToday") {
    const { start, end } = baghdadDayRange(new Date());
    Object.assign(where, { isDispensed: true, dispensedAt: { gte: start, lt: end } });
  } else if (state !== "all") where.status = state;
  if (q) where.OR = rxSearch(q);
  // Independent branch pharmacies: only prescriptions originating at this pharmacist's branch (ADMIN: all, read-only).
  where.AND = [await pharmacyPrescriptionWhere()];

  const found = await prisma.prescription.findMany({
    where,
    include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, medication: true },
    orderBy: { prescribedAt: state === "pending" ? "asc" : "desc" },
    take: state === "pending" ? undefined : 200,
  });
  // Legacy prescriptions without a verified Visit stay visible in history but cannot be dispensed until reconciled.
  const legacyNoVisit = state === "pending" ? await prisma.prescription.count({ where: { AND: [await pharmacyPrescriptionWhere()], isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", visitId: null } }) : 0;
  // Stock shown next to a prescription = dispensable (non-expired) quantity of the ORIGIN branch only.
  const medIds = [...new Set(found.map((r) => r.medicationId).filter((id): id is number => id != null))];
  const stockRows = medIds.length ? await prisma.medicationBatch.groupBy({
    by: ["branchId", "medicationId"], _sum: { quantity: true },
    where: { medicationId: { in: medIds }, branchId: { not: null }, quantity: { gt: 0 }, OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }] },
  }) : [];
  const stockOf = new Map(stockRows.map((r) => [`${r.branchId}:${r.medicationId}`, r._sum.quantity ?? 0]));
  const rows = found.map((r) => ({ ...r, medication: r.medication ? { ...r.medication, quantity: r.originBranchId == null ? 0 : stockOf.get(`${r.originBranchId}:${r.medicationId}`) ?? 0 } : null }));

  // The queue groups prescriptions by patient so each name appears once.
  const groupMap = new Map<string, { patient: any; items: any[] }>();
  if (state === "pending") {
    for (const rx of rows) {
      if (!groupMap.has(rx.patient.id)) groupMap.set(rx.patient.id, { patient: rx.patient, items: [] });
      groupMap.get(rx.patient.id)!.items.push(rx);
    }
  }
  const groups = Array.from(groupMap.values());

  return (
    <div className="space-y-5">
      <PageHeader title="صرف الوصفات" subtitle="تجهيز الوصفات الداخلية المؤهلة وسجل الوصفات" icon="⚕️">
        {state === "pending" && rows.length > 0 ? <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-medium">{rows.length} وصفة بانتظار التجهيز</span> : null}
      </PageHeader>
      <HubTabs nav={PHARMACY_NAV} active="dispense" label="تبويبات الصيدلية والمخزون" perms={perms} />

      <FilterBar action="/pharmacy" query={sp.q} placeholder="مراجع، رقم ملف، دواء، أو طبيب…" activeCount={state === "pending" ? 0 : 1} clearHref="/pharmacy">
        <label className="label">الوصفات<select name="state" defaultValue={state} className="input mt-1">
          {Object.entries(STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </FilterBar>

      {legacyNoVisit > 0 ? <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{legacyNoVisit} وصفة داخلية قديمة بلا زيارة موثقة لا تُصرف حتى تُطابَق بإجراء المطابقة المعتمد.</p> : null}
      {state === "pending" ? (
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-gray-700">قائمة التجهيز</h2>
            <span className="badge-brand">{groups.length} مريض · {rows.length} وصفة</span>
          </div>
          <DispenseQueue groups={JSON.parse(JSON.stringify(groups))} cDispense={cDispense} cPartial={cPartial} cPrint={cPrint} />
        </div>
      ) : (
        <section className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="th">المراجع</th><th className="th">الدواء</th><th className="th">الكمية</th><th className="th">الحالة</th><th className="th">المخزون</th><th className="th">الطبيب</th><th className="th">التاريخ</th><th className="th"></th></tr></thead>
            <tbody>
              {rows.map((rx: any) => {
                const remaining = Math.max(0, rxNeed(rx) - (rx.dispensedQty || 0));
                const stock = rx.medication?.quantity;
                const insufficient = rx.status !== "DISPENSED" && stock !== undefined && stock < remaining;
                return (
                  <tr key={rx.id} className={insufficient ? "bg-amber-50/40" : rx.status === "REJECTED" ? "bg-red-50/30" : "hover:bg-gray-50"}>
                    <td className="td"><Link href={`/patients/${rx.patient.id}`} className="font-medium text-brand-700 hover:underline">{rx.patient.fullName}</Link><div className="text-xs text-gray-400">#{rx.patient.fileNumber}</div></td>
                    <td className="td font-medium">{rx.medication?.name ?? rx.materialName ?? "—"}</td>
                    <td className="td">{rx.quantity ?? rx.count ?? "—"}{rx.status === "PARTIAL" ? <div className="text-xs text-amber-700">المتبقي: {remaining || "—"}</div> : null}</td>
                    <td className="td"><span className={`badge ${RX_STATUS_STYLE[rx.status] ?? "bg-gray-100 text-gray-600"}`}>{(RX_STATUS as any)[rx.status] ?? rx.status}</span></td>
                    <td className={`td ${insufficient ? "font-semibold text-amber-700" : ""}`}>{stock ?? "غير مفهرس"}{rx.medication?.unit ? ` ${rx.medication.unit}` : ""}</td>
                    <td className="td">{rx.doctor || "—"}</td>
                    <td className="td text-gray-500">{fmtDate(rx.prescribedAt)}</td>
                    <td className="td"><Link href={`/pharmacy/rx/${rx.id}`} className="text-brand-700 hover:underline">عرض</Link></td>
                  </tr>
                );
              })}
              {rows.length === 0 ? <tr><td colSpan={8} className="td py-8 text-center text-gray-500">لا توجد وصفات مطابقة.</td></tr> : null}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
