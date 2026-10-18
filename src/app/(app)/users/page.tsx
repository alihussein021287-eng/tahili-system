import { currentPerms, requireSession } from "@/lib/access";
import { Combobox } from "@/components/Combobox";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { AdminSectionTabs as StaffTabsBar } from "@/components/AdminPageSections";
import { staffNavTabs } from "@/lib/staff-nav";
import { DataTable, FormField, ResultCount, TableEmptyRow } from "@/components/Ui";
import { AdminIntro, AdminSection, AdminSectionTabs, StatCard } from "@/components/AdminPageSections";
import { canManageUsers, ROLE_LABELS } from "@/lib/permissions";
import { createUser } from "./actions";
import { fmtDateTime } from "@/lib/labels";
import {
  getPresenceStatus,
  normalizePresenceConfig,
  presenceBadgeClass,
  PRESENCE_LABELS,
  presenceWindows,
  type PresenceStatus,
} from "@/lib/presence";
import { getAdminConfig } from "@/lib/admin-config";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type UserTab = "overview" | "create";

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]: any) => ({ value, label }));
const USER_TABS: { key: UserTab; label: string; title: string; description: string }[] = [
  { key: "overview", label: "نظرة عامة", title: "لوحة المستخدمين", description: "ملخص سريع لحجم الحسابات وحالتها قبل الدخول إلى الإنشاء أو الإدارة التفصيلية." },
  { key: "create", label: "إضافة مستخدم", title: "إضافة مستخدم", description: "أنشئ الحساب ببياناته الأساسية وحدد الدور والفرع قبل تسليم كلمة المرور المؤقتة خارج النظام." },
];

function normalizeTab(raw?: string): UserTab {
  return USER_TABS.some((tab) => tab.key === raw) ? (raw as UserTab) : "overview";
}

function tabHref(key: UserTab) {
  return `/users?tab=${key}`;
}

function normalizePresence(raw?: string): PresenceStatus | "" {
  return raw === "online" || raw === "idle" || raw === "offline" ? raw : "";
}

function presenceWhere(status: PresenceStatus, onlineSince: Date, idleSince: Date) {
  if (status === "online") return { lastSeenAt: { gte: onlineSince } };
  if (status === "idle") return { lastSeenAt: { gte: idleSince, lt: onlineSince } };
  return { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: idleSince } }] };
}

