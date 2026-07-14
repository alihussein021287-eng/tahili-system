import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { FileUploadClient } from "@/components/collaboration/FileUploadClient";
import { prisma } from "@/lib/db";
import { collaborationActor, listConversations, listFiles } from "@/lib/collaboration-service";
import {
  createFolderAction,
  deleteFileAction,
  linkPatientAction,
  permanentDeleteFileAction,
  restoreFileAction,
  revokeShareAction,
  shareFileAction,
  toggleFavoriteAction,
  transferOwnerAction,
  updateFileAction,
  uploadFileAction,
  uploadVersionAction,
} from "../actions";

export const dynamic = "force-dynamic";

const tabs = [
  ["all", "كل الملفات"],
  ["mine", "ملفاتي"],
  ["shared", "المشتركة معي"],
  ["recent", "الحديثة"],
  ["favorites", "المفضلة"],
  ["trash", "سلة المحذوفات"],
  ["quarantine", "قيد الفحص والمرفوضة"],
] as const;

const statusLabel: Record<string, string> = {
  PENDING_SCAN: "قيد الفحص",
  SAFE: "آمن",
  REJECTED: "مرفوض",
  FAILED: "فشل الفحص",
};

function sizeLabel(bytes: number) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function fmtDate(value: Date) {
  return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" }).format(value);
}

function shareTargetLabel(share: any) {
  if (share.targetUser) return `مستخدم: ${share.targetUser.fullName}`;
  if (share.targetConversation) return `محادثة: ${share.targetConversation.title || "محادثة مباشرة"}`;
  if (share.targetDepartment) return `قسم: ${share.targetDepartment}`;
  if (share.targetCenter) return `مركز: ${share.targetCenter.name}`;
  if (share.targetType === "ALL_STAFF") return "جميع الموظفين";
  return share.shareKey;
}

