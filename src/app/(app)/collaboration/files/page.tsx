import { CollaborationFilesClient } from "@/components/collaboration/CollaborationFilesClient";
import { CollaborationTopNav } from "@/components/collaboration/CollaborationUi";
import { prisma } from "@/lib/db";
import { collaborationActor, listConversations, listFiles } from "@/lib/collaboration-service";

export const dynamic = "force-dynamic";

function serializeDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

function serializeFile(file: any) {
  return {
    id: file.id,
    originalName: file.originalName,
    displayName: file.displayName,
    description: file.description,
    mimeType: file.mimeType,
    size: file.size,
    accessLevel: file.accessLevel,
    scanStatus: file.scanStatus,
    currentVersion: file.currentVersion,
    ownerId: file.ownerId,
    folderId: file.folderId,
    conversationId: file.conversationId,
    department: file.department,
    centerId: file.centerId,
    patientId: file.patientId,
    deletedAt: serializeDate(file.deletedAt),
    createdAt: serializeDate(file.createdAt) || "",
    updatedAt: serializeDate(file.updatedAt) || "",
    owner: { fullName: file.owner.fullName },
    center: file.center ? { name: file.center.name } : null,
    folder: file.folder ? { name: file.folder.name } : null,
    patient: file.patient ? { fullName: file.patient.fullName, fileNumber: file.patient.fileNumber } : null,
    versions: (file.versions || []).map((version: any) => ({
      id: version.id,
      version: version.version,
      scanStatus: version.scanStatus,
      mimeType: version.mimeType,
      size: version.size,
      createdAt: serializeDate(version.createdAt) || "",
      scans: (version.scans || []).map((scan: any) => ({
        status: scan.status,
        detail: scan.detail,
        createdAt: serializeDate(scan.createdAt) || "",
      })),
    })),
    shares: (file.shares || []).map((share: any) => ({
      id: share.id,
      targetType: share.targetType,
      shareKey: share.shareKey,
      canEdit: share.canEdit,
      targetUserId: share.targetUserId,
      targetConversationId: share.targetConversationId,
      targetCenterId: share.targetCenterId,
      targetUser: share.targetUser ? { fullName: share.targetUser.fullName } : null,
      targetConversation: share.targetConversation ? { title: share.targetConversation.title } : null,
      targetCenter: share.targetCenter ? { name: share.targetCenter.name } : null,
      targetDepartment: share.targetDepartment,
    })),
    favorites: file.favorites || [],
    _count: file._count || { versions: 0, shares: 0 },
  };
}

export default async function CollaborationFilesPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; folder?: string }> }) {
  const actor = await collaborationActor("files.view");
  const params = await searchParams;
  const filter = params.filter || "all";
  const currentFolderId = params.folder || null;
  const [files, users, centers, conversations, folders, patients] = await Promise.all([
    listFiles(actor, filter, params.q || ""),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, username: true }, orderBy: { fullName: "asc" }, take: 200 }),
    prisma.center.findMany({ orderBy: { name: "asc" }, take: 100 }),
    listConversations(actor),
    prisma.folder.findMany({
      where: { ownerId: actor.id, deletedAt: null },
      select: { id: true, name: true, parentId: true, department: true, centerId: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.patient.findMany({ where: { archivedAt: null }, select: { id: true, fullName: true, fileNumber: true }, orderBy: { fullName: "asc" }, take: 200 }),
  ]);
  const canAdmin = actor.role === "ADMIN" || actor.permissions.has("files.admin");
  const totalBytes = files.reduce((sum, file: any) => sum + file.size, 0);
  const unreadCount = conversations.reduce((sum: number, conversation: any) => sum + (conversation.unreadCount || 0), 0);

  return (
    <div className="space-y-4">
      <CollaborationTopNav active="files" unreadCount={unreadCount} />
      <CollaborationFilesClient
        actor={{ id: actor.id, role: actor.role, department: actor.department, centerIds: actor.centerIds, permissions: [...actor.permissions] }}
        files={files.map(serializeFile) as any}
        folders={folders}
        users={users}
        centers={centers}
        conversations={conversations.map((conversation: any) => ({ id: conversation.id, title: conversation.title, type: conversation.type }))}
        patients={patients}
        filter={filter}
        currentFolderId={currentFolderId}
        totalBytes={totalBytes}
        canUpload={actor.permissions.has("files.upload")}
        canShare={actor.permissions.has("files.share")}
        canDownload={actor.permissions.has("files.download")}
        canEdit={actor.permissions.has("files.edit")}
        canDelete={actor.permissions.has("files.delete")}
        canRestore={actor.permissions.has("files.restore")}
        canPermanentDelete={actor.permissions.has("files.delete.permanent") || canAdmin}
        canAdmin={canAdmin}
      />
    </div>
  );
}
