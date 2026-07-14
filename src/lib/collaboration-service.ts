import { prisma } from "@/lib/db";
import { requireSession, loadPerms } from "@/lib/access";
import { notifyUserInTransaction } from "@/lib/notify";
import { putCollaborationObject, getCollaborationObject, collaborationStorageKey } from "@/lib/collaboration-storage";
import { scanBufferWithClamAv } from "@/lib/collaboration-scan";
import {
  type CollaborationActor,
  DEFAULT_ALLOWED_FILE_TYPES,
  DEFAULT_BLOCKED_FILE_TYPES,
  assertCanGrantFileAccess,
  canEditMessage,
  canModerateConversation,
  canUseCenter,
  canUseDepartment,
  directConversationKey,
  extensionOf,
  publicFileId,
  sanitizeFileName,
  assertMedicalFileShareAllowed,
  sha256,
  shareKey,
  validateCollaborationUpload,
} from "@/lib/collaboration-rules";

function asString(value: FormDataEntryValue | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function jsonArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : fallback;
}

export async function collaborationSettings() {
  const row = await prisma.collaborationSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return {
    ...row,
    allowedTypes: jsonArray(row.allowedTypes, DEFAULT_ALLOWED_FILE_TYPES),
    blockedTypes: jsonArray(row.blockedTypes, DEFAULT_BLOCKED_FILE_TYPES),
  };
}

export async function collaborationActor(required?: string): Promise<CollaborationActor> {
  const session = await requireSession();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) throw new Error("غير مصرّح");
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      department: true,
      isActive: true,
      centerMemberships: { where: { status: "ACTIVE" }, select: { centerId: true } },
    },
  });
  if (!dbUser?.isActive) throw new Error("المستخدم معطّل");
  const permissions = await loadPerms(dbUser.id, dbUser.role);
  if (required && !permissions.has(required)) throw new Error("لا تملك الصلاحية المطلوبة");
  return {
    id: dbUser.id,
    role: dbUser.role,
    department: dbUser.department,
    centerIds: dbUser.centerMemberships.map((m) => m.centerId),
    permissions,
  };
}

async function ensureWriteAllowed(actor: CollaborationActor) {
  const settings = await collaborationSettings();
  if (settings.servicePaused) throw new Error("مركز التعاون متوقف مؤقتاً");
  return settings;
}

function conversationAccessWhere(actor: CollaborationActor): any {
  if (actor.role === "ADMIN") return {};
  return {
    OR: [
      { members: { some: { userId: actor.id, status: "ACTIVE" } } },
      { type: "CHANNEL" as const, department: actor.department || "__none__" },
      { type: "CHANNEL" as const, centerId: { in: actor.centerIds.length ? actor.centerIds : [-1] } },
      { type: "CHANNEL" as const, department: null, centerId: null },
    ],
  };
}

async function conversationWithMembership(id: string, actor: CollaborationActor) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, ...conversationAccessWhere(actor), isArchived: false },
    include: {
      members: { include: { user: { select: { id: true, fullName: true, username: true, isActive: true } } }, orderBy: { joinedAt: "asc" } },
      center: { select: { id: true, name: true } },
    },
  } as any) as any;
  if (!conversation) throw new Error("المحادثة غير متاحة");
  const member = conversation.members.find((m) => m.userId === actor.id && m.status === "ACTIVE");
  return { conversation, member };
}

export async function collaborationUnreadCount(userId: string, role: any) {
  const permissions = await loadPerms(userId, role);
  if (!permissions.has("collaboration.view")) return 0;
  return prisma.message.count({
    where: {
      status: "ACTIVE",
      senderId: { not: userId },
      conversation: { members: { some: { userId, status: "ACTIVE", muted: false } } },
      reads: { none: { userId } },
    },
  });
}

