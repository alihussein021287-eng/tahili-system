import { requireSession } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, AdminSectionHeader, AdminSectionNav } from "@/components/AdminPageSections";
import { canManageUsers } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadPerms } from "@/lib/access";
import { PermMatrix } from "@/components/PermMatrix";

export const dynamic = "force-dynamic";
const ROLES = ["MANAGER", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "PHARMACIST", "ACCOUNTANT", "RECEPTION", "RESIDENT", "DATA_ENTRY", "LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS", "VIEWER"] as const;
const PERMISSIONS_ADMIN_SECTIONS = [
  { href: "#overview", label: "نظرة عامة" },
  { href: "#matrix", label: "المصفوفة" },
  { href: "#changes", label: "سجل التغييرات" },
];

export default async function PermissionsPage() {
  const session = await requireSession();
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");

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
      <AdminSectionNav items={PERMISSIONS_ADMIN_SECTIONS} />

      <AdminIntro
        title="مركز الصلاحيات"
        description="تبدأ الصفحة بمصفوفة الأدوار والاستثناءات، ثم سجل مختصر يوضح أحدث التغييرات الإدارية على الصلاحيات."
      >
        <div id="overview" className="flex flex-wrap gap-2">
          <span className="badge-brand">{ROLES.length} دور قابل للتخصيص</span>
          <span className="badge-neutral">{users.length} مستخدم للاستثناءات</span>
          <span className="badge-neutral">{changes.length} تغيير حديث</span>
        </div>
      </AdminIntro>

      <AdminSectionHeader
        id="matrix"
        title="مصفوفة الصلاحيات"
        description="اختر بين صلاحيات الأدوار أو استثناءات المستخدمين، واستخدم البحث لتقليل المجموعات المعروضة."
        action={<a href="/api/permissions/export" className="btn-ghost">تصدير CSV</a>}
      >
        <PermMatrix roleSets={roleSets} users={users} userOverrides={userOverrides} />
      </AdminSectionHeader>

      <AdminSection
        id="changes"
        title="سجل تغييرات الصلاحيات"
        description="آخر عمليات التعديل على صلاحيات الأدوار أو استثناءات المستخدمين."
        className="overflow-hidden"
      >
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
    </div>
  );
}
