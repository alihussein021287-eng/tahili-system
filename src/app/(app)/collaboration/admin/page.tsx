import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, AdminSectionTabs, StatCard } from "@/components/AdminPageSections";
import { prisma } from "@/lib/db";
import { adminStats, collaborationActor, collaborationSettings, listFiles } from "@/lib/collaboration-service";
import { createChannelAction, rescanFileAction, saveCollaborationSettingsAction, transferOwnerAction } from "../actions";

export const dynamic = "force-dynamic";
type CollaborationAdminTab = "overview" | "settings" | "channels" | "quarantine" | "audit";

const COLLAB_ADMIN_TABS: { key: CollaborationAdminTab; label: string; title: string; description: string }[] = [
  { key: "overview", label: "نظرة عامة", title: "لوحة إدارة التعاون", description: "ملخص سريع لحجم الرسائل والملفات والمساحة وحالات الفحص." },
  { key: "settings", label: "الإعدادات والحصص", title: "إعدادات الخدمة والحصص", description: "تتحكم هذه القيم بسلوك الخدمة، مدد الاحتفاظ، وحدود الملفات والحصص." },
  { key: "channels", label: "القنوات", title: "إنشاء قنوات الأقسام والمراكز", description: "أنشئ قناة عامة مرتبطة بقسم أو مركز عند الحاجة لمساحة تعاون رسمية." },
  { key: "quarantine", label: "الفحص والعزل", title: "الملفات قيد الفحص والمرفوضة", description: "التحميل والمشاركة ممنوعان حتى تصبح الحالة آمن." },
  { key: "audit", label: "سجل العمليات", title: "سجل عمليات التعاون", description: "يعرض نوع العملية والجدول والفاعل دون محتوى الرسائل الخاصة." },
];

