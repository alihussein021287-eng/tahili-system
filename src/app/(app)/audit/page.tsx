import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, AdminSectionTabs, StatCard } from "@/components/AdminPageSections";
import { canManageUsers } from "@/lib/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AUDIT_TABLE, AUDIT_ACTION, fmtDateTime } from "@/lib/labels";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type AuditTab = "logs" | "overview";

const AUDIT_TABS: { key: AuditTab; label: string; title: string; description: string }[] = [
  { key: "logs", label: "السجلات", title: "سجل العمليات", description: "يعرض آخر العمليات الإدارية والطبية المهمة بترتيب زمني عكسي مع رابط مباشر عندما يكون السجل قابلاً للفتح." },
  { key: "overview", label: "نظرة عامة", title: "ملخص سجل التدقيق", description: "قراءة سريعة لحجم السجل والصفحة الحالية وعدد السجلات المعروضة." },
];

function normalizeTab(raw?: string): AuditTab {
  return AUDIT_TABS.some((tab) => tab.key === raw) ? (raw as AuditTab) : "logs";
}

function tabHref(key: AuditTab) {
  return `/audit?tab=${key}`;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const session = await requireSession();
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");

  const { tab, page } = await searchParams;
  const activeTab = normalizeTab(tab);
  const activeInfo = AUDIT_TABS.find((item) => item.key === activeTab)!;
  const navTabs = AUDIT_TABS.map((item) => ({ key: item.key, label: item.label, href: tabHref(item.key) }));
  const p = Math.max(1, Number(page) || 1);
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      include: { user: true }, orderBy: { createdAt: "desc" },
      skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE,
    }),
    prisma.auditLog.count(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstItem = logs.length === 0 ? 0 : (p - 1) * PAGE_SIZE + 1;
  const lastItem = logs.length === 0 ? 0 : Math.min(total, (p - 1) * PAGE_SIZE + logs.length);

  const actionColor: Record<string, string> = {
    CREATE: "bg-emerald-50 text-emerald-700", UPDATE: "bg-amber-50 text-amber-700", DELETE: "bg-red-50 text-red-700",
  };

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="سجل التدقيق" subtitle="عمليات الإضافة والتعديل والحذف — للمساءلة والمراجعة" icon="🗂" />
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات سجل التدقيق" />

      <AdminIntro title={activeInfo.title} description={activeInfo.description} />

      {activeTab === "overview" ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <StatCard label="إجمالي السجلات" value={total} />
          <StatCard label="الصفحة الحالية" value={`${p} / ${pages}`} tone="text-brand-700" />
          <StatCard label="المعروض الآن" value={logs.length} description={`${firstItem} - ${lastItem}`} />
        </section>
      ) : null}

      {activeTab === "logs" ? (
        <>
          <AdminSection id="logs" title="السجلات" description="كل صف يوضح الفاعل، نوع العملية، القسم المتأثر، ومعرّف السجل أو رابط فتحه." className="overflow-hidden">
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">المستخدم</th>
                    <th className="th">العملية</th>
                    <th className="th">القسم</th>
                    <th className="th">السجل</th>
                    <th className="th">التاريخ والوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="td">{l.user?.fullName ?? "—"}</td>
                      <td className="td"><span className={`badge ${actionColor[l.action] ?? "bg-gray-100 text-gray-600"}`}>{AUDIT_ACTION[l.action] ?? l.action}</span></td>
                      <td className="td">{AUDIT_TABLE[l.tableName] ?? l.tableName}</td>
                      <td className="td">
                        {l.tableName === "patients"
                          ? <Link href={`/patients/${l.recordId}`} className="text-brand-700 hover:underline">عرض</Link>
                          : <span className="text-xs text-gray-400">{l.recordId.slice(0, 8)}</span>}
                      </td>
                      <td className="td">{fmtDateTime(l.createdAt)}</td>
                    </tr>
                  ))}
                  {logs.length === 0 ? <tr><td className="td text-center text-gray-400" colSpan={5}>لا توجد سجلات بعد.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </AdminSection>

          {pages > 1 ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              {p > 1 ? <Link href={`/audit?tab=logs&page=${p - 1}`} className="btn-ghost">السابق</Link> : null}
              <span className="text-gray-500">صفحة {p} من {pages}</span>
              {p < pages ? <Link href={`/audit?tab=logs&page=${p + 1}`} className="btn-ghost">التالي</Link> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
