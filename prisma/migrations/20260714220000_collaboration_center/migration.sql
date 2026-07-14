CREATE TYPE "ConversationType" AS ENUM ('DIRECT', 'GROUP', 'CHANNEL');
CREATE TYPE "ConversationMemberRole" AS ENUM ('OWNER', 'MODERATOR', 'MEMBER');
CREATE TYPE "ConversationMemberStatus" AS ENUM ('ACTIVE', 'LEFT', 'REMOVED');
CREATE TYPE "MessageStatus" AS ENUM ('ACTIVE', 'DELETED');
CREATE TYPE "CollaborationFileAccessLevel" AS ENUM ('PRIVATE', 'SPECIFIC_USERS', 'CONVERSATION', 'DEPARTMENT', 'CENTER', 'ALL_STAFF');
CREATE TYPE "FileShareTargetType" AS ENUM ('USER', 'CONVERSATION', 'DEPARTMENT', 'CENTER', 'ALL_STAFF');
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING_SCAN', 'SAFE', 'REJECTED', 'FAILED');
CREATE TYPE "CollaborationQuotaTarget" AS ENUM ('USER', 'DEPARTMENT', 'CENTER');

CREATE TABLE "collaboration_conversations" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "directKey" TEXT,
    "department" TEXT,
    "centerId" INTEGER,
    "isSystemChannel" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_conversation_members" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ConversationMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "ConversationMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    CONSTRAINT "collaboration_conversation_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT,
    "attachmentFileId" TEXT,
    "replyToId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'ACTIVE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_message_reads" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collaboration_message_reads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_message_mentions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collaboration_message_mentions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_folders" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "department" TEXT,
    "centerId" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_files" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "accessLevel" "CollaborationFileAccessLevel" NOT NULL DEFAULT 'PRIVATE',
    "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING_SCAN',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "ownerId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedById" TEXT,
    "folderId" TEXT,
    "conversationId" TEXT,
    "department" TEXT,
    "centerId" INTEGER,
    "patientId" TEXT,
    "linkedToPatientAt" TIMESTAMP(3),
    "linkedToPatientById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "permanentlyDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_file_versions" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING_SCAN',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collaboration_file_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_file_shares" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "targetType" "FileShareTargetType" NOT NULL,
    "targetUserId" TEXT,
    "targetConversationId" TEXT,
    "targetDepartment" TEXT,
    "targetCenterId" INTEGER,
    "shareKey" TEXT NOT NULL,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "collaboration_file_shares_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_file_favorites" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collaboration_file_favorites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_file_scans" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "FileScanStatus" NOT NULL,
    "engine" TEXT NOT NULL,
    "detail" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedAt" TIMESTAMP(3),
    CONSTRAINT "collaboration_file_scans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "servicePaused" BOOLEAN NOT NULL DEFAULT false,
    "maxUploadMb" INTEGER NOT NULL DEFAULT 50,
    "allowedTypes" JSONB NOT NULL DEFAULT '["pdf","jpg","jpeg","png","webp","doc","docx","xls","xlsx","ppt","pptx","txt","zip","rar","mp3","wav","mp4","mov"]',
    "blockedTypes" JSONB NOT NULL DEFAULT '["exe","msi","bat","cmd","com","ps1","sh","js","jar","scr","dll"]',
    "editWindowMinutes" INTEGER NOT NULL DEFAULT 15,
    "messageRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "trashRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "userQuotaMb" INTEGER NOT NULL DEFAULT 1024,
    "departmentQuotaMb" INTEGER NOT NULL DEFAULT 10240,
    "centerQuotaMb" INTEGER NOT NULL DEFAULT 20480,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_quotas" (
    "id" TEXT NOT NULL,
    "targetType" "CollaborationQuotaTarget" NOT NULL,
    "targetUserId" TEXT,
    "targetDepartment" TEXT,
    "targetCenterId" INTEGER,
    "quotaKey" TEXT NOT NULL,
    "limitMb" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collaboration_quotas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collaboration_conversations_directKey_key" ON "collaboration_conversations"("directKey");
