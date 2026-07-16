import crypto from "crypto";

export const COLLABORATION_PERMISSIONS = [
  "collaboration.view",
  "chat.create",
  "chat.send",
  "chat.manage.members",
  "chat.moderate",
  "files.view",
  "files.upload",
  "files.download",
  "files.edit",
  "files.share",
  "files.delete",
  "files.restore",
  "files.delete.permanent",
  "files.audit",
  "files.admin",
] as const;

export type CollaborationPermission = (typeof COLLABORATION_PERMISSIONS)[number];

export type CollaborationActor = {
  id: string;
  role: string;
  department?: string | null;
  centerIds: number[];
  permissions: Set<string>;
};

export type FilePolicySettings = {
  maxUploadMb: number;
  allowedTypes: string[];
  blockedTypes: string[];
};

export const DEFAULT_ALLOWED_FILE_TYPES = [
  "pdf", "jpg", "jpeg", "png", "webp", "gif", "bmp",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "json", "xml", "md", "log",
  "zip", "rar", "7z", "mp3", "wav", "m4a", "mp4", "webm", "mov",
];

export const DEFAULT_BLOCKED_FILE_TYPES = [
  "exe", "msi", "bat", "cmd", "com", "ps1", "sh", "js", "jar", "scr", "dll",
];

const EXECUTABLE_MAGIC = [
  Buffer.from([0x4d, 0x5a]), // MZ
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF
];

export function directConversationKey(a: string, b: string) {
  const [first, second] = [a, b].sort();
  return `direct:${first}:${second}`;
}

export function publicFileId() {
  return crypto.randomBytes(18).toString("hex");
}

export function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function sanitizeFileName(name: string) {
  const cleaned = name
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "file";
}

export function extensionOf(name: string) {
  const base = sanitizeFileName(name).toLowerCase();
  const parts = base.split(".").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
  "application/xml": "xml",
  "text/markdown": "md",
  "text/xml": "xml",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "application/zip": "zip",
};

function ensureDownloadExtension(name: string, fallbackName: string, mimeType: string) {
  if (extensionOf(name)) return name;
  const fallbackExtension = extensionOf(fallbackName) || MIME_EXTENSIONS[mimeType] || "";
  return fallbackExtension ? `${name}.${fallbackExtension}` : name;
}

function appendVersionBeforeExtension(name: string, version: number) {
  const extension = extensionOf(name);
  if (!extension) return `${name}.v${version}`;
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? `${name.slice(0, dotIndex)}.v${version}${name.slice(dotIndex)}` : `${name}.v${version}`;
}

export function collaborationDownloadFileName(input: {
  displayName?: string | null;
  originalName: string;
  mimeType: string;
  version: number;
  includeVersion?: boolean;
}) {
  const baseName = sanitizeFileName(input.displayName || input.originalName);
  const fallbackName = sanitizeFileName(input.originalName);
  const namedWithExtension = ensureDownloadExtension(baseName, fallbackName, input.mimeType);
  return input.includeVersion ? appendVersionBeforeExtension(namedWithExtension, input.version) : namedWithExtension;
}

export function hasDangerousDoubleExtension(name: string, blockedTypes = DEFAULT_BLOCKED_FILE_TYPES) {
  const parts = sanitizeFileName(name).toLowerCase().split(".").filter(Boolean);
  if (parts.length < 3) return false;
  return parts.slice(0, -1).some((part) => blockedTypes.includes(part));
}

export function detectMime(buffer: Buffer, declaredType?: string | null) {
  if (buffer.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) return "application/pdf";
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  if (buffer.subarray(0, 3).toString("ascii") === "ID3" || buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfb]))) return "audio/mpeg";
  if (buffer.length > 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "application/zip";
  if (buffer.subarray(0, 7).equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]))) return "application/vnd.rar";
  const cleanDeclared = declaredType?.split(";")[0]?.trim().toLowerCase();
  return cleanDeclared && cleanDeclared !== "application/octet-stream" ? cleanDeclared : "application/octet-stream";
}

export function isExecutableContent(buffer: Buffer) {
  if (EXECUTABLE_MAGIC.some((magic) => buffer.subarray(0, magic.length).equals(magic))) return true;
  const prefix = buffer.subarray(0, Math.min(buffer.length, 256)).toString("utf8");
  return prefix.startsWith("#!") || prefix.includes("<script");
}

