import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { PharmacyNav } from "@/components/PharmacyNav";
import { requirePerm } from "@/lib/access";
import { fmtDate } from "@/lib/labels";
import Link from "next/link";

export const dynamic = "force-dynamic";

const AR_MONTHS = ["كانون2", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين1", "تشرين2", "كانون1"];

export default async function PharmacyReports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; patient?: string; med?: string }> }) {
  await requirePerm("pharmacy.view");
  const sp = await searchParams;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const d90 = new Date(now.getTime() + 90 * 86400000);
  const from = sp.from ? new Date(sp.from + "T00:00:00") : monthStart;
  const to = sp.to ? new Date(sp.to + "T23:59:59") : now;
  const medId = sp.med ? Number(sp.med) : null;
  const dispenseWhere: any = { type: "DISPENSE", createdAt: { gte: from, lte: to } };
  if (sp.patient) dispenseWhere.patientName = { contains: sp.patient, mode: "insensitive" };
  if (medId && !Number.isNaN(medId)) dispenseWhere.medicationId = medId;

  const [topMonth, topAll, lowMeds, allMeds, soonBatches, monthlyRaw, movements, meds] = await Promise.all([
    prisma.stockMovement.groupBy({ by: ["medicationId"], where: { type: "DISPENSE", createdAt: { gte: monthStart } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 10 }),
    prisma.stockMovement.groupBy({ by: ["medicationId"], where: { type: "DISPENSE" }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 10 }),
    prisma.medication.findMany({ orderBy: { name: "asc" } }),
    prisma.medication.aggregate({ _sum: { quantity: true }, _count: true }),
    prisma.medicationBatch.findMany({ where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: d90 } }, include: { medication: true, supplier: true }, orderBy: { expiryDate: "asc" }, take: 30 }),
    prisma.stockMovement.findMany({ where: { type: "DISPENSE", createdAt: { gte: sixMonthsAgo } }, select: { createdAt: true, quantity: true } }),
    prisma.stockMovement.findMany({ where: dispenseWhere, include: { medication: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.medication.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const medMap = new Map(lowMeds.map((m) => [m.id, m]));
  const low = lowMeds.filter((m) => m.quantity <= m.minQuantity);
  const totalUnits = allMeds._sum.quantity ?? 0;
  const periodTotal = movements.reduce((sum, m) => sum + m.quantity, 0);
  const byPatient = Array.from(movements.reduce((map, m) => {
    const key = m.patientName || "غير محدد";
    map.set(key, (map.get(key) || 0) + m.quantity);
    return map;
  }, new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const byMaterial = Array.from(movements.reduce((map, m) => {
    const key = m.medication.name;
    map.set(key, (map.get(key) || 0) + m.quantity);
    return map;
  }, new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);

  // استهلاك شهري
  const monthly: Record<string, number> = {};
  for (const mv of monthlyRaw) {
    const d = new Date(mv.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthly[key] = (monthly[key] ?? 0) + mv.quantity;
  }
  const months: { label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: AR_MONTHS[d.getMonth()], value: monthly[`${d.getFullYear()}-${d.getMonth()}`] ?? 0 });
  }
  const maxMonth = Math.max(1, ...months.map((m) => m.value));

  const TopList = ({ rows }: { rows: { medicationId: number; _sum: { quantity: number | null } }[] }) => (
    <div className="space-y-1.5">
      {rows.length === 0 && <p className="py-3 text-center text-sm text-gray-400">لا بيانات صرف بعد.</p>}
      {rows.map((r, i) => {
        const max = rows[0]?._sum.quantity || 1;
        const v = r._sum.quantity ?? 0;
        return (
          <div key={r.medicationId} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-gray-400">{i + 1}</span>
            <span className="w-32 shrink-0 truncate font-medium text-gray-700">{medMap.get(r.medicationId)?.name ?? `#${r.medicationId}`}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(v / max) * 100}%` }} /></div>
            <span className="w-10 text-left font-bold text-gray-700">{v}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="تقارير الصيدلية" subtitle="الصرف والاستهلاك والنفاذية" icon="📊" />
      <PharmacyNav />

      <form action="/pharmacy/reports" className="card flex flex-wrap items-end gap-2 p-4">
        <div><label className="label">من</label><input name="from" type="date" className="input" defaultValue={sp.from ?? `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`} /></div>
        <div><label className="label">إلى</label><input name="to" type="date" className="input" defaultValue={sp.to ?? ""} /></div>
        <div className="min-w-[160px] flex-1"><label className="label">المريض</label><input name="patient" className="input" defaultValue={sp.patient ?? ""} placeholder="اسم المريض" /></div>
        <div><label className="label">المادة</label><select name="med" className="input" defaultValue={sp.med ?? ""}><option value="">كل المواد</option>{meds.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        <button className="btn-primary" type="submit">تطبيق</button>
        <Link href="/pharmacy/reports" className="btn-ghost">مسح</Link>
      </form>

      {/* بطاقات ملخّص */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["إجمالي الوحدات", totalUnits], ["صرف الفترة", periodTotal], ["تحت حد التنبيه", low.length], ["دفعات قريبة النفاذ", soonBatches.length]].map(([l, v]) => (
          <div key={l as string} className="card p-4 text-center">
            <div className="text-2xl font-bold text-gray-800">{v as number}</div>
            <div className="text-xs text-gray-400">{l}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title="الصرف حسب المريض" rows={byPatient} />
        <Breakdown title="الصرف حسب المادة" rows={byMaterial} />
      </div>

      <div className="card overflow-x-auto">
        <h2 className="p-4 font-semibold text-gray-700">حركات الصرف حسب الفترة</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="th">التاريخ</th><th className="th">المادة</th><th className="th">المريض</th><th className="th">الكمية</th><th className="th">المنفذ</th></tr></thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="td">{fmtDate(m.createdAt)}</td>
                <td className="td font-medium">{m.medication.name}</td>
                <td className="td">{m.patientName || "—"}</td>
                <td className="td font-bold">{m.quantity}</td>
                <td className="td">{m.byName || "—"}</td>
              </tr>
            ))}
            {movements.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={5}>لا توجد حركات صرف ضمن الفلاتر.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4"><h2 className="mb-3 font-semibold text-gray-700">الأكثر صرفاً — هذا الشهر</h2><TopList rows={topMonth} /></div>
        <div className="card p-4"><h2 className="mb-3 font-semibold text-gray-700">الأكثر صرفاً — كل الفترة</h2><TopList rows={topAll} /></div>
      </div>

      {/* استهلاك شهري */}
      <div className="card p-4">
        <h2 className="mb-4 font-semibold text-gray-700">الاستهلاك الشهري (آخر 6 أشهر)</h2>
        <div className="flex items-end justify-between gap-2" style={{ height: 140 }}>
          {months.map((m) => (
            <div key={m.label} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-xs font-medium text-gray-600">{m.value}</span>
              <div className="w-full rounded-t bg-brand-500" style={{ height: `${(m.value / maxMonth) * 100}%`, minHeight: m.value > 0 ? 4 : 0 }} />
              <span className="text-xs text-gray-400">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* الأقرب نفاذاً */}
      <div className="card overflow-x-auto">
        <h2 className="p-4 font-semibold text-gray-700">الأقرب نفاذاً</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="th">المادة</th><th className="th">الدفعة</th><th className="th">المورد</th><th className="th">النفاذية</th><th className="th">الحالة</th><th className="th">المتبقّي</th></tr></thead>
          <tbody>
            {soonBatches.map((b) => {
              const expired = b.expiryDate && new Date(b.expiryDate) < now;
              const within60 = b.expiryDate && new Date(b.expiryDate).getTime() <= now.getTime() + 60 * 86400000;
              return (
                <tr key={b.id} className={`hover:bg-gray-50 ${expired ? "bg-red-50/40" : ""}`}>
                  <td className="td font-medium">{b.medication.name}</td>
                  <td className="td">{b.batchNo || "—"}</td>
                  <td className="td">{b.supplier?.name || "—"}</td>
                  <td className={`td ${expired ? "font-bold text-red-700" : ""}`}>{fmtDate(b.expiryDate)}{expired ? " ⚠" : ""}</td>
                  <td className="td">{expired ? <span className="badge-danger">منتهية</span> : within60 ? <span className="badge-warning">قريبة</span> : <span className="badge-neutral">جيدة</span>}</td>
                  <td className="td font-bold">{b.quantity}</td>
                </tr>
              );
            })}
            {soonBatches.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={6}>لا توجد دفعات بتواريخ نفاذية.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="p-4 font-semibold text-gray-700">المواد المنخفضة أو النافدة</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="th">المادة</th><th className="th">المتوفر</th><th className="th">حد التنبيه</th><th className="th">الحالة</th></tr></thead>
          <tbody>
            {low.map((m) => (
              <tr key={m.id} className="bg-red-50/30 hover:bg-red-50">
                <td className="td font-medium">{m.name}</td>
                <td className="td font-bold">{m.quantity}</td>
                <td className="td">{m.minQuantity}</td>
                <td className="td">{m.quantity <= 0 ? <span className="badge-danger">نافد</span> : <span className="badge-warning">منخفض</span>}</td>
              </tr>
            ))}
            {low.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={4}>لا توجد مواد تحت حد التنبيه.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="card p-4">
      <h2 className="mb-3 font-semibold text-gray-700">{title}</h2>
      {rows.length === 0 && <p className="py-3 text-center text-sm text-gray-400">لا بيانات ضمن الفترة.</p>}
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center gap-2 text-sm">
            <span className="w-36 shrink-0 truncate text-gray-700" title={label}>{label}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(value / max) * 100}%` }} /></div>
            <span className="w-10 text-left font-bold text-gray-700">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