export async function listConversations(actor: CollaborationActor) {
  const rows = await prisma.conversation.findMany({
    where: { ...conversationAccessWhere(actor), isArchived: false },
    include: {
      center: { select: { name: true } },
      members: { where: { status: "ACTIVE" }, include: { user: { select: { id: true, fullName: true } } }, take: 8 },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: { select: { fullName: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  } as any) as any[];
  const unread = await prisma.message.groupBy({
    by: ["conversationId"],
    where: {
      status: "ACTIVE",
      senderId: { not: actor.id },
      conversationId: { in: rows.map((r) => r.id) },
      reads: { none: { userId: actor.id } },
    },
    _count: { _all: true },
  });
  const unreadMap = new Map(unread.map((r) => [r.conversationId, r._count._all]));
  return rows.map((row) => ({ ...row, unreadCount: unreadMap.get(row.id) || 0 }));
}

export async function listMessages(actor: CollaborationActor, conversationId: string, cursor?: string | null) {
  await conversationWithMembership(conversationId, actor);
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    include: {
      sender: { select: { id: true, fullName: true } },
      replyTo: { select: { id: true, body: true, sender: { select: { fullName: true } } } },
      attachmentFile: { select: { id: true, publicId: true, displayName: true, mimeType: true, size: true, scanStatus: true } },
      mentions: { include: { user: { select: { id: true, fullName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  await prisma.messageRead.createMany({
    data: rows.filter((message) => message.senderId !== actor.id).map((message) => ({ messageId: message.id, userId: actor.id })),
    skipDuplicates: true,
  });
  return rows.reverse();
}

export async function createDirectConversation(targetUserId: string) {
  const actor = await collaborationActor("chat.create");
  const settings = await ensureWriteAllowed(actor);
  void settings;
  if (targetUserId === actor.id) throw new Error("لا يمكن إنشاء محادثة مباشرة مع نفسك");
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, fullName: true, isActive: true } });
  if (!target?.isActive) throw new Error("المستخدم غير متاح");
  const key = directConversationKey(actor.id, target.id);
  const conversation = await prisma.$transaction(async (tx) => {
    const existing = await tx.conversation.findUnique({ where: { directKey: key } });
    if (existing) return existing;
    const created = await tx.conversation.create({
      data: {
        type: "DIRECT",
        title: null,
        directKey: key,
        createdById: actor.id,
        updatedAt: new Date(),
        members: {
          create: [
            { userId: actor.id, role: "OWNER" },
            { userId: target.id, role: "MEMBER" },
          ],
        },
      },
    });
    await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", tableName: "collaboration_conversations", recordId: created.id, newValue: { type: "DIRECT", targetUserId } } });
    return created;
  });
  return conversation.id;
}

export async function createGroupConversation(formData: FormData) {
  const actor = await collaborationActor("chat.create");
  await ensureWriteAllowed(actor);
  const title = asString(formData.get("title"));
  if (!title) throw new Error("اسم المجموعة مطلوب");
  const memberIds = formData.getAll("memberIds").map(String).filter((id) => id && id !== actor.id).slice(0, 100);
  const conversation = await prisma.$transaction(async (tx) => {
    const created = await tx.conversation.create({
      data: {
        type: "GROUP",
        title,
        description: asString(formData.get("description")) || null,
        createdById: actor.id,
        updatedAt: new Date(),
        members: {
          create: [
            { userId: actor.id, role: "OWNER" },
            ...memberIds.map((userId) => ({ userId, role: "MEMBER" as const })),
          ],
        },
      },
    });
    await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", tableName: "collaboration_conversations", recordId: created.id, newValue: { type: "GROUP", title, members: memberIds.length + 1 } } });
    for (const userId of memberIds) await notifyUserInTransaction(tx, userId, "أُضيفت إلى مجموعة تعاون", { body: title, link: `/collaboration?conversation=${created.id}` });
    return created;
  });
  return conversation.id;
}

export async function createChannelConversation(formData: FormData) {
  const actor = await collaborationActor("chat.manage.members");
  await ensureWriteAllowed(actor);
  const title = asString(formData.get("title"));
  if (!title) throw new Error("اسم القناة مطلوب");
  const department = asString(formData.get("department")) || null;
  const centerIdRaw = Number(formData.get("centerId") || 0);
  const centerId = Number.isInteger(centerIdRaw) && centerIdRaw > 0 ? centerIdRaw : null;
  if (!canUseDepartment(actor, department) || !canUseCenter(actor, centerId)) throw new Error("لا يمكنك إنشاء قناة خارج نطاقك");
  const conversation = await prisma.conversation.create({
    data: { type: "CHANNEL", title, description: asString(formData.get("description")) || null, department, centerId, isSystemChannel: true, createdById: actor.id, updatedAt: new Date(), members: { create: { userId: actor.id, role: "OWNER" } } },
  });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "CREATE", tableName: "collaboration_conversations", recordId: conversation.id, newValue: { type: "CHANNEL", title, department, centerId } } });
  return conversation.id;
}

export async function sendConversationMessage(conversationId: string, formData: FormData) {
  const actor = await collaborationActor("chat.send");
  const settings = await ensureWriteAllowed(actor);
  const { conversation, member } = await conversationWithMembership(conversationId, actor);
  if (!member && actor.role !== "ADMIN") throw new Error("أنت لست عضواً في المحادثة");
  const body = asString(formData.get("body")).slice(0, 5000);
  const replyToId = asString(formData.get("replyToId")) || null;
  const attachmentFileId = asString(formData.get("attachmentFileId")) || null;
  if (!body && !attachmentFileId) throw new Error("اكتب رسالة أو أرفق ملفاً");
  if (attachmentFileId) await assertFileAccess(actor, attachmentFileId, "files.view");
  const mentionedUsernames = Array.from(new Set(Array.from(body.matchAll(/@([A-Za-z0-9_.-]{2,40})/g)).map((m) => m[1])));
  const mentionedUsers = mentionedUsernames.length
    ? await prisma.user.findMany({ where: { username: { in: mentionedUsernames }, isActive: true }, select: { id: true } })
    : [];
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        senderId: actor.id,
        body: body || null,
        replyToId,
        attachmentFileId,
        updatedAt: new Date(),
        mentions: { create: mentionedUsers.map((user) => ({ userId: user.id })) },
      },
    });
    await tx.messageRead.create({ data: { messageId: created.id, userId: actor.id } });
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", tableName: "collaboration_messages", recordId: created.id, newValue: { conversationId, attachmentFileId: attachmentFileId || null } } });
    const recipients = conversation.members.filter((m) => m.userId !== actor.id && m.status === "ACTIVE" && !m.muted).map((m) => m.userId);
    for (const userId of new Set([...recipients, ...mentionedUsers.map((u) => u.id)])) {
      await notifyUserInTransaction(tx, userId, mentionedUsers.some((u) => u.id === userId) ? "تمت الإشارة إليك" : "رسالة تعاون جديدة", {
        body: conversation.title || "محادثة مباشرة",
        link: `/collaboration?conversation=${conversationId}`,
      });
    }
    return created;
  });
  void settings;
  return message.id;
}