function sizeLabel(bytes: number) {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function fmtDate(value: Date) {
  return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" }).format(value);
}

function normalizeTab(raw?: string): CollaborationAdminTab {
  return COLLAB_ADMIN_TABS.some((tab) => tab.key === raw) ? (raw as CollaborationAdminTab) : "overview";
}

function tabHref(key: CollaborationAdminTab) {
  return `/collaboration/admin?tab=${key}`;
}

export default async function CollaborationAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await collaborationActor("files.admin");
  const params = await searchParams;
  const activeTab = normalizeTab(params.tab);
  const activeInfo = COLLAB_ADMIN_TABS.find((tab) => tab.key === activeTab)!;
  const navTabs = COLLAB_ADMIN_TABS.map((tab) => ({ key: tab.key, label: tab.label, href: tabHref(tab.key) }));
  const [settings, stats, quarantine, users, centers] = await Promise.all([
    collaborationSettings(),
    adminStats(),
    listFiles(actor, "quarantine", ""),
    prisma.user.findMany({ select: { id: true, fullName: true, username: true, isActive: true }, orderBy: { fullName: "asc" }, take: 300 }),
    prisma.center.findMany({ orderBy: { name: "asc" }, take: 100 }),
  ]);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="إدارة مركز التعاون" subtitle="إدارة القنوات والسياسات والفحص والحصص دون عرض محتوى خاص" icon="🛡">
        <Link href="/collaboration" className="btn-ghost bg-white text-brand-700">المحادثات</Link>
        <Link href="/collaboration/files" className="btn-ghost bg-white text-brand-700">مركز الملفات</Link>
      </PageHeader>
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات إدارة مركز التعاون" />

      <AdminIntro title={activeInfo.title} description={activeInfo.description}>
        {settings.servicePaused ? <p className="text-sm text-amber-700">الخدمة موقوفة مؤقتاً؛ تبقى القراءة الإدارية متاحة للمراجعة.</p> : null}
      </AdminIntro>

      {activeTab === "overview" ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="الرسائل" value={stats.messages} />
          <StatCard label="الملفات" value={stats.files} tone="text-brand-700" />
          <StatCard label="المساحة المستخدمة" value={sizeLabel(stats.usedBytes)} />
          <StatCard label="الفحص" value={`${stats.pending} / ${stats.rejected}`} description="قيد الفحص / مرفوض أو فشل" tone="text-amber-700" />
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <AdminSection id="settings" title="السياسات والحصص" description="احفظ إعدادات التعاون بشكل مستقل عن القنوات والملفات المعزولة.">
          <form action={saveCollaborationSettingsAction} className="grid gap-3 md:grid-cols-3">
            <label className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/50 p-3 text-sm text-gray-700 md:col-span-3">
              <input type="checkbox" name="servicePaused" defaultChecked={settings.servicePaused} className="mt-1" />
              <span>
                <span className="font-medium">إيقاف الخدمة مؤقتاً</span>
                <span className="block text-xs text-gray-500">تبقى القراءة متاحة للأدمن أثناء الإيقاف.</span>
              </span>
            </label>
            <label className="label">أقصى حجم ملف MB<input name="maxUploadMb" type="number" min="1" max="500" className="input mt-1" defaultValue={settings.maxUploadMb} /></label>
            <label className="label">مدة تعديل الرسالة بالدقائق<input name="editWindowMinutes" type="number" min="1" max="1440" className="input mt-1" defaultValue={settings.editWindowMinutes} /></label>
            <label className="label">احتفاظ الرسائل بالأيام<input name="messageRetentionDays" type="number" min="1" className="input mt-1" defaultValue={settings.messageRetentionDays} /></label>
            <label className="label">احتفاظ السلة بالأيام<input name="trashRetentionDays" type="number" min="1" className="input mt-1" defaultValue={settings.trashRetentionDays} /></label>
            <label className="label">حصة المستخدم MB<input name="userQuotaMb" type="number" min="1" className="input mt-1" defaultValue={settings.userQuotaMb} /></label>
            <label className="label">حصة القسم MB<input name="departmentQuotaMb" type="number" min="1" className="input mt-1" defaultValue={settings.departmentQuotaMb} /></label>
            <label className="label">حصة المركز MB<input name="centerQuotaMb" type="number" min="1" className="input mt-1" defaultValue={settings.centerQuotaMb} /></label>
            <label className="label md:col-span-3">الأنواع المسموحة<input name="allowedTypes" className="input mt-1" defaultValue={settings.allowedTypes.join(",")} /></label>
            <label className="label md:col-span-3">الأنواع الممنوعة<input name="blockedTypes" className="input mt-1" defaultValue={settings.blockedTypes.join(",")} /></label>
            <div className="md:col-span-3"><button className="btn-primary" type="submit">حفظ إعدادات التعاون</button></div>
          </form>
        </AdminSection>
      ) : null}

      {activeTab === "channels" ? (
        <AdminSection id="channels" title="بيانات القناة" description="حدد اسم القناة والقسم أو المركز المرتبط بها.">
          <form action={createChannelAction} className="grid gap-3 md:grid-cols-4">
            <input name="title" className="input" placeholder="اسم القناة" required />
            <input name="department" className="input" placeholder="القسم" />
            <select name="centerId" className="input">
              <option value="">بلا مركز محدد</option>
              {centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
            </select>
            <button className="btn-primary" type="submit">إنشاء قناة</button>
          </form>
        </AdminSection>
      ) : null}

      {activeTab === "quarantine" ? (
        <AdminSection id="quarantine" title="قائمة الفحص والعزل" description="أعد فحص الملفات أو انقل الملكية عند الحاجة." className="overflow-hidden">
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">الملف</th><th className="th">الحالة</th><th className="th">المالك</th><th className="th">الإصدار</th><th className="th">إجراءات</th></tr></thead>
              <tbody>
                {quarantine.map((file) => (
                  <tr key={file.id}>
                    <td className="td">{file.displayName}</td>
                    <td className="td">{file.scanStatus}</td>
                    <td className="td">{file.owner.fullName}</td>
                    <td className="td">v{file.currentVersion}</td>
                    <td className="td">
                      <div className="flex flex-wrap gap-2">
                        {file.versions[0] ? <form action={rescanFileAction.bind(null, file.versions[0].id)}><button className="btn-ghost btn-xs">إعادة الفحص</button></form> : null}
                        <form action={transferOwnerAction.bind(null, file.id)} className="flex gap-1">
                          <select name="newOwnerId" className="input !py-1 text-xs" required>
                            <option value="">نقل الملكية</option>
                            {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}{!user.isActive ? " (معطّل)" : ""}</option>)}
                          </select>
                          <button className="btn-ghost btn-xs">نقل</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {quarantine.length === 0 ? <tr><td className="td text-center text-gray-500" colSpan={5}>لا توجد ملفات معزولة حالياً.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </AdminSection>
      ) : null}

      {activeTab === "audit" ? (
        <AdminSection id="audit" title="آخر العمليات" description="مراجعة إدارية دون عرض محتوى الرسائل أو الملفات الخاصة." className="overflow-hidden">
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">الوقت</th><th className="th">الفاعل</th><th className="th">العملية</th><th className="th">الجدول</th><th className="th">السجل</th></tr></thead>
              <tbody>
                {stats.audit.map((row) => (
                  <tr key={row.id}>
                    <td className="td">{fmtDate(row.createdAt)}</td>
                    <td className="td">{row.user?.fullName || row.actorName || "نظام"}</td>
                    <td className="td">{row.action}</td>
                    <td className="td">{row.tableName}</td>
                    <td className="td">{row.recordId}</td>
                  </tr>
                ))}
                {stats.audit.length === 0 ? <tr><td className="td text-center text-gray-500" colSpan={5}>لا توجد عمليات تعاون مسجلة بعد.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </AdminSection>
      ) : null}
    </div>
  );
}
