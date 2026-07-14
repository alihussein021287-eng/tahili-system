import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { adminStats, collaborationActor, collaborationSettings, listFiles } from "@/lib/collaboration-service";
import { createChannelAction, rescanFileAction, saveCollaborationSettingsAction, transferOwnerAction } from "../actions";

export const dynamic = "force-dynamic";

function sizeLabel(bytes: number) {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function fmtDate(value: Date) {
  return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" }).format(value);
}

export default async function CollaborationAdminPage() {
  const actor = await collaborationActor("files.admin");
  const [settings, stats, quarantine, users, centers] = await Promise.all([
    collaborationSettings(),
    adminStats(),
    listFiles(actor, "quarantine", ""),
    prisma.user.findMany({ select: { id: true, fullName: true, username: true, isActive: true }, orderBy: { fullName: "asc" }, take: 300 }),
    prisma.center.findMany({ orderBy: { name: "asc" }, take: 100 }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="إدارة مركز التعاون" subtitle="إدارة القنوات والسياسات والفحص والحصص دون عرض محتوى خاص" icon="🛡">
        <Link href="/collaboration" className="btn-ghost bg-white text-brand-700">المحادثات</Link>
        <Link href="/collaboration/files" className="btn-ghost bg-white text-brand-700">مركز الملفات</Link>
      </PageHeader>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="card p-4"><div className="text-sm text-gray-500">الرسائل</div><div className="text-2xl font-bold">{stats.messages}</div></div>
        <div className="card p-4"><div className="text-sm text-gray-500">الملفات</div><div className="text-2xl font-bold">{stats.files}</div></div>
        <div className="card p-4"><div className="text-sm text-gray-500">المساحة المستخدمة</div><div className="text-2xl font-bold">{sizeLabel(stats.usedBytes)}</div></div>
        <div className="card p-4"><div className="text-sm text-gray-500">الفحص</div><div className="text-2xl font-bold">{stats.pending} / {stats.rejected}</div><div className="text-xs text-gray-500">قيد الفحص / مرفوض أو فشل</div></div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">إعدادات الخدمة والحصص</h2>
        <form action={saveCollaborationSettingsAction} className="grid gap-3 md:grid-cols-3">
          <label className="label">إيقاف الخدمة مؤقتاً <span className="text-xs text-gray-500">(تبقى القراءة للأدمن)</span><br /><input type="checkbox" name="servicePaused" defaultChecked={settings.servicePaused} /> موقوفة</label>
          <label className="label">أقصى حجم ملف MB<input name="maxUploadMb" type="number" min="1" max="500" className="input mt-1" defaultValue={settings.maxUploadMb} /></label>
          <label className="label">مدة تعديل الرسالة بالدقائق<input name="editWindowMinutes" type="number" min="1" max="1440" className="input mt-1" defaultValue={settings.editWindowMinutes} /></label>
          <label className="label">احتفاظ الرسائل بالأيام<input name="messageRetentionDays" type="number" min="1" className="input mt-1" defaultValue={settings.messageRetentionDays} /></label>
          <label className="label">احتفاظ السلة بالأيام<input name="trashRetentionDays" type="number" min="1" className="input mt-1" defaultValue={settings.trashRetentionDays} /></label>
          <label className="label">حصة المستخدم MB<input name="userQuotaMb" type="number" min="1" className="input mt-1" defaultValue={settings.userQuotaMb} /></label>
          <label className="label">حصة القسم MB<input name="departmentQuotaMb" type="number" min="1" className="input mt-1" defaultValue={settings.departmentQuotaMb} /></label>
          <label className="label">حصة المركز MB<input name="centerQuotaMb" type="number" min="1" className="input mt-1" defaultValue={settings.centerQuotaMb} /></label>
          <label className="label md:col-span-3">الأنواع المسموحة<input name="allowedTypes" className="input mt-1" defaultValue={settings.allowedTypes.join(",")} /></label>
          <label className="label md:col-span-3">الأنواع الممنوعة<input name="blockedTypes" className="input mt-1" defaultValue={settings.blockedTypes.join(",")} /></label>
          <div className="md:col-span-3"><button className="btn-primary">حفظ إعدادات التعاون</button></div>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">إنشاء قنوات الأقسام والمراكز</h2>
        <form action={createChannelAction} className="grid gap-3 md:grid-cols-4">
          <input name="title" className="input" placeholder="اسم القناة" required />
          <input name="department" className="input" placeholder="القسم" />
          <select name="centerId" className="input">
            <option value="">بلا مركز محدد</option>
            {centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
          </select>
          <button className="btn-primary">إنشاء قناة</button>
        </form>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b p-4">
          <h2 className="font-semibold">الملفات قيد الفحص والمرفوضة</h2>
          <p className="text-sm text-gray-500">التحميل والمشاركة ممنوعان حتى تصبح الحالة آمن.</p>
        </div>
        <div className="overflow-x-auto">
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
                      {file.versions[0] && <form action={rescanFileAction.bind(null, file.versions[0].id)}><button className="btn-ghost btn-xs">إعادة الفحص</button></form>}
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
              {quarantine.length === 0 && <tr><td className="td text-center text-gray-500" colSpan={5}>لا توجد ملفات معزولة حالياً.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b p-4">
          <h2 className="font-semibold">سجل العمليات</h2>
          <p className="text-sm text-gray-500">يعرض نوع العملية والجدول والفاعل دون محتوى الرسائل الخاصة.</p>
        </div>
        <div className="overflow-x-auto">
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
              {stats.audit.length === 0 && <tr><td className="td text-center text-gray-500" colSpan={5}>لا توجد عمليات تعاون مسجلة بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
