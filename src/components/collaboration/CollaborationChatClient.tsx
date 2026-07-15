"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
} from "@/app/(app)/collaboration/actions";
import { ConversationPoller } from "@/components/collaboration/ConversationPoller";
import { Icon, fmtDate, fmtDateTime, fmtTime, initials, scanClass, scanLabel, sizeLabel } from "@/components/collaboration/CollaborationUi";

type Actor = {
  id: string;
  role: string;
  permissions: string[];
};

type UserOption = {
  id: string;
  fullName: string;
  username: string;
  department: string | null;
};

type CenterOption = {
  id: number;
  name: string;
};

type Member = {
  id: string;
  userId: string;
  role: string;
  muted: boolean;
  status: string;
  user: {
    id: string;
    fullName: string;
    username?: string | null;
    isActive?: boolean;
  };
};

type Conversation = {
  id: string;
  type: "DIRECT" | "GROUP" | "CHANNEL";
  title: string | null;
  description: string | null;
  department: string | null;
  center?: { name: string } | null;
  updatedAt: string;
  unreadCount: number;
  members: Member[];
  messages: {
    id: string;
    body: string | null;
    status: string;
    createdAt: string;
    attachmentFileId?: string | null;
    sender?: { fullName: string } | null;
  }[];
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  sender: { id: string; fullName: string };
  body: string | null;
  status: string;
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
  readCount?: number;
  replyTo?: {
    id: string;
    body: string | null;
    sender: { fullName: string };
  } | null;
  attachmentFile?: {
    id: string;
    publicId?: string;
    displayName: string;
    mimeType: string;
    size: number;
    scanStatus: string;
  } | null;
};

type Props = {
  actor: Actor;
  conversations: Conversation[];
  selected: Conversation | null;
  messages: Message[];
  users: UserOption[];
  centers: CenterOption[];
  canCreate: boolean;
  canSend: boolean;
  canManage: boolean;
  canModerate: boolean;
  canDownload: boolean;
};

const typeLabel: Record<Conversation["type"], string> = {
  DIRECT: "مباشرة",
  GROUP: "مجموعة",
  CHANNEL: "قناة",
};

function conversationTitle(conversation: Conversation, actorId: string) {
  if (conversation.title) return conversation.title;
  const names = conversation.members.filter((member) => member.userId !== actorId).map((member) => member.user.fullName);
  return names.join("، ") || "محادثة مباشرة";
}

function lastMessageText(conversation: Conversation) {
  const message = conversation.messages[0];
  if (!message) return "لا توجد رسائل بعد";
  if (message.status === "DELETED") return "رسالة محذوفة";
  if (message.body) return message.body;
  if (message.attachmentFileId) return "مرفق ملف";
  return "رسالة";
}

function firstUnreadIndex(messages: Message[], unreadCount: number, actorId: string) {
  if (!unreadCount) return -1;
  let remaining = unreadCount;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].senderId !== actorId && messages[index].status === "ACTIVE") {
      remaining -= 1;
      if (remaining <= 0) return index;
    }
  }
  return -1;
}

