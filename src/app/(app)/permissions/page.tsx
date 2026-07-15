import { requireSession } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, AdminSectionTabs } from "@/components/AdminPageSections";
import { canManageUsers } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadPerms } from "@/lib/access";
import { PermMatrix } from "@/components/PermMatrix";

export const dynamic = "force-dynamic";
type PermissionsTab = "matrix" | "changes";

const ROLES = ["MANAGER", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "PHARMACIST", "ACCOUNTANT", "RECEPTION", "RESIDENT", "DATA_ENTRY", "LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS", "VIEWER"] as const;
const PERMISSIONS_TABS: { key: PermissionsTab; label: string; title: string; description: string }[] = [
  { key: "matrix", label: "المصفوفة", title: "مصفوفة الصلاحيات", description: "اختر بين صلاحيات الأدوار أو استثناءات المستخدمين، واستخدم البحث لتقليل المجموعات المعروضة." },
  { key: "changes", label: "سجل التغييرات", title: "سجل تغييرات الصلاحيات", description: "آخر عمليات التعديل على صلاحيات الأدوار أو استثناءات المستخدمين." },
];

function normalizeTab(raw?: string): PermissionsTab {
  return PERMISSIONS_TABS.some((tab) => tab.key === raw) ? (raw as PermissionsTab) : "matrix";
}

function tabHref(key: PermissionsTab) {
  return `/permissions?tab=${key}`;
}

export default async function PermissionsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");
  const params = await searchParams;
  const activeTab = normalizeTab(params.tab);
  const activeInfo = PERMISSIONS_TABS.find((tab) => tab.key === activeTab)!;
  const navTabs = PERMISSIONS_TABS.map((tab) => ({ key: tab.key, label: tab.label, href: tabHref(tab.key) }));

  const roleSets: Record<string, string[]> = {};
  for (const r of ROLES) roleSets[r] = Array.from(await loadPerms(undefined, r as any));

  const [users, overrides, changes] = await Promise.all([
    prisma.user.findMany({ where: { role: { not: "ADMIN" } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, role: true } }),
    prisma.userPermission.findMany(),
    prisma.auditLog.findMany({ where: { tableName: { in: ["user_permissions", "role_permissions"] } }, include: { user: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const userOverrides: Record<string, Record<string, boolean>> = {};
  for (const o of overrides) { (userOverrides[o.userId] ||= {})[o.permKey] = o.allowed; }

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="إدارة الصلاحيات" subtitle="صلاحيات الأدوار واستثناءات المستخدمين — مدير النظام يملك الكل" icon="🔐" />
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات إدارة الصلاحيات" />

      <AdminIntro title={activeInfo.title} description={activeInfo.description}>
        <div className="flex flex-wrap gap-2">
          <span className="badge-brand">{ROLES.length} دور قابل للتخصيص</span>
          <span className="badge-neutral">{users.length} مستخدم للاستثناءات</span>
          <span className="badge-neutral">{changes.length} تغيير حديث</span>
        </div>
      </AdminIntro>

      {activeTab === "matrix" ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <a href="/api/permissions/export" className="btn-ghost">تصدير CSV</a>
          </div>
          <PermMatrix roleSets={roleSets} users={users} userOverrides={userOverrides} />
        </div>
      ) : null}

      {activeTab === "changes" ? (
        <AdminSection id="changes" title="آخر التغييرات" description="يعرض الفاعل والعملية ومعرّف السجل المتأثر." className="overflow-hidden">
          <div className="-mx-5 -mb-5 divide-y">
            {changes.map((x) => (
              <div key={x.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                <span>{x.user?.fullName ?? "النظام"} · {x.action} · {x.recordId}</span>
                <time className="text-gray-500">{x.createdAt.toLocaleString("ar-IQ")}</time>
              </div>
            ))}
            {changes.length === 0 ? <div className="p-3 text-center text-sm text-gray-400">لا توجد تغييرات مسجلة بعد.</div> : null}
          </div>
        </AdminSection>
      ) : null}
    </div>
  );
}
