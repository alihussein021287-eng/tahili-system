"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createChannelConversation,
  createDirectConversation,
  createFolder,
  createGroupConversation,
  deleteMessageSoft,
  editMessage,
  linkFileToPatient,
  permanentDeleteFile,
  rescanFileVersion,
  restoreFile,
  revokeFileShare,
  sendConversationMessage,
  setMessagePinned,
  shareFile,
  softDeleteFile,
  toggleFavorite,
  transferFileOwner,
  updateCollaborationSettings,
  updateConversationMember,
  updateFileMetadata,
  uploadCollaborationFileFromFile,
  uploadNewFileVersion,
} from "@/lib/collaboration-service";

function refresh(conversationId?: string) {
  revalidatePath("/collaboration");
  revalidatePath("/collaboration/files");
  revalidatePath("/collaboration/admin");
  if (conversationId) revalidatePath(`/collaboration?conversation=${conversationId}`);
}

export async function createDirectAction(formData: FormData) {
  const id = await createDirectConversation(String(formData.get("targetUserId") || ""));
  refresh(id);
  redirect(`/collaboration?conversation=${id}`);
}

export async function createGroupAction(formData: FormData) {
  const id = await createGroupConversation(formData);
  refresh(id);
  redirect(`/collaboration?conversation=${id}`);
}

export async function createChannelAction(formData: FormData) {
  const id = await createChannelConversation(formData);
  refresh(id);
  redirect(`/collaboration?conversation=${id}`);
}

export async function sendMessageAction(conversationId: string, formData: FormData) {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0 && !formData.get("attachmentFileId")) {
    formData.set("accessLevel", "CONVERSATION");
    formData.set("conversationId", conversationId);
    const fileId = await uploadCollaborationFileFromFile(file, formData);
    formData.set("attachmentFileId", fileId);
  }
  await sendConversationMessage(conversationId, formData);
  refresh(conversationId);
}

export async function editMessageAction(messageId: string, conversationId: string, formData: FormData) {
  await editMessage(messageId, formData);
  refresh(conversationId);
}

export async function deleteMessageAction(messageId: string, conversationId: string) {
  await deleteMessageSoft(messageId);
  refresh(conversationId);
}

export async function pinMessageAction(messageId: string, conversationId: string, pinned: boolean) {
  await setMessagePinned(messageId, pinned);
  refresh(conversationId);
}

export async function memberAction(conversationId: string, targetUserId: string, action: "ADD" | "REMOVE" | "LEAVE" | "MUTE" | "UNMUTE" | "PROMOTE" | "DEMOTE") {
  await updateConversationMember(conversationId, targetUserId, action);
  refresh(conversationId);
}

export async function addMemberAction(conversationId: string, formData: FormData) {
  await updateConversationMember(conversationId, String(formData.get("targetUserId") || ""), "ADD");
  refresh(conversationId);
}

export async function uploadFileAction(formData: FormData) {
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (!files.length) {
    const single = formData.get("file");
    if (single instanceof File && single.size > 0) files.push(single);
  }
  for (const file of files) await uploadCollaborationFileFromFile(file, formData);
  refresh(String(formData.get("conversationId") || "") || undefined);
}

export async function uploadVersionAction(fileId: string, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("اختر ملفاً");
  await uploadNewFileVersion(fileId, file);
  refresh();
}

export async function updateFileAction(fileId: string, formData: FormData) {
  await updateFileMetadata(fileId, formData);
  refresh();
}

export async function shareFileAction(fileId: string, formData: FormData) {
  await shareFile(fileId, formData);
  refresh();
}

export async function revokeShareAction(shareId: string) {
  await revokeFileShare(shareId);
  refresh();
}

export async function deleteFileAction(fileId: string) {
  await softDeleteFile(fileId);
  refresh();
}

export async function restoreFileAction(fileId: string) {
  await restoreFile(fileId);
  refresh();
}

export async function permanentDeleteFileAction(fileId: string) {
  await permanentDeleteFile(fileId);
  refresh();
}

export async function toggleFavoriteAction(fileId: string) {
  await toggleFavorite(fileId);
  refresh();
}

export async function createFolderAction(formData: FormData) {
  await createFolder(formData);
  refresh();
}

export async function transferOwnerAction(fileId: string, formData: FormData) {
  await transferFileOwner(fileId, String(formData.get("newOwnerId") || ""));
  refresh();
}

export async function linkPatientAction(fileId: string, formData: FormData) {
  if (formData.get("confirm") !== "on") throw new Error("يجب تأكيد ربط الملف بالمراجع");
  await linkFileToPatient(fileId, String(formData.get("patientId") || ""));
  refresh();
}

export async function saveCollaborationSettingsAction(formData: FormData) {
  await updateCollaborationSettings(formData);
  refresh();
}

export async function rescanFileAction(versionId: string) {
  await rescanFileVersion(versionId);
  refresh();
}