export async function editMessage(messageId: string, formData: FormData) {
  const actor = await collaborationActor("chat.send");
  const settings = await ensureWriteAllowed(actor);
  const body = asString(formData.get("body")).slice(0, 5000);
  if (!body) throw new Error("نص الرسالة مطلوب");
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { members: true } } } });
  if (!message || message.status !== "ACTIVE") throw new Error("الرسالة غير متاحة");
  const member = message.conversation.members.find((m) => m.userId === actor.id && m.status === "ACTIVE");
  if (!canEditMessage({ actor, senderId: message.senderId, createdAt: message.createdAt, editWindowMinutes: settings.editWindowMinutes, memberRole: member?.role })) throw new Error("انتهت مدة تعديل الرسالة");
  await prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: messageId }, data: { body, editedAt: new Date() } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_messages", recordId: messageId, oldValue: { body: message.body }, newValue: { body } } });
  });
}

export async function deleteMessageSoft(messageId: string) {
  const actor = await collaborationActor("chat.send");
  const settings = await ensureWriteAllowed(actor);
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { members: true } } } });
  if (!message || message.status === "DELETED") return;
  const member = message.conversation.members.find((m) => m.userId === actor.id && m.status === "ACTIVE");
  if (!canEditMessage({ actor, senderId: message.senderId, createdAt: message.createdAt, editWindowMinutes: settings.editWindowMinutes, memberRole: member?.role })) throw new Error("لا يمكن حذف الرسالة بعد انتهاء المدة");
  await prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: messageId }, data: { status: "DELETED", deletedAt: new Date(), body: null, attachmentFileId: null } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "DELETE", tableName: "collaboration_messages", recordId: messageId, oldValue: { status: message.status }, newValue: { softDeleted: true } } });
  });
}

export async function setMessagePinned(messageId: string, pinned: boolean) {
  const actor = await collaborationActor("chat.moderate");
  await ensureWriteAllowed(actor);
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { members: true } } } });
  if (!message) throw new Error("الرسالة غير موجودة");
  const member = message.conversation.members.find((m) => m.userId === actor.id);
  if (!canModerateConversation(actor, member?.role)) throw new Error("لا تملك صلاحية التثبيت");
  await prisma.message.update({ where: { id: messageId }, data: { pinned } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_messages", recordId: messageId, newValue: { pinned } } });
}

export async function updateConversationMember(conversationId: string, targetUserId: string, action: "ADD" | "REMOVE" | "LEAVE" | "MUTE" | "UNMUTE" | "PROMOTE" | "DEMOTE") {
  const actor = await collaborationActor("collaboration.view");
  await ensureWriteAllowed(actor);
  const { conversation, member } = await conversationWithMembership(conversationId, actor);
  if (action === "LEAVE" && actor.id === targetUserId) {
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: actor.id } }, data: { status: "LEFT", leftAt: new Date() } });
    return;
  }
  if ((action === "MUTE" || action === "UNMUTE") && actor.id === targetUserId) {
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: actor.id } }, data: { muted: action === "MUTE" } });
    return;
  }
  if (!canModerateConversation(actor, member?.role)) throw new Error("لا تملك صلاحية إدارة الأعضاء");
  const data = action === "ADD"
    ? { status: "ACTIVE" as const, leftAt: null }
    : action === "REMOVE"
      ? { status: "REMOVED" as const, leftAt: new Date() }
      : action === "PROMOTE"
        ? { role: "MODERATOR" as const }
        : { role: "MEMBER" as const };
  await prisma.$transaction(async (tx) => {
    if (action === "ADD") {
      await tx.conversationMember.upsert({ where: { conversationId_userId: { conversationId, userId: targetUserId } }, update: data, create: { conversationId, userId: targetUserId, role: "MEMBER" } });
      await notifyUserInTransaction(tx, targetUserId, "أُضيفت إلى محادثة تعاون", { body: conversation.title || "محادثة", link: `/collaboration?conversation=${conversationId}` });
    } else {
      await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: targetUserId } }, data });
    }
    await tx.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_conversation_members", recordId: `${conversationId}:${targetUserId}`, newValue: { action } } });
  });
}

