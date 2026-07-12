import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { PharmacyNav } from "@/components/PharmacyNav";
import { DispenseQueue } from "@/components/DispenseQueue";
import { requirePerm, currentPerms } from "@/lib/access";
import { fmtDate } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function PharmacyPage() {
  await requirePerm("pharmacy.view");
  const perms = await currentPerms();
  const cDispense = perms.has("pharmacy.dispense");
  const cPartial = perms.has("pharmacy.dispense.partial");
  const cPrint = perms.has("pharmacy.print");

  const now = new Date();
  const d30 = new Date(now.getTime() + 30 * 86400000);
  const d90 = new Date(now.getTime() + 90 * 86400000);

  const [pending, expiring, lowMeds] = await Promise.all([
    prisma.prescription.findMany({
      where: { isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE" },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, medication: true },
      orderBy: { prescribedAt: "asc" },
    }),
    prisma.medicationBatch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: d90 } },
      include: { medication: true, supplier: true },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.medication.findMany({ orderBy: { name: "asc" } }),
  ]);
  const lowList = lowMeds.filter((m) => m.quantity <= m.minQuantity);

  const expired = expiring.filter((b) => b.expiryDate && new Date(b.expiryDate) < now);
  const soon30 = expiring.filter((b) => b.expiryDate && new Date(b.expiryDate) >= now && new Date(b.expiryDate) <= d30);
  const soon90 = expiring.filter((b) => b.expiryDate && new Date(b.expiryDate) > d30 && new Date(b.expiryDate) <= d90);

  // تجميع الوصفات حسب المريض (بدون تكرار اسم المريض)
  const groupMap = new Map<string, { patient: any; items: any[] }>();
  for (const rx of pending) {
    const k = rx.patient.id;
    if (!groupMap.has(k)) groupMap.set(k, { patient: rx.patient, items: [] });
    groupMap.get(k)!.items.push(rx);
  }
  const groups = Array.from(groupMap.values());

  return (
    <div className="space-y-5">
      <PageHeader title="الصيدلية" subtitle="تجهيز الوصفات وإدارة المخزون والنفاذية" icon="⚕️">
        {pending.length > 0 && <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-medium">{pending.length} وصفة بانتظار التجهيز</span>}
      </PageHeader>
      <PharmacyNav />

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryAlert title="وصفات قيد الانتظار" value={pending.length} tone={pending.length ? "amber" : "green"} href="/pharmacy" />
        <SummaryAlert title="مواد منخفضة/نافدة" value={lowList.length} tone={lowList.length ? "red" : "green"} href="/pharmacy/stock" />
        <SummaryAlert title="دفعات قريبة/منتهية" value={expiring.length} tone={expiring.length ? "amber" : "green"} href="/pharmacy/reports" />
      </div>

      {/* تنبيهات النفاذية المتدرّجة */}
      {(expired.length > 0 || soon30.length > 0 || soon90.length > 0) && (
        <div className="grid gap-3 md:grid-cols-3">
          <AlertCard title="منتهية الصلاحية" rows={expired} color="red" now={now} />
          <AlertCard title="تنتهي خلال شهر" rows={soon30} color="amber" now={now} />
          <AlertCard title="تنتهي خلال 3 أشهر" rows={soon90} color="sky" now={now} />
        </div>
      )}

      {/* قائمة التجهيز — بطاقة لكل مريض */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-700">قائمة التجهيز</h2>
          <span className="badge-brand">{groups.length} مريض · {pending.length} وصفة</span>
        </div>
        <DispenseQueue groups={JSON.parse(JSON.stringify(groups))} cDispense={cDispense} cPartial={cPartial} cPrint={cPrint} />
      </div>
    </div>
  );
}

function AlertCard({ title, rows, color, now }: { title: string; rows: any[]; color: "red" | "amber" | "sky"; now: Date }) {
  const head: Record<string, string> = { red: "bg-red-50 text-red-800", amber: "bg-amber-50 text-amber-800", sky: "bg-sky-50 text-sky-800" };
  return (
    <div className="card p-4">
      <div className={`mb-2 flex items-center justify-between rounded-lg px-3 py-1.5 text-sm font-semibold ${head[color]}`}>
        <span>{title}</span><span>{rows.length}</span>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {rows.length === 0 && <p className="py-2 text-center text-xs text-gray-400">لا يوجد</p>}
        {rows.map((b) => (
          <div key={b.id} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-gray-50">
            <span className="font-medium text-gray-700">{b.medication.name}{b.batchNo ? ` (${b.batchNo})` : ""}</span>
            <span className="text-gray-500">{fmtDate(b.expiryDate)} · {b.quantity}{b.supplier?.name ? ` · ${b.supplier.name}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryAlert({ title, value, tone, href }: { title: string; value: number; tone: "red" | "amber" | "green"; href: string }) {
  const cls = tone === "red" ? "border-red-200 bg-red-50 text-red-800" : tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800";
  return (
    <a href={href} className={`rounded-xl border p-4 transition hover:shadow-sm ${cls}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm font-medium">{title}</div>
    </a>
  );
}