CREATE INDEX "collaboration_conversations_type_updatedAt_idx" ON "collaboration_conversations"("type", "updatedAt");
CREATE INDEX "collaboration_conversations_centerId_idx" ON "collaboration_conversations"("centerId");
CREATE INDEX "collaboration_conversations_department_idx" ON "collaboration_conversations"("department");
CREATE UNIQUE INDEX "collaboration_conversation_members_conversationId_userId_key" ON "collaboration_conversation_members"("conversationId", "userId");
CREATE INDEX "collaboration_conversation_members_userId_status_idx" ON "collaboration_conversation_members"("userId", "status");
CREATE INDEX "collaboration_conversation_members_conversationId_status_idx" ON "collaboration_conversation_members"("conversationId", "status");
CREATE INDEX "collaboration_messages_conversationId_createdAt_idx" ON "collaboration_messages"("conversationId", "createdAt");
CREATE INDEX "collaboration_messages_senderId_createdAt_idx" ON "collaboration_messages"("senderId", "createdAt");
CREATE INDEX "collaboration_messages_conversationId_pinned_idx" ON "collaboration_messages"("conversationId", "pinned");
CREATE UNIQUE INDEX "collaboration_message_reads_messageId_userId_key" ON "collaboration_message_reads"("messageId", "userId");
CREATE INDEX "collaboration_message_reads_userId_readAt_idx" ON "collaboration_message_reads"("userId", "readAt");
CREATE UNIQUE INDEX "collaboration_message_mentions_messageId_userId_key" ON "collaboration_message_mentions"("messageId", "userId");
CREATE INDEX "collaboration_message_mentions_userId_createdAt_idx" ON "collaboration_message_mentions"("userId", "createdAt");
CREATE INDEX "collaboration_folders_ownerId_deletedAt_idx" ON "collaboration_folders"("ownerId", "deletedAt");
CREATE INDEX "collaboration_folders_parentId_idx" ON "collaboration_folders"("parentId");
CREATE INDEX "collaboration_folders_centerId_idx" ON "collaboration_folders"("centerId");
CREATE UNIQUE INDEX "collaboration_files_publicId_key" ON "collaboration_files"("publicId");
CREATE INDEX "collaboration_files_ownerId_deletedAt_idx" ON "collaboration_files"("ownerId", "deletedAt");
CREATE INDEX "collaboration_files_scanStatus_idx" ON "collaboration_files"("scanStatus");
CREATE INDEX "collaboration_files_accessLevel_idx" ON "collaboration_files"("accessLevel");
CREATE INDEX "collaboration_files_centerId_idx" ON "collaboration_files"("centerId");
CREATE INDEX "collaboration_files_department_idx" ON "collaboration_files"("department");
CREATE INDEX "collaboration_files_createdAt_idx" ON "collaboration_files"("createdAt");
CREATE UNIQUE INDEX "collaboration_file_versions_storageKey_key" ON "collaboration_file_versions"("storageKey");
CREATE UNIQUE INDEX "collaboration_file_versions_fileId_version_key" ON "collaboration_file_versions"("fileId", "version");
CREATE INDEX "collaboration_file_versions_fileId_scanStatus_idx" ON "collaboration_file_versions"("fileId", "scanStatus");
CREATE UNIQUE INDEX "collaboration_file_shares_fileId_shareKey_key" ON "collaboration_file_shares"("fileId", "shareKey");
CREATE INDEX "collaboration_file_shares_targetUserId_revokedAt_idx" ON "collaboration_file_shares"("targetUserId", "revokedAt");
CREATE INDEX "collaboration_file_shares_targetConversationId_revokedAt_idx" ON "collaboration_file_shares"("targetConversationId", "revokedAt");
CREATE INDEX "collaboration_file_shares_targetCenterId_revokedAt_idx" ON "collaboration_file_shares"("targetCenterId", "revokedAt");
CREATE INDEX "collaboration_file_shares_targetDepartment_revokedAt_idx" ON "collaboration_file_shares"("targetDepartment", "revokedAt");
CREATE UNIQUE INDEX "collaboration_file_favorites_fileId_userId_key" ON "collaboration_file_favorites"("fileId", "userId");
CREATE INDEX "collaboration_file_favorites_userId_createdAt_idx" ON "collaboration_file_favorites"("userId", "createdAt");
CREATE INDEX "collaboration_file_scans_status_createdAt_idx" ON "collaboration_file_scans"("status", "createdAt");
CREATE INDEX "collaboration_file_scans_versionId_idx" ON "collaboration_file_scans"("versionId");
CREATE INDEX "collaboration_quotas_targetType_idx" ON "collaboration_quotas"("targetType");
CREATE UNIQUE INDEX "collaboration_quotas_quotaKey_key" ON "collaboration_quotas"("quotaKey");