function fileAccessWhere(actor: CollaborationActor): any {
  if (actor.role === "ADMIN") return {};
  return {
    OR: [
      { ownerId: actor.id },
      { uploadedById: actor.id },
      { accessLevel: "ALL_STAFF" as const },
      { accessLevel: "DEPARTMENT" as const, department: actor.department || "__none__" },
      { accessLevel: "CENTER" as const, centerId: { in: actor.centerIds.length ? actor.centerIds : [-1] } },
      { conversation: { is: { members: { some: { userId: actor.id, status: "ACTIVE" } } } } },
      {
        shares: {
          some: {
            revokedAt: null,
            OR: [
              { targetUserId: actor.id },
              { targetType: "ALL_STAFF" as const },
              { targetDepartment: actor.department || "__none__" },
              { targetCenterId: { in: actor.centerIds.length ? actor.centerIds : [-1] } },
              { targetConversation: { is: { members: { some: { userId: actor.id, status: "ACTIVE" } } } } },
            ],
          },
        },
      },
    ],
  };
}

export async function assertFileAccess(actor: CollaborationActor, fileId: string, permission: string) {
  if (!actor.permissions.has(permission)) throw new Error("لا تملك صلاحية الملفات المطلوبة");
  const file = await prisma.collaborationFile.findFirst({
    where: { id: fileId, deletedAt: null, permanentlyDeletedAt: null, ...fileAccessWhere(actor) },
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, shares: true },
  } as any) as any;
  if (!file) throw new Error("الملف غير متاح");
  return file;
}

