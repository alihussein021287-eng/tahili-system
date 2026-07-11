import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AUDIT_TABLE, AUDIT_ACTION, fmtDateTime } from "@/lib/labels";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");

  const { page } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      include: { user: true }, orderBy: { createdAt: "desc" },
      skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE,
    }),
    prisma.auditLog.count(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actionColor: Record<string, string> = {
    CREATE: "bg-emerald-50 text-emerald-700", UPDATE: "bg-amber-50 text-amber-700", DELETE: "bg-red-50 text-red-700",
  };

  return (
    <div className="space-y-4">
      <PageHeader title="سجل التدقيق" subtitle="عمليات الإضافة والتعديل والحذف — للمساءلة والمراجعة" icon="🗂" />

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr>
            <th className="th">المستخدم</th><th className="th">العملية</th>
            <th className="th">القسم</th><th className="th">السجل</th><th className="th">التاريخ والوقت</th>
          </tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="td">{l.user?.fullName ?? "—"}</td>
                <td className="td"><span className={`badge ${actionColor[l.action] ?? "bg-gray-100 text-gray-600"}`}>{AUDIT_ACTION[l.action] ?? l.action}</span></td>
                <td className="td">{AUDIT_TABLE[l.tableName] ?? l.tableName}</td>
                <td className="td">
                  {l.tableName === "patients"
                    ? <Link href={`/patients/${l.recordId}`} className="text-brand-700 hover:underline">عرض</Link>
                    : <span className="text-gray-400 text-xs">{l.recordId.slice(0, 8)}</span>}
                </td>
                <td className="td">{fmtDateTime(l.createdAt)}</td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={5}>لا توجد سجلات بعد.</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {p > 1 && <Link href={`/audit?page=${p - 1}`} className="btn-ghost">السابق</Link>}
          <span className="text-gray-500">صفحة {p} من {pages}</span>
          {p < pages && <Link href={`/audit?page=${p + 1}`} className="btn-ghost">التالي</Link>}
        </div>
      )}
    </div>
  );
}