ALTER TABLE "collaboration_conversations" ADD CONSTRAINT "collaboration_conversations_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_conversations" ADD CONSTRAINT "collaboration_conversations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_conversation_members" ADD CONSTRAINT "collaboration_conversation_members_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "collaboration_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_conversation_members" ADD CONSTRAINT "collaboration_conversation_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_messages" ADD CONSTRAINT "collaboration_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "collaboration_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_messages" ADD CONSTRAINT "collaboration_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaboration_messages" ADD CONSTRAINT "collaboration_messages_attachmentFileId_fkey" FOREIGN KEY ("attachmentFileId") REFERENCES "collaboration_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_messages" ADD CONSTRAINT "collaboration_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "collaboration_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_message_reads" ADD CONSTRAINT "collaboration_message_reads_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "collaboration_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_message_reads" ADD CONSTRAINT "collaboration_message_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_message_mentions" ADD CONSTRAINT "collaboration_message_mentions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "collaboration_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_message_mentions" ADD CONSTRAINT "collaboration_message_mentions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_folders" ADD CONSTRAINT "collaboration_folders_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaboration_folders" ADD CONSTRAINT "collaboration_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "collaboration_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_folders" ADD CONSTRAINT "collaboration_folders_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_files" ADD CONSTRAINT "collaboration_files_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaboration_files" ADD CONSTRAINT "collaboration_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaboration_files" ADD CONSTRAINT "collaboration_files_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_files" ADD CONSTRAINT "collaboration_files_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_files" ADD CONSTRAINT "collaboration_files_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "collaboration_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_files" ADD CONSTRAINT "collaboration_files_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "collaboration_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_files" ADD CONSTRAINT "collaboration_files_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_files" ADD CONSTRAINT "collaboration_files_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_files" ADD CONSTRAINT "collaboration_files_linkedToPatientById_fkey" FOREIGN KEY ("linkedToPatientById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_versions" ADD CONSTRAINT "collaboration_file_versions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "collaboration_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_versions" ADD CONSTRAINT "collaboration_file_versions_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_shares" ADD CONSTRAINT "collaboration_file_shares_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "collaboration_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_shares" ADD CONSTRAINT "collaboration_file_shares_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_shares" ADD CONSTRAINT "collaboration_file_shares_targetConversationId_fkey" FOREIGN KEY ("targetConversationId") REFERENCES "collaboration_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_shares" ADD CONSTRAINT "collaboration_file_shares_targetCenterId_fkey" FOREIGN KEY ("targetCenterId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_shares" ADD CONSTRAINT "collaboration_file_shares_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_favorites" ADD CONSTRAINT "collaboration_file_favorites_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "collaboration_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_favorites" ADD CONSTRAINT "collaboration_file_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_scans" ADD CONSTRAINT "collaboration_file_scans_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "collaboration_file_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_file_scans" ADD CONSTRAINT "collaboration_file_scans_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collaboration_quotas" ADD CONSTRAINT "collaboration_quotas_targetCenterId_fkey" FOREIGN KEY ("targetCenterId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "collaboration_settings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;