export async function uploadCollaborationFileFromFile(file: File, formData: FormData) {
  const actor = await collaborationActor("files.upload");
  const settings = await ensureWriteAllowed(actor);
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateCollaborationUpload({ name: file.name, size: file.size, buffer, declaredType: file.type, settings });
  const accessLevel = (asString(formData.get("accessLevel")) || "PRIVATE") as any;
  const folderId = asString(formData.get("folderId")) || null;
  const conversationId = asString(formData.get("conversationId")) || null;
  const department = asString(formData.get("department")) || null;
  const centerIdRaw = Number(formData.get("centerId") || 0);
  const centerId = Number.isInteger(centerIdRaw) && centerIdRaw > 0 ? centerIdRaw : null;
  assertCanGrantFileAccess(actor, { centerId, department, allStaff: accessLevel === "ALL_STAFF" });
  if (conversationId) await conversationWithMembership(conversationId, actor);
  const used = await prisma.collaborationFile.aggregate({ where: { ownerId: actor.id, deletedAt: null, permanentlyDeletedAt: null, scanStatus: { not: "REJECTED" } }, _sum: { size: true } });
  if ((used._sum.size || 0) + file.size > settings.userQuotaMb * 1024 * 1024 && actor.role !== "ADMIN") throw new Error("تجاوزت حصة التخزين الشخصية");
  if (department && actor.role !== "ADMIN") {
    const deptUsed = await prisma.collaborationFile.aggregate({ where: { department, deletedAt: null, permanentlyDeletedAt: null, scanStatus: { not: "REJECTED" } }, _sum: { size: true } });
    if ((deptUsed._sum.size || 0) + file.size > settings.departmentQuotaMb * 1024 * 1024) throw new Error("تجاوزت حصة تخزين القسم");
  }
  if (centerId && actor.role !== "ADMIN") {
    const centerUsed = await prisma.collaborationFile.aggregate({ where: { centerId, deletedAt: null, permanentlyDeletedAt: null, scanStatus: { not: "REJECTED" } }, _sum: { size: true } });
    if ((centerUsed._sum.size || 0) + file.size > settings.centerQuotaMb * 1024 * 1024) throw new Error("تجاوزت حصة تخزين المركز");
  }
  const publicId = publicFileId();
  const storageKey = collaborationStorageKey(publicId, 1, validation.extension);
  const hash = sha256(buffer);
  await putCollaborationObject(storageKey, buffer, { mimeType: validation.mimeType, originalName: validation.safeName });
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.collaborationFile.create({
      data: {
        publicId,
        originalName: validation.safeName,
        displayName: asString(formData.get("displayName")) || validation.safeName,
        description: asString(formData.get("description")) || null,
        mimeType: validation.mimeType,
        size: file.size,
        sha256: hash,
        ownerId: actor.id,
        uploadedById: actor.id,
        accessLevel,
        folderId,
        conversationId,
        department: department || null,
        centerId,
        versions: { create: { version: 1, storageKey, mimeType: validation.mimeType, size: file.size, sha256: hash, uploadedById: actor.id } },
      },
      include: { versions: true },
    });
    await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", tableName: "collaboration_files", recordId: row.id, newValue: { name: row.displayName, scanStatus: "PENDING_SCAN" } } });
    return row;
  });
  const scan = await scanBufferWithClamAv(buffer);
  await prisma.$transaction(async (tx) => {
    await tx.fileScan.create({ data: { versionId: created.versions[0].id, status: scan.status, engine: scan.engine, detail: scan.detail.slice(0, 500), requestedById: actor.id, scannedAt: new Date() } });
    await tx.fileVersion.update({ where: { id: created.versions[0].id }, data: { scanStatus: scan.status } });
    await tx.collaborationFile.update({ where: { id: created.id }, data: { scanStatus: scan.status } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_file_scans", recordId: created.versions[0].id, newValue: { status: scan.status } } });
    if (scan.status !== "SAFE") await notifyUserInTransaction(tx, actor.id, scan.status === "REJECTED" ? "رُفض ملف تعاون" : "فشل فحص ملف تعاون", { body: created.displayName, link: "/collaboration/files?filter=quarantine" });
  });
  return created.id;
}

export async function listFiles(actor: CollaborationActor, filter = "all", query = "") {
  const baseWhere: any = filter === "trash"
    ? { deletedAt: { not: null }, permanentlyDeletedAt: null }
    : { deletedAt: null, permanentlyDeletedAt: null };
  const where: any = {
    ...baseWhere,
    ...fileAccessWhere(actor),
    ...(query ? { OR: [{ displayName: { contains: query, mode: "insensitive" } }, { originalName: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] } : {}),
  };
  if (filter === "mine") where.ownerId = actor.id;
  if (filter === "shared") where.ownerId = { not: actor.id };
  if (filter === "favorites") where.favorites = { some: { userId: actor.id } };
  if (filter === "quarantine") where.scanStatus = { in: ["PENDING_SCAN", "REJECTED", "FAILED"] };
  return prisma.collaborationFile.findMany({
    where,
    include: {
      owner: { select: { fullName: true } },
      center: { select: { name: true } },
      folder: { select: { name: true } },
      versions: { orderBy: { version: "desc" }, take: 5, include: { scans: { orderBy: { createdAt: "desc" }, take: 1 } } },
      shares: { where: { revokedAt: null }, include: { targetUser: { select: { fullName: true } }, targetConversation: { select: { title: true } }, targetCenter: { select: { name: true } } }, take: 10 },
      favorites: { where: { userId: actor.id }, select: { id: true } },
      _count: { select: { versions: true, shares: true } },
    },
    orderBy: filter === "recent" ? { updatedAt: "desc" } : { createdAt: "desc" },
    take: 80,
  });
}

export async function readCollaborationFile(fileId: string, versionNumber?: number) {
  const actor = await collaborationActor("files.download");
  const file = await assertFileAccess(actor, fileId, "files.download");
  if (file.scanStatus !== "SAFE") throw new Error("لا يمكن تنزيل الملف قبل نجاح الفحص");
  const version = versionNumber
    ? await prisma.fileVersion.findFirst({ where: { fileId: file.id, version: versionNumber, scanStatus: "SAFE" } })
    : file.versions[0];
  if (!version || version.scanStatus !== "SAFE") throw new Error("الإصدار غير متاح للتنزيل");
  const buffer = await getCollaborationObject(version.storageKey);
  if (!buffer) throw new Error("تعذر قراءة الملف من التخزين");
  await prisma.auditLog.create({ data: { userId: actor.id, action: "READ", tableName: "collaboration_files", recordId: file.id, newValue: { version: version.version } } }).catch(() => {});
  return { file, version, buffer };
}

export async function updateFileMetadata(fileId: string, formData: FormData) {
  const actor = await collaborationActor("files.edit");
  await ensureWriteAllowed(actor);
  const file = await assertFileAccess(actor, fileId, "files.edit");
  if (actor.id !== file.ownerId && actor.role !== "ADMIN" && !actor.permissions.has("files.admin")) throw new Error("لا يمكنك تعديل هذا الملف");
  const data = {
    displayName: asString(formData.get("displayName")) || file.displayName,
    description: asString(formData.get("description")) || null,
    folderId: asString(formData.get("folderId")) || null,
    updatedById: actor.id,
  };
  await prisma.$transaction(async (tx) => {
    await tx.collaborationFile.update({ where: { id: fileId }, data });
    await tx.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_files", recordId: fileId, oldValue: { displayName: file.displayName }, newValue: data } });
  });
}

export async function uploadNewFileVersion(fileId: string, file: File) {
  const actor = await collaborationActor("files.edit");
  const settings = await ensureWriteAllowed(actor);
  const current = await assertFileAccess(actor, fileId, "files.edit");
  if (actor.id !== current.ownerId && actor.role !== "ADMIN" && !actor.permissions.has("files.admin")) throw new Error("لا يمكنك رفع إصدار لهذا الملف");
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateCollaborationUpload({ name: file.name, size: file.size, buffer, declaredType: file.type, settings });
  const nextVersion = current.currentVersion + 1;
  const storageKey = collaborationStorageKey(current.publicId, nextVersion, validation.extension);
  const hash = sha256(buffer);
  await putCollaborationObject(storageKey, buffer, { mimeType: validation.mimeType, originalName: validation.safeName });
  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.fileVersion.create({ data: { fileId, version: nextVersion, storageKey, mimeType: validation.mimeType, size: file.size, sha256: hash, uploadedById: actor.id } });
    await tx.collaborationFile.update({ where: { id: fileId }, data: { currentVersion: nextVersion, mimeType: validation.mimeType, size: file.size, sha256: hash, scanStatus: "PENDING_SCAN", updatedById: actor.id } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", tableName: "collaboration_file_versions", recordId: created.id, newValue: { fileId, version: nextVersion } } });
    return created;
  });
  const scan = await scanBufferWithClamAv(buffer);
  await prisma.$transaction(async (tx) => {
    await tx.fileScan.create({ data: { versionId: version.id, status: scan.status, engine: scan.engine, detail: scan.detail.slice(0, 500), requestedById: actor.id, scannedAt: new Date() } });
    await tx.fileVersion.update({ where: { id: version.id }, data: { scanStatus: scan.status } });
    await tx.collaborationFile.update({ where: { id: fileId }, data: { scanStatus: scan.status } });
  });
}

export async function shareFile(fileId: string, formData: FormData) {
  const actor = await collaborationActor("files.share");
  await ensureWriteAllowed(actor);
  const file = await assertFileAccess(actor, fileId, "files.share");
  if (file.scanStatus !== "SAFE") throw new Error("لا يمكن مشاركة ملف قبل نجاح الفحص");
  const type = asString(formData.get("targetType")) as "USER" | "CONVERSATION" | "DEPARTMENT" | "CENTER" | "ALL_STAFF";
  const targetUserId = asString(formData.get("targetUserId")) || null;
  const targetConversationId = asString(formData.get("targetConversationId")) || null;
  const targetDepartment = asString(formData.get("targetDepartment")) || null;
  const centerRaw = Number(formData.get("targetCenterId") || 0);
  const targetCenterId = Number.isInteger(centerRaw) && centerRaw > 0 ? centerRaw : null;
  assertCanGrantFileAccess(actor, { centerId: targetCenterId, department: targetDepartment, allStaff: type === "ALL_STAFF" });
  if (file.patientId && (type === "ALL_STAFF" || type === "DEPARTMENT" || type === "CENTER")) {
    assertMedicalFileShareAllowed({ patientId: file.patientId, targetType: type, allRecipientsCanViewPatient: false });
  }
  if (file.patientId && targetUserId) {
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true, isActive: true } });
    const perms = target?.isActive ? await loadPerms(target.id, target.role) : new Set<string>();
    assertMedicalFileShareAllowed({ patientId: file.patientId, targetType: type, allRecipientsCanViewPatient: perms.has("patients.view") });
  }
  if (file.patientId && targetConversationId) {
    const members = await prisma.conversationMember.findMany({ where: { conversationId: targetConversationId, status: "ACTIVE" }, include: { user: { select: { id: true, role: true, isActive: true } } } });
    for (const member of members) {
      const perms = member.user.isActive ? await loadPerms(member.user.id, member.user.role) : new Set<string>();
      assertMedicalFileShareAllowed({ patientId: file.patientId, targetType: type, allRecipientsCanViewPatient: perms.has("patients.view") });
    }
  }
  const key = shareKey({ type, userId: targetUserId, conversationId: targetConversationId, department: targetDepartment, centerId: targetCenterId });
  await prisma.$transaction(async (tx) => {
    const share = await tx.fileShare.upsert({
      where: { fileId_shareKey: { fileId, shareKey: key } },
      update: { revokedAt: null, canEdit: formData.get("canEdit") === "on" },
      create: { fileId, targetType: type, targetUserId, targetConversationId, targetDepartment, targetCenterId, shareKey: key, canEdit: formData.get("canEdit") === "on", createdById: actor.id },
    });
    await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", tableName: "collaboration_file_shares", recordId: share.id, newValue: { fileId, target: key } } });
    if (targetUserId && targetUserId !== actor.id) await notifyUserInTransaction(tx, targetUserId, "مشاركة ملف تعاون", { body: file.displayName, link: "/collaboration/files?filter=shared" });
  });
}

