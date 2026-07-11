import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/access";
import { notFound } from "next/navigation";
import { fmtDateTime } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function LoginLog({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const s = await getSession();
  if ((s?.user as any)?.role !== "ADMIN") notFound();
  const sp = await searchParams;
  const filter = sp.f || "all";

  const where = filter === "fail" ? { success: false } : filter === "ok" ? { success: true } : {};
  const [logs, okCount, failCount] = await Promise.all([
    prisma.loginLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.loginLog.count({ where: { success: true } }),
    prisma.loginLog.count({ where: { success: false } }),
  ]);

  const Tab = ({ k, label }: any) => (
    <a href={`/login-log?f=${k}`} className={`rounded-lg px-3 py-1 text-sm ${filter === k ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{label}</a>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="سجل الدخول والجلسات" subtitle="مَن دخل، متى، ومن أي جهاز — للمساءلة الأمنية" icon="🔐" />
      <div className="flex flex-wrap items-center gap-2">
        <Tab k="all" label="الكل" />
        <Tab k="ok" label={`ناجح (${okCount})`} />
        <Tab k="fail" label={`فاشل (${failCount})`} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="p-2 text-right">الوقت</th>
              <th className="p-2 text-right">المستخدم</th>
              <th className="p-2 text-right">الحالة</th>
              <th className="p-2 text-right">السبب</th>
              <th className="p-2 text-right">عنوان IP</th>
              <th className="p-2 text-right">الجهاز</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-400">لا توجد سجلات.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id} className="border-t align-top">
                <td className="whitespace-nowrap p-2 text-gray-600">{fmtDateTime(l.createdAt)}</td>
                <td className="p-2"><div className="font-medium text-gray-800">{l.name ?? l.username}</div><div className="text-xs text-gray-400">{l.username}</div></td>
                <td className="p-2">{l.success ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">ناجح</span> : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">فاشل</span>}</td>
                <td className="p-2 text-xs text-gray-500">{l.reason ?? "—"}</td>
                <td className="p-2 font-mono text-xs text-gray-600">{l.ip ?? "—"}</td>
                <td className="max-w-[220px] truncate p-2 text-xs text-gray-400" title={l.userAgent ?? ""}>{l.userAgent ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