export function validateCollaborationUpload(input: {
  name: string;
  size: number;
  buffer: Buffer;
  declaredType?: string | null;
  settings: FilePolicySettings;
}) {
  const safeName = sanitizeFileName(input.name);
  const ext = extensionOf(safeName);
  const blocked = new Set((input.settings.blockedTypes.length ? input.settings.blockedTypes : DEFAULT_BLOCKED_FILE_TYPES).map((x) => x.toLowerCase()));
  const allowed = new Set((input.settings.allowedTypes.length ? input.settings.allowedTypes : DEFAULT_ALLOWED_FILE_TYPES).map((x) => x.toLowerCase()));
  if (!input.size || input.buffer.length === 0) throw new Error("الملف فارغ أو غير صالح");
  if (input.size > input.settings.maxUploadMb * 1024 * 1024) throw new Error(`حجم الملف يتجاوز الحد المسموح (${input.settings.maxUploadMb} MB)`);
  if (!ext || !/^[a-z0-9]{1,12}$/.test(ext)) throw new Error("امتداد الملف غير صالح");
  if (blocked.has(ext) || hasDangerousDoubleExtension(safeName, Array.from(blocked))) throw new Error("نوع الملف التنفيذي أو الخطر غير مسموح");
  if (!allowed.has(ext)) throw new Error("نوع الملف غير مسموح");
  if (isExecutableContent(input.buffer)) throw new Error("محتوى الملف يبدو تنفيذياً وغير مسموح");
  if (ext === "jar") throw new Error("ملفات JAR غير مسموحة");
  const mimeType = detectMime(input.buffer, input.declaredType);
  if (mimeType === "application/zip") {
    const sample = input.buffer.subarray(0, Math.min(input.buffer.length, 1024 * 1024)).toString("latin1");
    if (sample.includes("META-INF/MANIFEST.MF") && ext === "jar") throw new Error("ملف Java مضغوط غير مسموح");
  }
  return { safeName, extension: ext, mimeType };
}

export function canUseCenter(actor: CollaborationActor, centerId?: number | null) {
  if (!centerId) return true;
  return actor.role === "ADMIN" || actor.permissions.has("centers.central.view") || actor.centerIds.includes(centerId);
}

export function canUseDepartment(actor: CollaborationActor, department?: string | null) {
  if (!department) return true;
  return actor.role === "ADMIN" || Boolean(actor.department && actor.department === department);
}

export function assertCanGrantFileAccess(actor: CollaborationActor, target: { centerId?: number | null; department?: string | null; allStaff?: boolean }) {
  if (actor.role === "ADMIN" || actor.permissions.has("files.admin")) return;
  if (target.allStaff) throw new Error("لا يمكنك منح وصول لكل الموظفين");
  if (!canUseCenter(actor, target.centerId)) throw new Error("لا يمكنك مشاركة ملف خارج مراكزك");
  if (!canUseDepartment(actor, target.department)) throw new Error("لا يمكنك مشاركة ملف خارج قسمك");
}

export function canModerateConversation(actor: CollaborationActor, memberRole?: string | null) {
  return actor.role === "ADMIN" || actor.permissions.has("chat.moderate") || actor.permissions.has("chat.manage.members") || memberRole === "OWNER" || memberRole === "MODERATOR";
}

export function canEditMessage(input: { actor: CollaborationActor; senderId: string; createdAt: Date; editWindowMinutes: number; memberRole?: string | null }) {
  if (canModerateConversation(input.actor, input.memberRole)) return true;
  if (input.actor.id !== input.senderId) return false;
  const until = input.createdAt.getTime() + input.editWindowMinutes * 60_000;
  return Date.now() <= until;
}

export function shareKey(target: {
  type: "USER" | "CONVERSATION" | "DEPARTMENT" | "CENTER" | "ALL_STAFF";
  userId?: string | null;
  conversationId?: string | null;
  department?: string | null;
  centerId?: number | null;
}) {
  if (target.type === "USER" && target.userId) return `user:${target.userId}`;
  if (target.type === "CONVERSATION" && target.conversationId) return `conversation:${target.conversationId}`;
  if (target.type === "DEPARTMENT" && target.department) return `department:${target.department}`;
  if (target.type === "CENTER" && target.centerId) return `center:${target.centerId}`;
  if (target.type === "ALL_STAFF") return "all";
  throw new Error("هدف المشاركة غير صالح");
}

export function assertMedicalFileShareAllowed(input: { patientId?: string | null; targetType: string; allRecipientsCanViewPatient?: boolean }) {
  if (!input.patientId) return;
  if (["ALL_STAFF", "DEPARTMENT", "CENTER"].includes(input.targetType)) throw new Error("لا يمكن مشاركة ملف مرتبط بمراجع إلى نطاق عام");
  if (!input.allRecipientsCanViewPatient) throw new Error("المستلمون لا يملكون صلاحية رؤية المراجع");
}
