import { prisma } from "@/lib/db";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { PharmacyNav } from "@/components/PharmacyNav";
import { requirePerm } from "@/lib/access";
import { fmtDateTime, MOVE_TYPE } from "@/lib/labels";

export const dynamic = "force-dynamic";

const TYPE_CLR: Record<string, string> = {
  IN: "bg-emerald-50 text-emerald-700", DISPENSE: "bg-sky-50 text-sky-700",
  DISPOSE: "bg-red-50 text-red-700", ADJUST: "bg-amber-50 text-amber-700",
};

export default async function PharmacyLog({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePerm("pharmacy.view");
  const { type } = await searchParams;
  const validType = ["IN", "DISPENSE", "DISPOSE", "ADJUST"].includes(type ?? "") ? (type as any) : undefined;

  const moves = await prisma.stockMovement.findMany({
    where: validType ? { type: validType } : {},
    include: { medication: { select: { name: true, unit: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const filters = [["", "الكل"], ["IN", "إدخال"], ["DISPENSE", "صرف"], ["DISPOSE", "إتلاف"], ["ADJUST", "تعديل"]];

  return (
    <div className="space-y-5">
      <PageHeader title="سجل حركة المخزون" subtitle="كل عمليات الإدخال والصرف والإتلاف والتعديل" icon="📑" />
      <PharmacyNav />

      <div className="flex flex-wrap gap-1.5">
        {filters.map(([v, l]) => (
          <Link key={v} href={v ? `/pharmacy/log?type=${v}` : "/pharmacy/log"}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${(validType ?? "") === v ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{l}</Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">التاريخ</th><th className="th">النوع</th><th className="th">المادة</th>
            <th className="th">الكمية</th><th className="th">المريض/السبب</th><th className="th">المنفّذ</th>
          </tr></thead>
          <tbody>
            {moves.map((mv) => (
              <tr key={mv.id} className="hover:bg-gray-50">
                <td className="td text-gray-500">{fmtDateTime(mv.createdAt)}</td>
                <td className="td"><span className={`badge ${TYPE_CLR[mv.type]}`}>{MOVE_TYPE[mv.type as keyof typeof MOVE_TYPE]}</span></td>
                <td className="td font-medium">{mv.medication?.name ?? "—"}</td>
                <td className={`td font-bold ${mv.type === "DISPENSE" || mv.type === "DISPOSE" ? "text-red-600" : mv.type === "IN" ? "text-emerald-600" : "text-amber-600"}`}>
                  {mv.type === "IN" ? "+" : mv.type === "ADJUST" ? "±" : "−"}{mv.quantity}{mv.medication?.unit ? ` ${mv.medication.unit}` : ""}
                </td>
                <td className="td">{mv.patientName || mv.reason || "—"}</td>
                <td className="td text-gray-500">{mv.byName || "—"}</td>
              </tr>
            ))}
            {moves.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={6}>لا توجد حركات بعد.</td></tr>}
          </tbody>
        </table>
      </div>
      {moves.length >= 300 && <p className="text-center text-xs text-gray-400">يُعرض آخر 300 حركة.</p>}
    </div>
  );
}