export async function revokeFileShare(shareId: string) {
  const actor = await collaborationActor("files.share");
  await ensureWriteAllowed(actor);
  const share = await prisma.fileShare.findUnique({ where: { id: shareId }, include: { file: true } });
  if (!share) return;
  if (share.file.ownerId !== actor.id && actor.role !== "ADMIN" && !actor.permissions.has("files.admin")) throw new Error("لا يمكنك إلغاء هذه المشاركة");
  await prisma.fileShare.update({ where: { id: shareId }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_file_shares", recordId: shareId, newValue: { revoked: true } } });
}

export async function softDeleteFile(fileId: string) {
  const actor = await collaborationActor("files.delete");
  await ensureWriteAllowed(actor);
  const file = await assertFileAccess(actor, fileId, "files.delete");
  if (file.ownerId !== actor.id && actor.role !== "ADMIN" && !actor.permissions.has("files.admin")) throw new Error("لا يمكنك حذف هذا الملف");
  await prisma.collaborationFile.update({ where: { id: fileId }, data: { deletedAt: new Date(), deletedById: actor.id } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "DELETE", tableName: "collaboration_files", recordId: fileId, newValue: { softDeleted: true } } });
}

export async function restoreFile(fileId: string) {
  const actor = await collaborationActor("files.restore");
  await ensureWriteAllowed(actor);
  const file = await prisma.collaborationFile.findFirst({ where: { id: fileId, permanentlyDeletedAt: null, ...fileAccessWhere(actor) } } as any);
  if (!file) throw new Error("الملف غير متاح");
  await prisma.collaborationFile.update({ where: { id: fileId }, data: { deletedAt: null, deletedById: null } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_files", recordId: fileId, newValue: { restored: true } } });
}

export async function permanentDeleteFile(fileId: string) {
  const actor = await collaborationActor("files.delete.permanent");
  await ensureWriteAllowed(actor);
  if (actor.role !== "ADMIN" && !actor.permissions.has("files.admin")) throw new Error("الحذف النهائي للأدمن فقط");
  await prisma.collaborationFile.update({ where: { id: fileId }, data: { permanentlyDeletedAt: new Date(), deletedAt: new Date(), deletedById: actor.id } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "DELETE", tableName: "collaboration_files", recordId: fileId, newValue: { permanent: true } } });
}

export async function toggleFavorite(fileId: string) {
  const actor = await collaborationActor("files.view");
  await assertFileAccess(actor, fileId, "files.view");
  const existing = await prisma.favorite.findUnique({ where: { fileId_userId: { fileId, userId: actor.id } } });
  if (existing) await prisma.favorite.delete({ where: { id: existing.id } });
  else await prisma.favorite.create({ data: { fileId, userId: actor.id } });
}

export async function transferFileOwner(fileId: string, newOwnerId: string) {
  const actor = await collaborationActor("files.admin");
  await ensureWriteAllowed(actor);
  const user = await prisma.user.findUnique({ where: { id: newOwnerId }, select: { id: true } });
  if (!user) throw new Error("المستخدم الجديد غير موجود");
  await prisma.collaborationFile.update({ where: { id: fileId }, data: { ownerId: newOwnerId, updatedById: actor.id } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_files", recordId: fileId, newValue: { ownerId: newOwnerId } } });
}

export async function linkFileToPatient(fileId: string, patientId: string) {
  const actor = await collaborationActor("files.edit");
  await ensureWriteAllowed(actor);
  if (!actor.permissions.has("patients.view") && !actor.permissions.has("clinical.report")) throw new Error("لا تملك صلاحية ربط الملف بمراجع");
  const file = await assertFileAccess(actor, fileId, "files.edit");
  if (file.scanStatus !== "SAFE") throw new Error("لا يمكن ربط ملف قبل نجاح الفحص");
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (!patient) throw new Error("المراجع غير موجود");
  await prisma.collaborationFile.update({ where: { id: fileId }, data: { patientId, linkedToPatientAt: new Date(), linkedToPatientById: actor.id } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_files", recordId: fileId, newValue: { patientId, linkedToPatient: true } } });
}

export async function createFolder(formData: FormData) {
  const actor = await collaborationActor("files.upload");
  await ensureWriteAllowed(actor);
  const name = sanitizeFileName(asString(formData.get("name")));
  const parentId = asString(formData.get("parentId")) || null;
  const centerRaw = Number(formData.get("centerId") || 0);
  const centerId = Number.isInteger(centerRaw) && centerRaw > 0 ? centerRaw : null;
  const department = asString(formData.get("department")) || null;
  assertCanGrantFileAccess(actor, { centerId, department });
  const folder = await prisma.folder.create({ data: { name, ownerId: actor.id, parentId, centerId, department, description: asString(formData.get("description")) || null } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "CREATE", tableName: "collaboration_folders", recordId: folder.id, newValue: { name } } });
}

export async function updateCollaborationSettings(formData: FormData) {
  const actor = await collaborationActor("files.admin");
  const allowedTypes = asString(formData.get("allowedTypes")).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const blockedTypes = asString(formData.get("blockedTypes")).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const intValue = (key: string, min: number, max: number, fallback: number) => {
    const value = Number(formData.get(key));
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  };
  const old = await prisma.collaborationSettings.findUnique({ where: { id: 1 } });
  const data = {
    servicePaused: formData.get("servicePaused") === "on",
    maxUploadMb: intValue("maxUploadMb", 1, 500, old?.maxUploadMb || 50),
    allowedTypes: allowedTypes.length ? allowedTypes : DEFAULT_ALLOWED_FILE_TYPES,
    blockedTypes: blockedTypes.length ? blockedTypes : DEFAULT_BLOCKED_FILE_TYPES,
    editWindowMinutes: intValue("editWindowMinutes", 1, 1440, old?.editWindowMinutes || 15),
    messageRetentionDays: intValue("messageRetentionDays", 1, 3650, old?.messageRetentionDays || 365),
    trashRetentionDays: intValue("trashRetentionDays", 1, 365, old?.trashRetentionDays || 30),
    userQuotaMb: intValue("userQuotaMb", 1, 102400, old?.userQuotaMb || 1024),
    departmentQuotaMb: intValue("departmentQuotaMb", 1, 1024000, old?.departmentQuotaMb || 10240),
    centerQuotaMb: intValue("centerQuotaMb", 1, 1024000, old?.centerQuotaMb || 20480),
  };
  await prisma.collaborationSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  await prisma.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_settings", recordId: "1", oldValue: old as any, newValue: data } });
}

export async function rescanFileVersion(versionId: string) {
  const actor = await collaborationActor("files.admin");
  await ensureWriteAllowed(actor);
  const version = await prisma.fileVersion.findUnique({ where: { id: versionId }, include: { file: true } });
  if (!version) throw new Error("الإصدار غير موجود");
  const buffer = await getCollaborationObject(version.storageKey);
  if (!buffer) throw new Error("تعذر قراءة الملف من التخزين");
  const scan = await scanBufferWithClamAv(buffer);
  await prisma.$transaction(async (tx) => {
    await tx.fileScan.create({ data: { versionId, status: scan.status, engine: scan.engine, detail: scan.detail.slice(0, 500), requestedById: actor.id, scannedAt: new Date() } });
    await tx.fileVersion.update({ where: { id: versionId }, data: { scanStatus: scan.status } });
    if (version.version === version.file.currentVersion) await tx.collaborationFile.update({ where: { id: version.fileId }, data: { scanStatus: scan.status } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "UPDATE", tableName: "collaboration_file_scans", recordId: versionId, newValue: { status: scan.status } } });
  });
}

export async function adminStats() {
  const [files, messages, used, pending, rejected, audit] = await Promise.all([
    prisma.collaborationFile.count({ where: { permanentlyDeletedAt: null } }),
    prisma.message.count(),
    prisma.collaborationFile.aggregate({ where: { deletedAt: null, permanentlyDeletedAt: null }, _sum: { size: true } }),
    prisma.collaborationFile.count({ where: { scanStatus: "PENDING_SCAN" } }),
    prisma.collaborationFile.count({ where: { scanStatus: { in: ["REJECTED", "FAILED"] } } }),
    prisma.auditLog.findMany({ where: { tableName: { startsWith: "collaboration_" } }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { fullName: true } } } }),
  ]);
  return { files, messages, usedBytes: used._sum.size || 0, pending, rejected, audit };
}