function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="font-bold text-gray-900">{title}</h2>
          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-100" onClick={onClose} aria-label="إغلاق">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-800">
      {initials(name)}
      {muted && (
        <span className="absolute -bottom-0.5 -left-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-gray-100 text-gray-500" title="محادثة مكتومة">
          <Icon name="mute" className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}

export function CollaborationChatClient({ actor, conversations, selected, messages: initialMessages, users, centers, canCreate, canSend, canManage, canModerate, canDownload }: Props) {
  const router = useRouter();
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationKind, setConversationKind] = useState<"all" | "direct" | "groups">("all");
  const [newOpen, setNewOpen] = useState(false);
  const [newMode, setNewMode] = useState<"direct" | "group" | "channel">("direct");
  const [infoOpen, setInfoOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [messageSearch, setMessageSearch] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(initialMessages.length >= 40);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [pinnedConversationIds, setPinnedConversationIds] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMessages(initialMessages), [initialMessages, selected?.id]);
  useEffect(() => setHasMore(initialMessages.length >= 40), [initialMessages.length, selected?.id]);
  useEffect(() => {
    const raw = window.localStorage.getItem("collaboration:pinned-conversations");
    if (raw) setPinnedConversationIds(JSON.parse(raw));
  }, []);
  useEffect(() => {
    window.localStorage.setItem("collaboration:pinned-conversations", JSON.stringify(pinnedConversationIds));
  }, [pinnedConversationIds]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [selected?.id]);

  const selectedMember = selected?.members.find((member) => member.userId === actor.id);
  const unreadStart = selected ? firstUnreadIndex(messages, selected.unreadCount, actor.id) : -1;
  const unreadTargetId = unreadStart >= 0 ? messages[unreadStart]?.id : null;
  const filteredMessages = messageSearch
    ? messages.filter((message) => [message.body, message.sender.fullName, message.attachmentFile?.displayName].filter(Boolean).join(" ").includes(messageSearch))
    : messages;

  const filteredConversations = useMemo(() => {
    const needle = conversationSearch.trim();
    return conversations
      .filter((conversation) => {
        if (conversationKind === "direct" && conversation.type !== "DIRECT") return false;
        if (conversationKind === "groups" && conversation.type === "DIRECT") return false;
        if (!needle) return true;
        return [conversationTitle(conversation, actor.id), conversation.description, lastMessageText(conversation), conversation.center?.name]
          .filter(Boolean)
          .join(" ")
          .includes(needle);
      })
      .sort((a, b) => {
        const ap = pinnedConversationIds.includes(a.id) ? 1 : 0;
        const bp = pinnedConversationIds.includes(b.id) ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [actor.id, conversationKind, conversationSearch, conversations, pinnedConversationIds]);

  const toggleConversationPin = (id: string) => {
    setPinnedConversationIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [id, ...current]));
  };

  const loadOlder = async () => {
    if (!selected || loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const cursor = encodeURIComponent(messages[0].createdAt);
      const response = await fetch(`/api/collaboration/conversations/${selected.id}/messages?cursor=${cursor}`, { cache: "no-store" });
      if (!response.ok) throw new Error("تعذر تحميل الرسائل السابقة");
      const data = await response.json();
      const older = (data.messages || []) as Message[];
      setHasMore(older.length >= 40);
      setMessages((current) => {
        const existing = new Set(current.map((message) => message.id));
        return [...older.filter((message) => !existing.has(message.id)), ...current];
      });
    } catch {
      setHasMore(false);
    } finally {
      setLoadingOlder(false);
    }
  };

  const scrollToUnread = () => {
    if (!unreadTargetId) return;
    document.getElementById(`message-${unreadTargetId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const threadGrid = infoOpen
    ? "lg:grid-cols-[340px_minmax(0,1fr)_320px]"
    : "lg:grid-cols-[340px_minmax(0,1fr)]";

  return (
    <div className={`grid gap-4 ${threadGrid}`}>
      <aside className={`${selected ? "hidden lg:flex" : "flex"} min-h-[70vh] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm`}>
        <div className="border-b border-gray-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">الدردشات</h2>
              <p className="text-xs text-gray-500">{conversations.reduce((sum, item) => sum + item.unreadCount, 0)} رسالة جديدة</p>
            </div>
            {canCreate && (
              <button type="button" onClick={() => setNewOpen(true)} className="btn-primary btn-sm" aria-label="محادثة جديدة">
                <Icon name="plus" className="h-4 w-4" />
                محادثة جديدة
              </button>
            )}
          </div>
          <label className="relative mt-4 block">
            <span className="sr-only">بحث في الدردشات</span>
            <Icon name="search" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} className="input pr-9" placeholder="بحث عن اسم أو آخر رسالة..." />
          </label>
          <div className="mt-3 grid grid-cols-3 rounded-xl bg-gray-100 p-1 text-xs font-semibold text-gray-600">
            {[
              ["all", "الكل"],
              ["direct", "المباشرة"],
              ["groups", "المجموعات"],
            ].map(([key, label]) => (
              <button key={key} type="button" className={`rounded-lg px-2 py-2 transition ${conversationKind === key ? "bg-white text-brand-700 shadow-sm" : "hover:bg-white/60"}`} onClick={() => setConversationKind(key as typeof conversationKind)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredConversations.length === 0 && (
            <div className="m-2 rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
              لا توجد محادثات مطابقة.
              {canCreate && <button type="button" onClick={() => setNewOpen(true)} className="btn-ghost btn-sm mt-3">بدء محادثة</button>}
            </div>
          )}
          {filteredConversations.map((conversation) => {
            const active = selected?.id === conversation.id;
            const title = conversationTitle(conversation, actor.id);
            const actorMember = conversation.members.find((member) => member.userId === actor.id);
            const pinned = pinnedConversationIds.includes(conversation.id);
            return (
              <div key={conversation.id} className={`group mb-1 flex items-stretch gap-1 rounded-xl border transition ${active ? "border-brand-200 bg-brand-50" : "border-transparent hover:border-gray-200 hover:bg-gray-50"}`}>
                <Link href={`/collaboration?conversation=${conversation.id}`} className="flex min-w-0 flex-1 gap-3 p-3 focus:outline-none focus:ring-2 focus:ring-brand-100">
                  <Avatar name={title} muted={actorMember?.muted} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-bold text-gray-900">{title}</span>
                      <span className="shrink-0 text-[11px] text-gray-500">{fmtTime(conversation.updatedAt)}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
                      <span>{typeLabel[conversation.type]}</span>
                      {conversation.center?.name && <span>· {conversation.center.name}</span>}
                      {pinned && <Icon name="pin" className="h-3.5 w-3.5 text-amber-600" />}
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs text-gray-500">{lastMessageText(conversation)}</span>
                      {conversation.unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{conversation.unreadCount}</span>}
                    </span>
                  </span>
                </Link>
                <button type="button" onClick={() => toggleConversationPin(conversation.id)} className={`my-2 ml-2 flex w-8 items-center justify-center rounded-lg ${pinned ? "text-amber-600" : "text-gray-400 opacity-0 hover:bg-white group-hover:opacity-100 focus:opacity-100"}`} aria-label={pinned ? "إلغاء تثبيت المحادثة" : "تثبيت المحادثة"}>
                  <Icon name="pin" className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <main className={`${selected ? "flex" : "hidden lg:flex"} min-w-0 min-h-[70vh] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm`}>
        {selected ? (
          <>
            <ConversationPoller conversationId={selected.id} lastMessageId={messages[messages.length - 1]?.id} />
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-3">
                <Link href="/collaboration" className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-600 lg:hidden" aria-label="رجوع إلى قائمة المحادثات">
                  <Icon name="arrow" className="h-5 w-5" />
                </Link>
                <Avatar name={conversationTitle(selected, actor.id)} muted={selectedMember?.muted} />
                <div className="min-w-0">
                  <h2 className="truncate font-bold text-gray-900">{conversationTitle(selected, actor.id)}</h2>
                  <p className="truncate text-xs text-gray-500">
                    {typeLabel[selected.type]} · {selected.members.filter((member) => member.status === "ACTIVE").length} أعضاء
                    {selected.department ? ` · ${selected.department}` : ""}{selected.center?.name ? ` · ${selected.center.name}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selected.unreadCount > 0 && (
                  <button type="button" className="btn-ghost btn-sm hidden sm:inline-flex" onClick={scrollToUnread}>
                    <Icon name="bell" className="h-4 w-4" />
                    آخر غير مقروء
                  </button>
                )}
                <button type="button" className="btn-ghost btn-sm" onClick={() => setInfoOpen((value) => !value)} aria-expanded={infoOpen} aria-label="معلومات المحادثة">
                  <Icon name="info" className="h-4 w-4" />
                  <span className="hidden sm:inline">المعلومات</span>
                </button>
              </div>
            </header>

            <div
              ref={scrollerRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 px-3 py-4 sm:px-5"
              onScroll={(event) => {
                if (event.currentTarget.scrollTop < 80) void loadOlder();
              }}
            >
              {loadingOlder && (
                <div className="mx-auto w-fit rounded-full bg-white px-3 py-1 text-xs text-gray-500 shadow-sm">تحميل رسائل سابقة...</div>
              )}
              {hasMore && !loadingOlder && messages.length > 0 && (
                <button type="button" onClick={loadOlder} className="mx-auto flex rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">
                  تحميل الرسائل السابقة
                </button>
              )}
              {filteredMessages.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">لا توجد رسائل مطابقة.</div>
              )}
              {filteredMessages.map((message, index) => {
                const previous = filteredMessages[index - 1];
                const showDate = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                const mine = message.senderId === actor.id;
                const active = message.status === "ACTIVE";
                const canEditMessageUi = active && (mine || canModerate);
                const canDeleteMessageUi = active && (mine || canModerate);
                return (
                  <React.Fragment key={message.id}>
                    {showDate && <div className="mx-auto w-fit rounded-full bg-white px-3 py-1 text-xs text-gray-500 shadow-sm">{fmtDate(message.createdAt)}</div>}
                    {unreadStart === index && <div className="mx-auto w-fit rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">رسائل جديدة</div>}
                    <article id={`message-${message.id}`} className={`relative flex ${mine ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[92%] rounded-2xl border px-3 py-2 shadow-sm sm:max-w-[72%] ${mine ? "rounded-br-md border-brand-100 bg-brand-600 text-white" : "rounded-bl-md border-gray-200 bg-white text-gray-900"}`}>
                        <div className={`mb-1 flex items-center justify-between gap-3 text-[11px] ${mine ? "text-brand-50/85" : "text-gray-500"}`}>
                          <span className="font-semibold">{message.sender.fullName}</span>
                          <span>{fmtTime(message.createdAt)}{message.editedAt ? " · عُدلت" : ""}</span>
                        </div>
                        {message.replyTo && (
                          <div className={`mb-2 rounded-lg border-r-2 p-2 text-xs ${mine ? "border-white/50 bg-white/10 text-white/85" : "border-brand-300 bg-brand-50 text-gray-600"}`}>
                            <div className="font-semibold">{message.replyTo.sender.fullName}</div>
                            <div className="truncate">{message.replyTo.body || "مرفق"}</div>
                          </div>
                        )}
                        {!active ? (
                          <p className={`text-sm ${mine ? "text-white/75" : "text-gray-400"}`}>تم حذف هذه الرسالة.</p>
                        ) : (
                          <>
                            {message.body && <p className="whitespace-pre-wrap break-words text-sm leading-7">{message.body}</p>}
                            {message.attachmentFile && (
                              <AttachmentCard attachment={message.attachmentFile} mine={mine} canDownload={canDownload} />
                            )}
                          </>
                        )}
                        <div className={`mt-2 flex items-center justify-between gap-2 text-[11px] ${mine ? "text-brand-50/85" : "text-gray-500"}`}>
                          <span>{mine ? ((message.readCount || 0) > 1 ? "مقروء" : "مرسل") : ""}</span>
                          {active && (
                            <div className="relative">
                              <button type="button" className={`flex h-7 w-7 items-center justify-center rounded-lg ${mine ? "hover:bg-white/15" : "hover:bg-gray-100"}`} onClick={() => setMenuId(menuId === message.id ? null : message.id)} aria-label="إجراءات الرسالة">
                                <Icon name="more" className="h-4 w-4" />
                              </button>
                              {menuId === message.id && (
                                <div className={`absolute bottom-8 z-20 w-40 rounded-xl border border-gray-200 bg-white p-1 text-gray-700 shadow-xl ${mine ? "right-0" : "left-0"}`}>
                                  <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { setReplyTo(message); setMenuId(null); }}>
                                    <Icon name="reply" className="h-4 w-4" /> رد
                                  </button>
                                  {canEditMessageUi && (
                                    <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { setEditing(message); setMenuId(null); }}>
                                      <Icon name="edit" className="h-4 w-4" /> تعديل
                                    </button>
                                  )}
                                  {canModerate && (
                                    <form action={pinMessageAction.bind(null, message.id, selected.id, !message.pinned)}>
                                      <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">
                                        <Icon name="pin" className="h-4 w-4" /> {message.pinned ? "إلغاء التثبيت" : "تثبيت"}
                                      </button>
                                    </form>
                                  )}
                                  {message.attachmentFile?.scanStatus === "SAFE" && canDownload && (
                                    <a href={`/api/collaboration/files/${message.attachmentFile.id}/download`} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">
                                      <Icon name="download" className="h-4 w-4" /> تنزيل الملف
                                    </a>
                                  )}
                                  {canDeleteMessageUi && (
                                    <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50" onClick={() => { setDeleting(message); setMenuId(null); }}>
                                      <Icon name="trash" className="h-4 w-4" /> حذف
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  </React.Fragment>
                );
              })}
              <div ref={endRef} />
            </div>

            {canSend ? (
              <MessageComposer selected={selected} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
            ) : (
              <div className="border-t border-gray-200 bg-white p-4 text-sm text-gray-500">لا تملك صلاحية إرسال الرسائل في مركز التعاون.</div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <Icon name="chat" className="h-8 w-8" />
              </div>
              <h2 className="mt-4 font-bold text-gray-900">اختر محادثة للبدء</h2>
              <p className="mt-2 text-sm text-gray-500">القائمة تعرض المحادثات المباشرة والمجموعات والقنوات المتاحة لك.</p>
            </div>
          </div>
        )}
      </main>

      {selected && infoOpen && (
        <ConversationInfo
          actor={actor}
          selected={selected}
          users={users}
          canManage={canManage}
          canModerate={canModerate}
          messageSearch={messageSearch}
          onMessageSearch={setMessageSearch}
          onClose={() => setInfoOpen(false)}
        />
      )}

      <NewConversationModal
        open={newOpen}
        mode={newMode}
        setMode={setNewMode}
        onClose={() => setNewOpen(false)}
        users={users.filter((user) => user.id !== actor.id)}
        centers={centers}
        canCreateChannel={actor.role === "ADMIN" || actor.permissions.includes("chat.manage.members")}
      />

      <EditMessageModal message={editing} onClose={() => setEditing(null)} conversationId={selected?.id || ""} />
      <DeleteMessageModal message={deleting} onClose={() => setDeleting(null)} conversationId={selected?.id || ""} />
    </div>
  );
}

function AttachmentCard({ attachment, mine, canDownload }: { attachment: NonNullable<Message["attachmentFile"]>; mine: boolean; canDownload: boolean }) {
  const safe = attachment.scanStatus === "SAFE";
  const isImage = safe && attachment.mimeType.startsWith("image/");
  const isPdf = safe && attachment.mimeType === "application/pdf";
  const previewUrl = `/api/collaboration/files/${attachment.id}/download?preview=1`;
  return (
    <div className={`mt-2 overflow-hidden rounded-xl border text-sm ${mine ? "border-white/20 bg-white/10" : "border-gray-200 bg-gray-50"}`}>
      {isImage && <img src={previewUrl} alt="" className="max-h-60 w-full rounded-t-xl object-cover" loading="lazy" />}
      {isPdf && (
        <div className={`flex h-24 items-center justify-center gap-2 ${mine ? "text-white" : "text-red-700"}`}>
          <Icon name="pdf" className="h-8 w-8" />
          <span className="font-bold">PDF</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{attachment.displayName}</div>
          <div className={`mt-0.5 text-xs ${mine ? "text-white/75" : "text-gray-500"}`}>{attachment.mimeType} · {sizeLabel(attachment.size)} · {scanLabel[attachment.scanStatus] || attachment.scanStatus}</div>
          {!safe && <div className={`mt-1 text-xs ${attachment.scanStatus === "PENDING_SCAN" ? "text-amber-700" : "text-red-700"}`}>{attachment.scanStatus === "PENDING_SCAN" ? "لا يمكن تنزيل الملف قبل اكتمال الفحص." : "رُفض الملف لأنه لم يجتز الفحص الأمني."}</div>}
        </div>
        {safe && canDownload && (
          <a href={`/api/collaboration/files/${attachment.id}/download`} className={`${mine ? "bg-white text-brand-700 hover:bg-brand-50" : "bg-brand-600 text-white hover:bg-brand-700"} flex h-9 w-9 shrink-0 items-center justify-center rounded-lg`} aria-label="تنزيل الملف">
            <Icon name="download" className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}

function MessageComposer({ selected, replyTo, onClearReply }: { selected: Conversation; replyTo: Message | null; onClearReply: () => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const uploadFiles = (selectedFiles: File[]) => new Promise<string[]>((resolve, reject) => {
    const form = new FormData();
    selectedFiles.forEach((file) => form.append("files", file));
    form.set("accessLevel", "CONVERSATION");
    form.set("conversationId", selected.id);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/collaboration/files");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.ids || []);
        else reject(new Error(data.error || "تعذر رفع الملف"));
      } catch {
        reject(new Error("تعذر قراءة نتيجة الرفع"));
      }
    };
    xhr.onerror = () => reject(new Error("انقطع الاتصال أثناء الرفع"));
    xhr.send(form);
  });

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!body.trim() && files.length === 0) {
      setError("اكتب رسالة أو أرفق ملفاً.");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        let attachmentIds: string[] = [];
        if (files.length) attachmentIds = await uploadFiles(files);
        const batches = attachmentIds.length ? attachmentIds : [""];
        for (const [index, attachmentId] of batches.entries()) {
          const form = new FormData();
          form.set("body", index === 0 ? body : "");
          if (replyTo && index === 0) form.set("replyToId", replyTo.id);
          if (attachmentId) form.set("attachmentFileId", attachmentId);
          await sendMessageAction(selected.id, form);
        }
        setBody("");
        setFiles([]);
        setProgress(0);
        onClearReply();
        router.refresh();
        requestAnimationFrame(() => document.getElementById("chat-composer-end")?.scrollIntoView({ block: "end" }));
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "تعذر إرسال الرسالة.");
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={submit} className="shrink-0 border-t border-gray-200 bg-white p-3" encType="multipart/form-data">
      {replyTo && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-gray-700">
          <div className="min-w-0">
            <div className="font-semibold text-brand-800">رد على {replyTo.sender.fullName}</div>
            <div className="truncate text-xs text-gray-500">{replyTo.body || replyTo.attachmentFile?.displayName || "مرفق"}</div>
          </div>
          <button type="button" onClick={onClearReply} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-white" aria-label="إلغاء الرد">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((file) => (
            <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <Icon name={file.type.startsWith("image/") ? "image" : file.type === "application/pdf" ? "pdf" : "file"} className="h-4 w-4" />
              <span className="max-w-48 truncate">{file.name}</span>
              <span>{sizeLabel(file.size)}</span>
              <button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} className="text-red-600" aria-label={`إلغاء ${file.name}`}>
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      {progress > 0 && progress < 100 && (
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex items-end gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.currentTarget.files) setFiles(Array.from(event.currentTarget.files));
          }}
        />
        <button type="button" onClick={() => inputRef.current?.click()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-100" aria-label="إرفاق ملف">
          <Icon name="attach" className="h-5 w-5" />
        </button>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          rows={2}
          className="input max-h-36 min-h-11 resize-none"
          placeholder="اكتب رسالة... Enter للإرسال و Shift+Enter لسطر جديد"
          aria-label="نص الرسالة"
        />
        <button type="submit" disabled={isPending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50" aria-label="إرسال">
          <Icon name="send" className="h-5 w-5" />
        </button>
      </div>
      <div id="chat-composer-end" />
    </form>
  );
}

function ConversationInfo({
  actor,
  selected,
  users,
  canManage,
  canModerate,
  messageSearch,
  onMessageSearch,
  onClose,
}: {
  actor: Actor;
  selected: Conversation;
  users: UserOption[];
  canManage: boolean;
  canModerate: boolean;
  messageSearch: string;
  onMessageSearch: (value: string) => void;
  onClose: () => void;
}) {
  const selectedMember = selected.members.find((member) => member.userId === actor.id);
  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-full max-w-sm flex-col overflow-hidden border-r border-gray-200 bg-white shadow-2xl lg:static lg:z-auto lg:max-w-none lg:rounded-2xl lg:border lg:shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="font-bold text-gray-900">معلومات المحادثة</h2>
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100" aria-label="إغلاق معلومات المحادثة">
          <Icon name="close" className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-xl font-bold text-brand-800">{initials(conversationTitle(selected, actor.id))}</div>
          <h3 className="mt-3 text-center font-bold text-gray-900">{conversationTitle(selected, actor.id)}</h3>
          <p className="text-center text-sm text-gray-500">{typeLabel[selected.type]} · {selected.members.length} أعضاء</p>
        </section>
        <label className="block">
          <span className="label">بحث داخل المحادثة</span>
          <input value={messageSearch} onChange={(event) => onMessageSearch(event.target.value)} className="input" placeholder="كلمة أو اسم ملف..." />
        </label>
        <section className="space-y-2">
          <div className="flex gap-2">
            <form action={memberAction.bind(null, selected.id, actor.id, selectedMember?.muted ? "UNMUTE" : "MUTE")}>
              <button className="btn-ghost btn-sm"><Icon name="mute" className="h-4 w-4" />{selectedMember?.muted ? "إلغاء الكتم" : "كتم"}</button>
            </form>
            {selected.type !== "CHANNEL" && (
              <form action={memberAction.bind(null, selected.id, actor.id, "LEAVE")}>
                <button className="btn-danger-soft btn-sm">مغادرة</button>
              </form>
            )}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-bold text-gray-900">الأعضاء</h3>
          <div className="space-y-2">
            {selected.members.filter((member) => member.status === "ACTIVE").map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 p-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-gray-800">{member.user.fullName}</div>
                  <div className="text-xs text-gray-500">{member.role}{member.muted ? " · مكتوم" : ""}</div>
                </div>
                {canManage && member.userId !== actor.id && (
                  <div className="flex shrink-0 gap-1">
                    <form action={memberAction.bind(null, selected.id, member.userId, member.role === "MODERATOR" ? "DEMOTE" : "PROMOTE")}>
                      <button className="btn-ghost btn-xs">{member.role === "MODERATOR" ? "عضو" : "مشرف"}</button>
                    </form>
                    <form action={memberAction.bind(null, selected.id, member.userId, "REMOVE")}>
                      <button className="btn-danger-soft btn-xs">إزالة</button>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
          {canManage && (
            <form action={addMemberAction.bind(null, selected.id)} className="mt-3 grid gap-2">
              <select name="targetUserId" className="input" required>
                <option value="">إضافة عضو</option>
                {users.filter((user) => !selected.members.some((member) => member.userId === user.id && member.status === "ACTIVE")).map((user) => (
                  <option key={user.id} value={user.id}>{user.fullName}</option>
                ))}
              </select>
              <button className="btn-primary btn-sm">إضافة العضو</button>
            </form>
          )}
        </section>
        {canModerate && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            تظهر أوامر التثبيت والحذف حسب صلاحياتك من قائمة كل رسالة.
          </section>
        )}
      </div>
    </aside>
  );
}

function NewConversationModal({
  open,
  mode,
  setMode,
  onClose,
  users,
  centers,
  canCreateChannel,
}: {
  open: boolean;
  mode: "direct" | "group" | "channel";
  setMode: (mode: "direct" | "group" | "channel") => void;
  onClose: () => void;
  users: UserOption[];
  centers: CenterOption[];
  canCreateChannel: boolean;
}) {
  return (
    <Modal title="محادثة جديدة" open={open} onClose={onClose}>
      <div className="mb-4 grid rounded-xl bg-gray-100 p-1 text-sm font-semibold text-gray-600 sm:grid-cols-3">
        {[
          ["direct", "مباشرة"],
          ["group", "مجموعة"],
          ...(canCreateChannel ? [["channel", "قناة"]] : []),
        ].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setMode(key as typeof mode)} className={`rounded-lg px-3 py-2 transition ${mode === key ? "bg-white text-brand-700 shadow-sm" : "hover:bg-white/60"}`}>
            {label}
          </button>
        ))}
      </div>
      {mode === "direct" && (
        <form action={createDirectAction} className="grid gap-3">
          <label className="label">اختر مستخدماً</label>
          <select name="targetUserId" className="input" required>
            <option value="">المستخدم</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.fullName} (@{user.username})</option>)}
          </select>
          <button className="btn-primary">فتح المحادثة</button>
        </form>
      )}
      {mode === "group" && (
        <form action={createGroupAction} className="grid gap-3">
          <label className="label">اسم المجموعة</label>
          <input name="title" className="input" required />
          <label className="label">الأعضاء</label>
          <select name="memberIds" className="input min-h-44" multiple>
            {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
          </select>
          <textarea name="description" className="input" rows={2} placeholder="وصف اختياري" />
          <button className="btn-primary">إنشاء المجموعة</button>
        </form>
      )}
      {mode === "channel" && canCreateChannel && (
        <form action={createChannelAction} className="grid gap-3">
          <input name="title" className="input" placeholder="اسم القناة" required />
          <textarea name="description" className="input" rows={2} placeholder="وصف اختياري" />
          <input name="department" className="input" placeholder="القسم (اختياري)" />
          <select name="centerId" className="input">
            <option value="">كل المراكز أو بلا مركز</option>
            {centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
          </select>
          <button className="btn-primary">إنشاء القناة</button>
        </form>
      )}
    </Modal>
  );
}

function EditMessageModal({ message, conversationId, onClose }: { message: Message | null; conversationId: string; onClose: () => void }) {
  if (!message) return null;
  return (
    <Modal title="تعديل الرسالة" open={!!message} onClose={onClose}>
      <form action={editMessageAction.bind(null, message.id, conversationId)} className="grid gap-3">
        <textarea name="body" className="input min-h-32" defaultValue={message.body || ""} required />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">إلغاء</button>
          <button className="btn-primary">حفظ التعديل</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteMessageModal({ message, conversationId, onClose }: { message: Message | null; conversationId: string; onClose: () => void }) {
  if (!message) return null;
  return (
    <Modal title="حذف الرسالة" open={!!message} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">سيتم حذف محتوى الرسالة من المحادثة مع إبقاء سجل التدقيق الخادمي كما هو.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">إلغاء</button>
          <form action={deleteMessageAction.bind(null, message.id, conversationId)}>
            <button className="btn-danger">حذف</button>
          </form>
        </div>
      </div>
    </Modal>
  );
}
