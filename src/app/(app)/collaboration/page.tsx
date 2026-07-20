import { CollaborationChatClient } from "@/components/collaboration/CollaborationChatClient";
import { CollaborationTopNav } from "@/components/collaboration/CollaborationUi";
import { prisma } from "@/lib/db";
import { collaborationActor, listConversations, listMessages } from "@/lib/collaboration-service";
import { getAdminConfig } from "@/lib/admin-config";

export const dynamic = "force-dynamic";

function serializeDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

function serializeConversation(conversation: any, actorId: string, unreadCount = 0, messages: any[] = []) {
  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title,
    description: conversation.description,
    department: conversation.department,
    center: conversation.center ? { name: conversation.center.name } : null,
    updatedAt: serializeDate(conversation.updatedAt) || new Date().toISOString(),
    unreadCount,
    members: (conversation.members || []).map((member: any) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      muted: member.muted,
      status: member.status,
      user: {
        id: member.user.id,
        fullName: member.user.fullName,
        username: member.user.username || null,
        isActive: member.user.isActive ?? true,
      },
    })),
    messages: messages.map((message: any) => ({
      id: message.id,
      body: message.body,
      status: message.status,
      createdAt: serializeDate(message.createdAt) || "",
      attachmentFileId: message.attachmentFileId,
      sender: message.sender ? { fullName: message.sender.fullName } : null,
    })),
  };
}

function serializeMessage(message: any) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    sender: { id: message.sender.id, fullName: message.sender.fullName },
    body: message.body,
    status: message.status,
    pinned: message.pinned,
    editedAt: serializeDate(message.editedAt),
    createdAt: serializeDate(message.createdAt) || "",
    readCount: message._count?.reads || 0,
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          body: message.replyTo.body,
          sender: { fullName: message.replyTo.sender.fullName },
        }
      : null,
    attachmentFile: message.attachmentFile
      ? {
          id: message.attachmentFile.id,
          publicId: message.attachmentFile.publicId,
          displayName: message.attachmentFile.displayName,
          mimeType: message.attachmentFile.mimeType,
          size: message.attachmentFile.size,
          scanStatus: message.attachmentFile.scanStatus,
        }
      : null,
  };
}

export default async function CollaborationPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const actor = await collaborationActor("collaboration.view");
  const params = await searchParams;
  const [conversationRows, users, centers, adminConfig] = await Promise.all([
    listConversations(actor),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, username: true, department: true },
      orderBy: { fullName: "asc" },
      take: 200,
    }),
    prisma.center.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 100 }),
    getAdminConfig(),
  ]);

  const selectedSummary = conversationRows.find((conversation) => conversation.id === params.conversation) || conversationRows[0] || null;
  const selectedFull = selectedSummary
    ? await prisma.conversation.findUnique({
        where: { id: selectedSummary.id },
        include: {
          center: { select: { name: true } },
          members: {
            where: { status: "ACTIVE" },
            include: { user: { select: { id: true, fullName: true, username: true, isActive: true } } },
            orderBy: { joinedAt: "asc" },
          },
        },
      } as any)
    : null;

  const rawMessages = selectedSummary ? await listMessages(actor, selectedSummary.id) : [];
  const conversations = conversationRows.map((conversation) =>
    serializeConversation(conversation, actor.id, conversation.unreadCount, conversation.messages || [])
  );
  const selected = selectedFull
    ? serializeConversation(selectedFull, actor.id, selectedSummary?.unreadCount || 0, selectedSummary?.messages || [])
    : null;
  const selectedMember = selected?.members.find((member: any) => member.userId === actor.id);
  const canManage =
    actor.role === "ADMIN" ||
    actor.permissions.has("chat.manage.members") ||
    selectedMember?.role === "OWNER" ||
    selectedMember?.role === "MODERATOR";
  const canModerate = actor.role === "ADMIN" || actor.permissions.has("chat.moderate") || !!canManage;
  const unreadCount = conversationRows.reduce((sum, conversation) => sum + conversation.unreadCount, 0);

  return (
    <div className="space-y-4">
      <CollaborationTopNav active="chats" unreadCount={unreadCount} />
      <CollaborationChatClient
        actor={{ id: actor.id, role: actor.role, permissions: [...actor.permissions] }}
        conversations={conversations as any}
        selected={selected as any}
        messages={rawMessages.map(serializeMessage) as any}
        users={users}
        centers={centers}
        canCreate={actor.permissions.has("chat.create")}
        canSend={actor.permissions.has("chat.send")}
        canManage={!!canManage}
        canModerate={!!canModerate}
        canDownload={actor.permissions.has("files.download")}
        previewConfig={{ officePreviewEnabled: adminConfig.officePreviewEnabled, officePreviewMaxMb: adminConfig.officePreviewMaxMb }}
      />
    </div>
  );
}
