import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { requirePerm, currentPerms, getSession } from "@/lib/access";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { setStockSettings, createMedication } from "./actions";
import { currentStockViewer, batchViewWhere } from "@/lib/pharmacy-stock";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Inventory() {
  const session = await getSession();
  await requirePerm("inventory.view");
  const role = (session?.user as any)?.role;
  const perms = await currentPerms();
  const cManage = perms.has("inventory.manage");
  const isAdmin = canManageUsers(role);

  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 86400000);
  // Independent branch pharmacies: quantities are the viewer's own branch batches only (ADMIN: all branches, read-only).
  const viewer = await currentStockViewer();
  const rows = await prisma.medication.findMany({ include: { batches: { where: { quantity: { gt: 0 }, ...batchViewWhere(viewer) }, orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }] } }, orderBy: { name: "asc" } });
  const meds = rows.map((m) => ({ ...m, quantity: m.batches.reduce((sum, b) => sum + b.quantity, 0) }));
  const low = meds.filter((m) => m.quantity <= m.minQuantity);
  const nearExpiry = meds.filter((m) => m.batches.some((b) => b.expiryDate && new Date(b.expiryDate) <= soon));

  return (
    <div className="space-y-5">
      <PageHeader title="المخزون الدوائي" subtitle={viewer?.isAdmin ? "الكميات والتنبيهات — كل الفروع (للقراءة فقط)" : viewer?.branchId == null ? "لا يوجد فرع صيدلية مرتبط بحسابك" : "الكميات والتنبيهات — مخزون صيدلية فرعك"} icon="📦" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/pharmacy/stock" className="btn-ghost">إدارة الدفعات</Link>
        {low.length > 0 && <span className="badge-danger">{low.length} مادة تحت حد التنبيه</span>}
        {nearExpiry.length > 0 && <span className="badge-warning">{nearExpiry.length} مادة قريبة النفاذ</span>}
      </div>

      {cManage && <form action={createMedication} className="card flex flex-wrap items-end gap-2 p-4">
        <div className="flex-1 min-w-[180px]"><label className="label">مادة/دواء جديد</label><input name="name" className="input" placeholder="اسم المادة" required /></div>
        <div><label className="label">حد التنبيه</label><input name="minQuantity" type="number" defaultValue={0} className="input !w-24" /></div>
        <div><label className="label">الوحدة</label><input name="unit" className="input !w-28" placeholder="حبة/علبة..." /></div>
        <button className="btn-primary" type="submit">إضافة للفهرس</button>
      </form>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr>
            <th className="th">المادة</th><th className="th">المتوفر</th><th className="th">الوحدة</th>
            <th className="th">حد التنبيه</th><th className="th">أقرب نفاذ</th><th className="th">الحالة</th>{isAdmin && <th className="th">تعديل</th>}
          </tr></thead>
          <tbody>
            {meds.map((m) => {
              const isLow = m.quantity <= m.minQuantity;
              const firstExp = m.batches.find((b) => b.expiryDate)?.expiryDate ?? null;
              const expSoon = firstExp && new Date(firstExp) <= soon;
              return (
                <tr key={m.id} className={isLow ? "bg-red-50/40 hover:bg-red-50" : "hover:bg-gray-50"}>
                  <td className="td font-medium">{m.name} {isLow && <span className="badge-danger mr-1">نقص</span>}</td>
                  <td className="td font-bold">{m.quantity}</td>
                  <td className="td">{m.unit || "—"}</td>
                  <td className="td">{m.minQuantity}</td>
                  <td className={`td ${expSoon ? "font-semibold text-amber-700" : ""}`}>{firstExp ? new Date(firstExp).toLocaleDateString("ar-IQ") : "—"}</td>
                  <td className="td">{m.quantity <= 0 ? <span className="badge-danger">نافد</span> : isLow ? <span className="badge-warning">منخفض</span> : expSoon ? <span className="badge-warning">قريب النفاذ</span> : <span className="badge-success">جيد</span>}</td>
                  {isAdmin && (
                    <td className="td">
                      <form action={setStockSettings.bind(null, m.id)} className="flex items-center gap-1">
                        <input name="minQuantity" type="number" defaultValue={m.minQuantity} className="input !w-16 !py-1 text-xs" placeholder="حد" />
                        <input name="unit" defaultValue={m.unit ?? ""} className="input !w-20 !py-1 text-xs" placeholder="وحدة" />
                        <button className="text-xs text-brand-700 hover:underline" type="submit">حفظ</button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
            {meds.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={isAdmin ? 7 : 6}>لا أدوية بعد — أضفها من الإعدادات.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