export default async function Users({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; role?: string; status?: string; branch?: string; presence?: string }> }) {
  const session = await requireSession();
  const dcPerms = await currentPerms();
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");
  const sp = await searchParams;
  // The accounts list lives in one place: the employees tab of the staff section.
  if (sp.tab === "list") {
    const params = new URLSearchParams({ tab: "employees" });
    if (sp.q) params.set("q", sp.q);
    if (sp.role) params.set("role", sp.role);
    if (sp.status) params.set("userStatus", sp.status);
    if (sp.branch) params.set("branch", sp.branch);
    if (sp.presence) params.set("presence", sp.presence);
    redirect(`/staff?${params.toString()}`);
  }
  const activeTab = normalizeTab(sp.tab);
  const activeInfo = USER_TABS.find((tab) => tab.key === activeTab)!;
  const navTabs = USER_TABS.map((tab) => ({ key: tab.key, label: tab.label, href: tabHref(tab.key) }));
  const baseWhere: any = {};
  const q = (sp.q ?? "").trim();
  if (q) baseWhere.OR = [
    { username: { contains: q, mode: "insensitive" } },
    { fullName: { contains: q, mode: "insensitive" } },
    { department: { contains: q, mode: "insensitive" } },
    { jobTitle: { contains: q, mode: "insensitive" } },
  ];
  if (sp.role) baseWhere.role = sp.role;
  if (sp.status === "active") baseWhere.isActive = true;
  if (sp.status === "disabled") baseWhere.isActive = false;
  if (sp.branch) baseWhere.branchId = Number(sp.branch);

  const adminConfig = await getAdminConfig();
  const presenceConfig = normalizePresenceConfig(adminConfig);
  const presenceWindowConfig = presenceWindows(presenceConfig);
  const now = new Date();
  const onlineSince = new Date(now.getTime() - presenceWindowConfig.onlineWindowMs);
  const idleSince = new Date(now.getTime() - presenceWindowConfig.idleWindowMs);
  const presence = normalizePresence(sp.presence);
  const filteredWhere = presence ? { AND: [baseWhere, presenceWhere(presence, onlineSince, idleSince)] } : baseWhere;

  const [branches, users, total, active, disabled, onlineCount, idleCount, offlineCount] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    Promise.resolve([] as any[]),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: false } }),
    prisma.user.count({ where: { AND: [baseWhere, presenceWhere("online", onlineSince, idleSince)] } }),
    prisma.user.count({ where: { AND: [baseWhere, presenceWhere("idle", onlineSince, idleSince)] } }),
    prisma.user.count({ where: { AND: [baseWhere, presenceWhere("offline", onlineSince, idleSince)] } }),
  ]);
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="إدارة الحسابات" subtitle="الأدوار والصلاحيات والأمان" icon="⚙">
        {dcPerms.has("datacenter.view") && (dcPerms.has("datacenter.import.accounts") || dcPerms.has("datacenter.export.users")) ? <a className="btn-ghost" href="/data-center?tab=import">🗄 استيراد/تصدير الحسابات</a> : null}
      </PageHeader>
      <StaffTabsBar tabs={staffNavTabs(dcPerms, (session?.user as any)?.role)} active="accounts" label="أقسام الموظفين والمهام" />
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات إدارة المستخدمين" />

      <AdminIntro title={activeInfo.title} description={activeInfo.description} />

      {activeTab === "overview" ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
        <span>قائمة الموظفين وإدارتهم اليومية موجودة في صفحة الموظفين.</span>
        <Link href="/staff?tab=employees" className="btn-primary">فتح قائمة الموظفين</Link>
      </div> : null}

      {activeTab === "overview" ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard label="إجمالي المستخدمين" value={total} />
          <StatCard label="حسابات فعالة" value={active} tone="text-emerald-700" />
          <StatCard label="حسابات معطلة" value={disabled} tone="text-red-700" />
          <StatCard label="المتصلون الآن" value={onlineCount} tone="text-emerald-700" description={`آخر ${presenceConfig.onlineMinutes} دقيقة`} />
          <StatCard label="الخاملون" value={idleCount} tone="text-amber-700" description={`آخر ${presenceConfig.idleMinutes} دقيقة`} />
          <StatCard label="غير المتصلين" value={offlineCount} tone="text-gray-700" description={`أقدم من ${presenceConfig.idleMinutes} دقيقة`} />
        </section>
      ) : null}

      {activeTab === "create" ? (
        <AdminSection id="create-user" title="بيانات الحساب" description="كل الحقول هنا تخص الحساب الجديد فقط، والحفظ يتم بشكل مستقل عن قائمة المستخدمين.">
          <form action={createUser} className="space-y-5">
            <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <legend className="mb-3 text-sm font-semibold text-gray-800">بيانات الدخول والتعريف</legend>
              <FormField label="اسم المستخدم" required>
              <input className="input" name="username" required autoComplete="off" />
              </FormField>
              <FormField label="الاسم الكامل" required>
              <input className="input" name="fullName" required autoComplete="off" />
              </FormField>
              <FormField label="كلمة المرور المؤقتة" required hint="تُسلّم للمستخدم خارج النظام، ويمكن إبقاء الحساب بانتظار التفعيل.">
              <input className="input" name="password" type="password" required placeholder="يسلمها المدير للمستخدم خارج النظام" autoComplete="new-password" />
              </FormField>
              <FormField label="الدور" required>
              <Combobox name="role" allowFree={false} options={ROLE_OPTIONS} />
              </FormField>
            </fieldset>

            <fieldset className="grid min-w-0 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <legend className="mb-3 text-sm font-semibold text-gray-800">الارتباط الوظيفي</legend>
              <FormField label="الفرع" hint="اختياري؛ يحدد نطاق الفرع عندما تطبقه صلاحيات الدور.">
              <Combobox name="branchId" allowFree={false} placeholder="بدون" options={branches.map((b: any) => ({ value: String(b.id), label: b.name }))} />
              </FormField>
              <FormField label="المسمّى الوظيفي">
              <input className="input" name="jobTitle" autoComplete="off" />
              </FormField>
              <FormField label="القسم/الشعبة">
              <input className="input" name="department" autoComplete="off" />
              </FormField>
              <FormField label="البريد الإلكتروني" hint="اختياري">
              <input className="input" name="email" autoComplete="off" />
              </FormField>
            </fieldset>

            <fieldset className="grid min-w-0 gap-4 border-t border-gray-100 pt-4 lg:grid-cols-2">
              <legend className="mb-3 text-sm font-semibold text-gray-800">التفعيل والتأكيد الإداري</legend>
              <label className="flex min-h-20 items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm text-gray-700">
              <input type="checkbox" name="activateImmediately" value="1" className="mt-1" />
              <span><span className="block font-medium">تفعيل الحساب مباشرة بهذه الكلمة</span><span className="mt-1 block text-xs text-gray-500">خيار إداري صريح؛ اتركه غير محدد لمسار التفعيل المعتاد.</span></span>
              </label>
              <FormField label="تأكيد مدير إضافي فقط" hint="يُترك فارغاً لجميع الأدوار الأخرى.">
              <input className="input" name="confirmAdditionalAdmin" placeholder="إنشاء مدير إضافي" autoComplete="off" />
              </FormField>
            </fieldset>

            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
              <Link href="/staff?tab=employees" className="btn-ghost">العودة إلى الحسابات</Link>
              <button className="btn-primary" type="submit">إضافة مستخدم</button>
            </div>
          </form>
        </AdminSection>
      ) : null}

    </div>
  );
}
