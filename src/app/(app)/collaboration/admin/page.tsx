import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, AdminSectionTabs, StatCard } from "@/components/AdminPageSections";
import { prisma } from "@/lib/db";
import { adminStats, collaborationActor, collaborationSettings, listFiles } from "@/lib/collaboration-service";
import { createChannelAction, rescanFileAction, saveCollaborationSettingsAction, transferOwnerAction } from "../actions";
import { DataTable, FormField, TableEmptyRow } from "@/components/Ui";

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
    prisma.center.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 100 }),
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
          <form action={saveCollaborationSettingsAction} className="space-y-5">
            <fieldset className="grid min-w-0 gap-4 md:grid-cols-3">
              <legend className="mb-3 text-sm font-semibold text-gray-800">حالة الخدمة وحدود الاستخدام</legend>
            <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm text-gray-700 md:col-span-3">
              <input type="checkbox" name="servicePaused" defaultChecked={settings.servicePaused} className="mt-1" />
              <span>
                <span className="font-medium">إيقاف الخدمة مؤقتاً</span>
                <span className="mt-1 block text-xs text-gray-500">إجراء تشغيلي مؤثر؛ تبقى القراءة متاحة للأدمن أثناء الإيقاف.</span>
              </span>
            </label>
              <NumericField label="أقصى حجم ملف" unit="MB" name="maxUploadMb" min="1" max="500" defaultValue={settings.maxUploadMb} />
              <NumericField label="مدة تعديل الرسالة" unit="دقيقة" name="editWindowMinutes" min="1" max="1440" defaultValue={settings.editWindowMinutes} />
              <NumericField label="احتفاظ الرسائل" unit="يوم" name="messageRetentionDays" min="1" defaultValue={settings.messageRetentionDays} />
              <NumericField label="احتفاظ السلة" unit="يوم" name="trashRetentionDays" min="1" defaultValue={settings.trashRetentionDays} />
              <NumericField label="حصة المستخدم" unit="MB" name="userQuotaMb" min="1" defaultValue={settings.userQuotaMb} />
              <NumericField label="حصة القسم" unit="MB" name="departmentQuotaMb" min="1" defaultValue={settings.departmentQuotaMb} />
              <NumericField label="حصة المركز" unit="MB" name="centerQuotaMb" min="1" defaultValue={settings.centerQuotaMb} />
            </fieldset>
            <fieldset className="grid min-w-0 gap-4 border-t border-gray-100 pt-4">
              <legend className="mb-3 text-sm font-semibold text-gray-800">سياسة أنواع الملفات</legend>
              <FormField label="الأنواع المسموحة" hint="امتدادات مفصولة بفواصل كما هي في السياسة الحالية."><input name="allowedTypes" className="input" defaultValue={settings.allowedTypes.join(",")} /></FormField>
              <FormField label="الأنواع الممنوعة" hint="المنع الأمني الخادمي يبقى مطبقاً إضافة إلى هذه القائمة."><input name="blockedTypes" className="input" defaultValue={settings.blockedTypes.join(",")} /></FormField>
            </fieldset>
            <div className="flex justify-end border-t border-gray-100 pt-4"><button className="btn-primary" type="submit">حفظ إعدادات التعاون</button></div>
          </form>
        </AdminSection>
      ) : null}

      {activeTab === "channels" ? (
        <AdminSection id="channels" title="بيانات القناة" description="حدد اسم القناة والقسم أو المركز المرتبط بها.">
          <form action={createChannelAction} className="grid gap-4 md:grid-cols-3">
            <FormField label="اسم القناة" required><input name="title" className="input" placeholder="اسم القناة" required /></FormField>
            <FormField label="القسم" hint="اختياري"><input name="department" className="input" placeholder="القسم" /></FormField>
            <FormField label="المركز" hint="اختياري">
            <select name="centerId" className="input">
              <option value="">بلا مركز محدد</option>
              {centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
            </select>
            </FormField>
            <div className="flex justify-end border-t border-gray-100 pt-4 md:col-span-3"><button className="btn-primary" type="submit">إنشاء قناة</button></div>
          </form>
        </AdminSection>
      ) : null}

      {activeTab === "quarantine" ? (
        <AdminSection id="quarantine" title="قائمة الفحص والعزل" description="أعد فحص الملفات أو انقل الملكية عند الحاجة." className="overflow-hidden">
          <DataTable label="الملفات قيد الفحص والعزل" className="-mx-5 -mb-5 rounded-none border-x-0 border-b-0">
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
                {quarantine.length === 0 ? <TableEmptyRow colSpan={5} title="لا توجد ملفات معزولة حالياً" description="ستظهر الملفات هنا فقط عندما تحتاج فحصاً أو مراجعة إدارية." /> : null}
              </tbody>
            </table>
          </DataTable>
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

function NumericField({ label, unit, name, min, max, defaultValue }: { label: string; unit: string; name: string; min: string; max?: string; defaultValue: number }) {
  return (
    <FormField label={label}>
      <span className="flex min-w-0 items-center gap-2">
        <input name={name} type="number" min={min} max={max} className="input min-w-0 flex-1" defaultValue={defaultValue} />
        <span className="shrink-0 rounded-md bg-gray-100 px-2 py-2 text-xs text-gray-600">{unit}</span>
      </span>
    </FormField>
  );
}