export default async function CollaborationFilesPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  const actor = await collaborationActor("files.view");
  const params = await searchParams;
  const filter = params.filter || "all";
  const [files, users, centers, conversations, folders, patients] = await Promise.all([
    listFiles(actor, filter, params.q || ""),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, username: true }, orderBy: { fullName: "asc" }, take: 200 }),
    prisma.center.findMany({ orderBy: { name: "asc" }, take: 100 }),
    listConversations(actor),
    prisma.folder.findMany({ where: { ownerId: actor.id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 100 }),
    prisma.patient.findMany({ where: { archivedAt: null }, select: { id: true, fullName: true, fileNumber: true }, orderBy: { fullName: "asc" }, take: 200 }),
  ]);
  const canAdmin = actor.role === "ADMIN" || actor.permissions.has("files.admin");
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="مركز الملفات" subtitle={`${files.length} ملف · ${sizeLabel(totalBytes)} ضمن النتائج الحالية`} icon="📁">
        <Link href="/collaboration" className="btn-ghost bg-white text-brand-700">المحادثات</Link>
        {canAdmin && <Link href="/collaboration/admin" className="btn-ghost bg-white text-brand-700">إدارة الخدمة</Link>}
      </PageHeader>

      <nav className="flex gap-2 overflow-x-auto rounded-lg border bg-white p-2 text-sm">
        {tabs.map(([key, label]) => (
          <Link key={key} href={`/collaboration/files?filter=${key}`} className={`shrink-0 rounded px-3 py-2 ${filter === key ? "bg-brand-50 text-brand-700" : "hover:bg-gray-100"}`}>{label}</Link>
        ))}
      </nav>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <form className="card grid gap-3 p-4 md:grid-cols-[1fr_auto]">
            <input type="hidden" name="filter" value={filter} />
            <input name="q" className="input" defaultValue={params.q || ""} placeholder="بحث بالاسم أو الوصف..." />
            <button className="btn-primary">بحث</button>
          </form>

          <div className="space-y-3">
            {files.length === 0 && <div className="card p-8 text-center text-sm text-gray-500">لا توجد ملفات ضمن هذا التصنيف.</div>}
            {files.map((file) => {
              const safe = file.scanStatus === "SAFE";
              const mine = file.ownerId === actor.id;
              const canEdit = mine || canAdmin;
              return (
                <article key={file.id} className="card overflow-hidden">
                  <div className="grid gap-3 p-4 xl:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg font-semibold">{file.displayName}</h2>
                        <span className={safe ? "badge-success" : file.scanStatus === "PENDING_SCAN" ? "badge-warning" : "badge-danger"}>{statusLabel[file.scanStatus]}</span>
                        {file.patientId && <span className="badge-info">مرتبط بمراجع</span>}
                        {file.favorites.length > 0 && <span className="badge-brand">مفضل</span>}
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{file.description || file.originalName}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span>المالك: {file.owner.fullName}</span>
                        <span>الحجم: {sizeLabel(file.size)}</span>
                        <span>النوع: {file.mimeType}</span>
                        <span>الإصدار: {file.currentVersion}</span>
                        <span>التاريخ: {fmtDate(file.createdAt)}</span>
                        {file.center?.name && <span>المركز: {file.center.name}</span>}
                        {file.folder?.name && <span>المجلد: {file.folder.name}</span>}
                      </div>
                      {file.versions[0]?.scans[0]?.detail && <p className="mt-2 text-xs text-gray-500">نتيجة الفحص: {file.versions[0].scans[0].detail}</p>}
                      {file.versions.length > 1 && (
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          {file.versions.map((version) => (
                            <span key={version.id} className="rounded-lg border bg-white px-2 py-1">
                              v{version.version} · {version.scanStatus}
                              {version.scanStatus === "SAFE" && actor.permissions.has("files.download") && (
                                <a href={`/api/collaboration/files/${file.id}/download?version=${version.version}`} className="mr-2 text-brand-700 hover:underline">تنزيل</a>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-start gap-2 xl:justify-end">
                      <form action={toggleFavoriteAction.bind(null, file.id)}><button className="btn-ghost btn-sm">{file.favorites.length ? "إزالة المفضلة" : "تفضيل"}</button></form>
                      {safe && actor.permissions.has("files.download") && (
                        <>
                          {(file.mimeType.startsWith("image/") || file.mimeType === "application/pdf") && <a href={`/api/collaboration/files/${file.id}/download?preview=1`} className="btn-ghost btn-sm" target="_blank">معاينة</a>}
                          <a href={`/api/collaboration/files/${file.id}/download`} className="btn-primary btn-sm">تنزيل</a>
                        </>
                      )}
                      {filter === "trash" && actor.permissions.has("files.restore") && <form action={restoreFileAction.bind(null, file.id)}><button className="btn-ghost btn-sm">استرجاع</button></form>}
                      {filter !== "trash" && actor.permissions.has("files.delete") && canEdit && <form action={deleteFileAction.bind(null, file.id)}><button className="btn-danger-soft btn-sm">نقل للسلة</button></form>}
                      {filter === "trash" && canAdmin && <form action={permanentDeleteFileAction.bind(null, file.id)}><button className="btn-danger btn-sm">حذف نهائي</button></form>}
                    </div>
                  </div>

                  {canEdit && filter !== "trash" && (
                    <div className="grid gap-3 border-t p-4 lg:grid-cols-2">
                      <form action={updateFileAction.bind(null, file.id)} className="grid gap-2 md:grid-cols-3">
                        <input name="displayName" className="input" defaultValue={file.displayName} />
                        <input name="description" className="input" defaultValue={file.description || ""} placeholder="وصف" />
                        <select name="folderId" className="input" defaultValue={file.folderId || ""}>
                          <option value="">بلا مجلد</option>
                          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                        </select>
                        <div className="md:col-span-3"><button className="btn-ghost btn-sm">حفظ بيانات الملف</button></div>
                      </form>
                      <form action={uploadVersionAction.bind(null, file.id)} encType="multipart/form-data" className="grid gap-2 md:grid-cols-[1fr_auto]">
                        <input name="file" type="file" className="input" required />
                        <button className="btn-ghost btn-sm">رفع إصدار جديد</button>
                      </form>
                    </div>
                  )}

                  {actor.permissions.has("files.share") && safe && filter !== "trash" && (
                    <div className="border-t p-4">
                      <h3 className="mb-2 text-sm font-semibold">المشاركة</h3>
                      <form action={shareFileAction.bind(null, file.id)} className="grid gap-2 md:grid-cols-6">
                        <select name="targetType" className="input">
                          <option value="USER">مستخدم محدد</option>
                          <option value="CONVERSATION">محادثة أو مجموعة</option>
                          <option value="DEPARTMENT">قسم</option>
                          <option value="CENTER">مركز</option>
                          {canAdmin && <option value="ALL_STAFF">جميع الموظفين</option>}
                        </select>
                        <select name="targetUserId" className="input">
                          <option value="">المستخدم</option>
                          {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                        </select>
                        <select name="targetConversationId" className="input">
                          <option value="">المحادثة</option>
                          {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title || "محادثة مباشرة"}</option>)}
                        </select>
                        <input name="targetDepartment" className="input" placeholder="القسم" />
                        <select name="targetCenterId" className="input">
                          <option value="">المركز</option>
                          {centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
                        </select>
                        <button className="btn-primary btn-sm">مشاركة</button>
                      </form>
                      {file.shares.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {file.shares.map((share) => (
                            <form key={share.id} action={revokeShareAction.bind(null, share.id)} className="inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs">
                              <span>{shareTargetLabel(share)}</span>
                              <button className="text-red-600">إلغاء</button>
                            </form>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {filter !== "trash" && (
                    <div className="grid gap-3 border-t bg-gray-50 p-4 lg:grid-cols-2">
                      <form action={linkPatientAction.bind(null, file.id)} className="grid gap-2 md:grid-cols-[1fr_auto]">
                        <select name="patientId" className="input" required>
                          <option value="">إضافة إلى ملف المراجع...</option>
                          {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName}، ملف #{patient.fileNumber}</option>)}
                        </select>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs text-gray-600"><input type="checkbox" name="confirm" required /> تأكيد الربط بالمراجع</label>
                          <button className="btn-ghost btn-sm">ربط</button>
                        </div>
                      </form>
                      {canAdmin && (
                        <form action={transferOwnerAction.bind(null, file.id)} className="grid gap-2 md:grid-cols-[1fr_auto]">
                          <select name="newOwnerId" className="input" required>
                            <option value="">نقل الملكية إلى...</option>
                            {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                          </select>
                          <button className="btn-ghost btn-sm">نقل الملكية</button>
                        </form>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          {actor.permissions.has("files.upload") && (
            <section className="card p-4">
              <h2 className="mb-3 font-semibold">رفع ملفات</h2>
              <FileUploadClient />
              <form action={uploadFileAction} className="mt-4 grid gap-2" encType="multipart/form-data">
                <input name="file" type="file" className="input" />
                <input name="displayName" className="input" placeholder="اسم اختياري" />
                <textarea name="description" className="input" rows={2} placeholder="وصف اختياري" />
                <select name="accessLevel" className="input" defaultValue="PRIVATE">
                  <option value="PRIVATE">خاص</option>
                  <option value="SPECIFIC_USERS">مستخدمون محددون</option>
                  <option value="CONVERSATION">محادثة أو مجموعة</option>
                  <option value="DEPARTMENT">قسم</option>
                  <option value="CENTER">مركز</option>
                  {canAdmin && <option value="ALL_STAFF">جميع الموظفين</option>}
                </select>
                <button className="btn-primary">رفع بنموذج عادي</button>
              </form>
            </section>
          )}

          {actor.permissions.has("files.upload") && (
            <section className="card p-4">
              <h2 className="mb-3 font-semibold">مجلد جديد</h2>
              <form action={createFolderAction} className="space-y-2">
                <input name="name" className="input" placeholder="اسم المجلد" required />
                <select name="parentId" className="input">
                  <option value="">مجلد رئيسي</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                <button className="btn-ghost btn-sm">إنشاء مجلد</button>
              </form>
            </section>
          )}

          <section className="card p-4 text-sm text-gray-600">
            <h2 className="mb-2 font-semibold text-gray-800">قواعد الحماية</h2>
            <p>الملفات تبقى معزولة حتى تنجح نتيجة ClamAV. الملفات التنفيذية والمزدوجة الامتداد ممنوعة خادمياً.</p>
          </section>
        </aside>
      </section>
    </div>
  );
}
