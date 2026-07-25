import { requireSession } from "@/lib/access";
import { Combobox } from "@/components/Combobox";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
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

type UserTab = "overview" | "create" | "list";

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]: any) => ({ value, label }));
const USER_TABS: { key: UserTab; label: string; title: string; description: string }[] = [
  { key: "overview", label: "نظرة عامة", title: "لوحة المستخدمين", description: "ملخص سريع لحجم الحسابات وحالتها قبل الدخول إلى الإنشاء أو الإدارة التفصيلية." },
  { key: "create", label: "إضافة مستخدم", title: "إضافة مستخدم", description: "أنشئ الحساب ببياناته الأساسية وحدد الدور والفرع قبل تسليم كلمة المرور المؤقتة خارج النظام." },
  { key: "list", label: "قائمة الحسابات", title: "قائمة الحسابات", description: "ابحث وصفّ الحسابات الحالية، ثم افتح صفحة الإدارة التفصيلية للبيانات أو الأمان أو الصلاحيات." },
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
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");
  const sp = await searchParams;
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
    prisma.user.findMany({
      where: filteredWhere,
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        lastSeenAt: true,
        department: true,
        jobTitle: true,
        branch: { select: { name: true } },
      },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    }),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: false } }),
    prisma.user.count({ where: { AND: [baseWhere, presenceWhere("online", onlineSince, idleSince)] } }),
    prisma.user.count({ where: { AND: [baseWhere, presenceWhere("idle", onlineSince, idleSince)] } }),
    prisma.user.count({ where: { AND: [baseWhere, presenceWhere("offline", onlineSince, idleSince)] } }),
  ]);
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="إدارة المستخدمين" subtitle="الحسابات والأدوار والصلاحيات" icon="⚙" />
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات إدارة المستخدمين" />

      <AdminIntro title={activeInfo.title} description={activeInfo.description} />

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
              <Link href="/users?tab=list" className="btn-ghost">العودة إلى الحسابات</Link>
              <button className="btn-primary" type="submit">إضافة مستخدم</button>
            </div>
          </form>
        </AdminSection>
      ) : null}

      {activeTab === "list" ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <StatCard label="المتصلون الآن" value={onlineCount} tone="text-emerald-700" description={`آخر ${presenceConfig.onlineMinutes} دقيقة`} />
            <StatCard label="الخاملون" value={idleCount} tone="text-amber-700" description={`آخر ${presenceConfig.idleMinutes} دقيقة`} />
            <StatCard label="غير المتصلين" value={offlineCount} tone="text-gray-700" description={`أقدم من ${presenceConfig.idleMinutes} دقيقة أو بدون ظهور`} />
          </section>

          <AdminSection id="filters" title="البحث والتصفية" description="استخدم الحقول التالية لتقليل النتائج قبل الدخول إلى إدارة حساب محدد.">
            <form action="/users" className="grid gap-2 md:grid-cols-6">
              <input type="hidden" name="tab" value="list" />
              <div className="md:col-span-2">
                <label className="label">بحث</label>
                <input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="اسم، مستخدم، قسم، مسمى وظيفي" />
              </div>
              <Combobox name="role" label="الدور" allowFree={false} defaultValue={sp.role ?? ""} placeholder="كل الأدوار" options={[{ value: "", label: "كل الأدوار" }, ...ROLE_OPTIONS]} />
              <Combobox name="status" label="الحالة" allowFree={false} defaultValue={sp.status ?? ""} options={[{ value: "", label: "كل الحالات" }, { value: "active", label: "فعّال" }, { value: "disabled", label: "معطّل" }]} />
              <Combobox name="branch" label="الفرع" allowFree={false} defaultValue={sp.branch ?? ""} placeholder="كل الفروع" options={[{ value: "", label: "كل الفروع" }, ...branches.map((b: any) => ({ value: String(b.id), label: b.name }))]} />
              <Combobox name="presence" label="التواجد" allowFree={false} defaultValue={presence} options={[{ value: "", label: "الكل" }, { value: "online", label: "أونلاين" }, { value: "idle", label: "خامل" }, { value: "offline", label: "أوفلاين" }]} />
              <div className="flex flex-wrap items-end gap-2 md:col-span-6">
                <button className="btn-primary" type="submit">تصفية</button>
                <Link href="/users?tab=list" className="btn-ghost">مسح</Link>
                <ResultCount count={users.length} label="حساب معروض" />
              </div>
            </form>
          </AdminSection>

          <AdminSection id="users-list" title="الحسابات" description="كل نتيجة تفتح صفحة إدارة مفصلة للبيانات، الأمان، والصلاحيات الخاصة بالمستخدم." className="overflow-hidden">
            <DataTable label="قائمة حسابات المستخدمين" className="-mx-5 -mb-5 rounded-none border-x-0 border-b-0">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">المستخدم</th>
                    <th className="th">الاسم</th>
                    <th className="th">الدور</th>
                    <th className="th">القسم/الفرع</th>
                    <th className="th">الحالة</th>
                    <th className="th">التواجد</th>
                    <th className="th">آخر ظهور</th>
                    <th className="th">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const userPresence = getPresenceStatus(u.lastSeenAt, now, presenceConfig);
                    return (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="td">{u.username}</td>
                        <td className="td">
                          <Link href={`/users/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.fullName}</Link>
                          {u.jobTitle ? <div className="text-xs text-gray-400">{u.jobTitle}</div> : null}
                        </td>
                        <td className="td">{ROLE_LABELS[u.role]}</td>
                        <td className="td">
                          <div>{u.department || "—"}</div>
                          <div className="text-xs text-gray-400">{u.branch?.name || "بدون فرع"}</div>
                        </td>
                        <td className="td">{u.isActive ? <span className="badge-success">فعّال</span> : <span className="badge-danger">معطّل</span>}</td>
                        <td className="td">
                          <span className={presenceBadgeClass(userPresence)}>{PRESENCE_LABELS[userPresence]}</span>
                        </td>
                        <td className="td">
                          <div>{fmtDateTime(u.lastSeenAt)}</div>
                          <div className="text-xs text-gray-400">آخر دخول: {fmtDateTime(u.lastLoginAt)}</div>
                        </td>
                        <td className="td">
                          <div className="flex flex-wrap gap-2">
                            <Link href={`/users/${u.id}`} className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">إدارة</Link>
                            <Link href={`/users/${u.id}?tab=security`} className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">الأمان</Link>
                            <Link href={`/users/${u.id}?tab=perms`} className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">الصلاحيات</Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {users.length === 0 ? <TableEmptyRow colSpan={8} title="لا توجد حسابات مطابقة" description="امسح بعض الفلاتر أو استخدم بحثاً أوسع." /> : null}
                </tbody>
              </table>
            </DataTable>
          </AdminSection>
        </>
      ) : null}
    </div>
  );
}
