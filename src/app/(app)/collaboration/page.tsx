import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { FileUploadClient } from "@/components/collaboration/FileUploadClient";
import { ConversationPoller } from "@/components/collaboration/ConversationPoller";
import { prisma } from "@/lib/db";
import { collaborationActor, listConversations, listMessages } from "@/lib/collaboration-service";
import {
  addMemberAction,
  createChannelAction,
  createDirectAction,
  createGroupAction,
  deleteMessageAction,
  editMessageAction,
  memberAction,
  pinMessageAction,
  sendMessageAction,
} from "./actions";

export const dynamic = "force-dynamic";

const typeLabel: Record<string, string> = {
  DIRECT: "مباشرة",
  GROUP: "مجموعة",
  CHANNEL: "قناة",
};

function fmtDate(value: Date) {
  return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" }).format(value);
}

export default async function CollaborationPage({ searchParams }: { searchParams: Promise<{ conversation?: string; q?: string }> }) {
  const actor = await collaborationActor("collaboration.view");
  const params = await searchParams;
  const [conversations, users, centers] = await Promise.all([
    listConversations(actor),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, username: true, department: true }, orderBy: { fullName: "asc" }, take: 200 }),
    prisma.center.findMany({ orderBy: { name: "asc" }, take: 100 }),
  ]);
  const selected = conversations.find((c) => c.id === params.conversation) || conversations[0] || null;
  const rawMessages = selected ? await listMessages(actor, selected.id) : [];
  const q = (params.q || "").trim();
  const messages = q
    ? rawMessages.filter((m) => [m.body, m.sender.fullName, m.attachmentFile?.displayName].filter(Boolean).join(" ").includes(q))
    : rawMessages;
  const selectedMember = selected?.members.find((m) => m.userId === actor.id);
  const canManage = actor.role === "ADMIN" || actor.permissions.has("chat.manage.members") || selectedMember?.role === "OWNER" || selectedMember?.role === "MODERATOR";
  const canModerate = actor.role === "ADMIN" || actor.permissions.has("chat.moderate") || canManage;

  return (
    <div className="space-y-5">
      <PageHeader title="مركز التعاون" subtitle="محادثات داخلية وملفات عمل منفصلة عن وثائق المراجعين" icon="💬">
        <Link href="/collaboration/files" className="btn-ghost bg-white text-brand-700">مركز الملفات</Link>
        {actor.permissions.has("files.admin") && <Link href="/collaboration/admin" className="btn-ghost bg-white text-brand-700">إدارة الخدمة</Link>}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="card overflow-hidden">
            <div className="border-b p-4">
              <h2 className="font-semibold">المحادثات</h2>
              <p className="text-xs text-gray-500">عداد غير المقروء يظهر بجانب كل محادثة.</p>
            </div>
            <div className="max-h-[560px] overflow-y-auto p-2">
              {conversations.length === 0 && <div className="p-4 text-sm text-gray-500">لا توجد محادثات بعد.</div>}
              {conversations.map((conversation) => {
                const href = `/collaboration?conversation=${conversation.id}`;
                const active = selected?.id === conversation.id;
                const title = conversation.title || conversation.members.filter((m) => m.userId !== actor.id).map((m) => m.user.fullName).join("، ") || "محادثة مباشرة";
                return (
                  <Link key={conversation.id} href={href} className={`mb-1 block rounded-lg border p-3 text-sm ${active ? "border-brand-200 bg-brand-50" : "border-gray-100 hover:bg-gray-50"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{title}</span>
                      {conversation.unreadCount > 0 && <span className="badge-danger">{conversation.unreadCount}</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                      <span>{typeLabel[conversation.type]}</span>
                      {conversation.center?.name && <span>· {conversation.center.name}</span>}
                    </div>
                    <p className="mt-2 truncate text-xs text-gray-500">
                      {conversation.messages[0]?.status === "DELETED" ? "رسالة محذوفة" : conversation.messages[0]?.body || conversation.messages[0]?.attachmentFileId || "لا توجد رسائل"}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>

          {actor.permissions.has("chat.create") && (
            <section className="card space-y-3 p-4">
              <h2 className="font-semibold">إنشاء محادثة</h2>
              <form action={createDirectAction} className="space-y-2">
                <label className="label">محادثة مباشرة</label>
                <select name="targetUserId" className="input" required>
                  <option value="">اختر مستخدماً</option>
                  {users.filter((u) => u.id !== actor.id).map((user) => <option key={user.id} value={user.id}>{user.fullName} (@{user.username})</option>)}
                </select>
                <button className="btn-primary btn-sm">فتح محادثة</button>
              </form>
              <form action={createGroupAction} className="space-y-2 border-t pt-3">
                <label className="label">مجموعة خاصة</label>
                <input name="title" className="input" placeholder="اسم المجموعة" required />
                <select name="memberIds" className="input min-h-28" multiple>
                  {users.filter((u) => u.id !== actor.id).map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                </select>
                <button className="btn-primary btn-sm">إنشاء مجموعة</button>
              </form>
            </section>
          )}
        </aside>

        <main className="min-w-0 space-y-4">
          {selected ? (
            <>
              <ConversationPoller conversationId={selected.id} lastMessageId={rawMessages[rawMessages.length - 1]?.id} />
              <section className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{selected.title || "محادثة مباشرة"}</h2>
                    <p className="text-sm text-gray-500">
                      {typeLabel[selected.type]} · {selected.members.filter((m) => m.status === "ACTIVE").length} أعضاء
                      {selected.department ? ` · ${selected.department}` : ""}{selected.center?.name ? ` · ${selected.center.name}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <form action={memberAction.bind(null, selected.id, actor.id, selectedMember?.muted ? "UNMUTE" : "MUTE")}>
                      <button className="btn-ghost btn-sm">{selectedMember?.muted ? "إلغاء الكتم" : "كتم المحادثة"}</button>
                    </form>
                    {selected.type !== "CHANNEL" && (
                      <form action={memberAction.bind(null, selected.id, actor.id, "LEAVE")}>
                        <button className="btn-danger-soft btn-sm">مغادرة</button>
                      </form>
                    )}
                  </div>
                </div>
                <form className="mt-3" action="/collaboration">
                  <input type="hidden" name="conversation" value={selected.id} />
                  <input name="q" className="input" defaultValue={q} placeholder="بحث داخل المحادثة..." />
                </form>
              </section>

              {messages.some((m) => m.pinned && m.status === "ACTIVE") && (
                <section className="card border-amber-200 bg-amber-50 p-4">
                  <h3 className="mb-2 font-semibold text-amber-800">رسائل مثبتة</h3>
                  <div className="space-y-2">
                    {messages.filter((m) => m.pinned && m.status === "ACTIVE").map((message) => (
                      <p key={message.id} className="text-sm text-amber-900">{message.sender.fullName}: {message.body || message.attachmentFile?.displayName}</p>
                    ))}
                  </div>
                </section>
              )}

              <section className="card">
                <div className="max-h-[620px] space-y-3 overflow-y-auto p-4">
                  {messages.length === 0 && <div className="p-6 text-center text-sm text-gray-500">لا توجد رسائل مطابقة.</div>}
                  {messages.map((message) => {
                    const mine = message.senderId === actor.id;
                    return (
                      <article key={message.id} className={`max-w-[88%] rounded-xl border p-3 ${mine ? "mr-auto border-brand-100 bg-brand-50" : "ml-auto border-gray-100 bg-white"}`}>
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                          <span className="font-medium text-gray-700">{message.sender.fullName}</span>
                          <span>{fmtDate(message.createdAt)}{message.editedAt ? " · عُدلت" : ""}</span>
                        </div>
                        {message.replyTo && <div className="mb-2 rounded border-r-2 border-brand-300 bg-white/70 p-2 text-xs text-gray-500">رد على {message.replyTo.sender.fullName}: {message.replyTo.body || "مرفق"}</div>}
                        {message.status === "DELETED" ? (
                          <p className="text-sm text-gray-400">تم حذف هذه الرسالة.</p>
                        ) : (
                          <>
                            {message.body && <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{message.body}</p>}
                            {message.attachmentFile && (
                              <div className="mt-2 rounded-lg border bg-white p-2 text-sm">
                                <div className="font-medium">{message.attachmentFile.displayName}</div>
                                <div className="text-xs text-gray-500">{message.attachmentFile.mimeType} · {Math.ceil(message.attachmentFile.size / 1024)} KB · {message.attachmentFile.scanStatus}</div>
                                {message.attachmentFile.scanStatus === "SAFE"
                                  ? <a href={`/api/collaboration/files/${message.attachmentFile.id}/download`} className="mt-2 inline-flex text-brand-700 hover:underline">تنزيل المرفق</a>
                                  : <span className="mt-2 inline-flex text-xs text-amber-700">قيد الفحص ولا يمكن تنزيله بعد</span>}
                              </div>
                            )}
                          </>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {message.status === "ACTIVE" && (
                            <form action={sendMessageAction.bind(null, selected.id)} className="flex flex-1 gap-2">
                              <input type="hidden" name="replyToId" value={message.id} />
                              <input name="body" className="input !py-1 text-xs" placeholder="رد سريع..." />
                              <button className="btn-ghost btn-xs">رد</button>
                            </form>
                          )}
                          {(mine || canModerate) && message.status === "ACTIVE" && (
                            <form action={editMessageAction.bind(null, message.id, selected.id)} className="flex flex-1 gap-2">
                              <input name="body" className="input !py-1 text-xs" defaultValue={message.body || ""} placeholder="تعديل النص..." />
                              <button className="btn-ghost btn-xs">حفظ</button>
                            </form>
                          )}
                          {canModerate && message.status === "ACTIVE" && (
                            <form action={pinMessageAction.bind(null, message.id, selected.id, !message.pinned)}>
                              <button className="btn-ghost btn-xs">{message.pinned ? "إلغاء التثبيت" : "تثبيت"}</button>
                            </form>
                          )}
                          {(mine || canModerate) && message.status === "ACTIVE" && (
                            <form action={deleteMessageAction.bind(null, message.id, selected.id)}>
                              <button className="btn-danger-soft btn-xs">حذف</button>
                            </form>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {actor.permissions.has("chat.send") && (
                  <form action={sendMessageAction.bind(null, selected.id)} className="grid gap-3 border-t p-4 md:grid-cols-[1fr_auto]" encType="multipart/form-data">
                    <textarea name="body" className="input min-h-24" placeholder="اكتب رسالة... استخدم @username للإشارة إلى مستخدم" />
                    <div className="space-y-2">
                      <input name="file" type="file" className="input text-xs" />
                      <button className="btn-primary w-full">إرسال</button>
                    </div>
                  </form>
                )}
              </section>

              <section className="grid gap-4 xl:grid-cols-2">
                <div className="card p-4">
                  <h3 className="mb-3 font-semibold">رفع ملفات للمحادثة</h3>
                  <FileUploadClient conversationId={selected.id} />
                </div>
                <div className="card p-4">
                  <h3 className="mb-3 font-semibold">الأعضاء</h3>
                  <div className="space-y-2">
                    {selected.members.filter((m) => m.status === "ACTIVE").map((member) => (
                      <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                        <span>{member.user.fullName} <span className="text-xs text-gray-500">({member.role}{member.muted ? " · مكتوم" : ""})</span></span>
                        {canManage && member.userId !== actor.id && (
                          <div className="flex gap-1">
                            <form action={memberAction.bind(null, selected.id, member.userId, member.role === "MODERATOR" ? "DEMOTE" : "PROMOTE")}><button className="btn-ghost btn-xs">{member.role === "MODERATOR" ? "عضو" : "مشرف"}</button></form>
                            <form action={memberAction.bind(null, selected.id, member.userId, "REMOVE")}><button className="btn-danger-soft btn-xs">إزالة</button></form>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {canManage && (
                    <form action={addMemberAction.bind(null, selected.id)} className="mt-3 flex gap-2">
                      <select name="targetUserId" className="input" required>
                        <option value="">إضافة عضو</option>
                        {users.filter((u) => !selected.members.some((m) => m.userId === u.id && m.status === "ACTIVE")).map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
                      </select>
                      <button className="btn-primary btn-sm">إضافة</button>
                    </form>
                  )}
                </div>
              </section>
            </>
          ) : (
            <section className="card p-8 text-center text-gray-500">أنشئ محادثة مباشرة أو مجموعة للبدء.</section>
          )}

          {actor.permissions.has("chat.manage.members") && (
            <section className="card p-4">
              <h2 className="mb-3 font-semibold">إنشاء قناة قسم أو مركز</h2>
              <form action={createChannelAction} className="grid gap-3 md:grid-cols-4">
                <input name="title" className="input" placeholder="اسم القناة" required />
                <input name="department" className="input" placeholder="القسم (اختياري)" />
                <select name="centerId" className="input">
                  <option value="">كل المراكز أو بلا مركز</option>
                  {centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
                </select>
                <button className="btn-primary">إنشاء قناة</button>
              </form>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
