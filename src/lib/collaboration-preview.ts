export type FilePreviewKind = "image" | "pdf" | "text" | "audio" | "video" | "office" | "unsupported" | "blocked";

export type FilePreviewPolicy = {
  kind: FilePreviewKind;
  canPreview: boolean;
  canStream: boolean;
  contentType: string;
  reason: string;
};

export const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
export const MAX_OFFICE_PREVIEW_BYTES = 25 * 1024 * 1024;

const IMAGE_PREVIEW_MIME_TYPES = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const TEXT_PREVIEW_MIME_TYPES = new Set([
  "application/csv",
  "application/json",
  "application/ld+json",
  "application/xml",
  "text/csv",
  "text/log",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml",
]);

export type OfficePreviewType = "docx" | "xlsx" | "pptx";

const OFFICE_PREVIEW_TYPES: Record<OfficePreviewType, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const OFFICE_ZIP_MIME_TYPE = "application/zip";

const BLOCKED_INLINE_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-bat",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-sh",
  "application/xhtml+xml",
  "text/html",
  "text/javascript",
  "text/x-shellscript",
]);

const BLOCKED_INLINE_EXTENSIONS = new Set([
  "app",
  "bat",
  "cmd",
  "com",
  "dll",
  "exe",
  "hta",
  "html",
  "jar",
  "js",
  "mjs",
  "msi",
  "ps1",
  "scr",
  "sh",
  "svg",
  "vbs",
]);

const TEXT_EXTENSIONS = new Set(["csv", "json", "log", "md", "txt", "xml"]);

export function baseMimeType(mimeType: string | null | undefined) {
  return mimeType?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

export function fileExtension(name: string | null | undefined) {
  const safeName = (name || "").toLowerCase().trim();
  const dotIndex = safeName.lastIndexOf(".");
  return dotIndex > -1 ? safeName.slice(dotIndex + 1).replace(/[^a-z0-9]/g, "") : "";
}

export function officePreviewType(input: { mimeType: string | null | undefined; name?: string | null }): OfficePreviewType | null {
  const contentType = baseMimeType(input.mimeType);
  const extension = fileExtension(input.name) as OfficePreviewType;
  if (!Object.prototype.hasOwnProperty.call(OFFICE_PREVIEW_TYPES, extension)) return null;
  if (contentType === OFFICE_PREVIEW_TYPES[extension] || contentType === OFFICE_ZIP_MIME_TYPE) return extension;
  return null;
}

export function isOfficePreviewSupported(input: {
  mimeType: string | null | undefined;
  name?: string | null;
  scanStatus: string | null | undefined;
  size?: number | null;
}) {
  return input.scanStatus === "SAFE"
    && Boolean(officePreviewType(input))
    && (!input.size || input.size <= MAX_OFFICE_PREVIEW_BYTES);
}

export function collaborationPreviewPolicy(input: {
  mimeType: string | null | undefined;
  name?: string | null;
  scanStatus: string | null | undefined;
  size?: number | null;
}): FilePreviewPolicy {
  const contentType = baseMimeType(input.mimeType);
  const extension = fileExtension(input.name);
  if (input.scanStatus !== "SAFE") {
    return {
      kind: "blocked",
      canPreview: false,
      canStream: false,
      contentType,
      reason: "الملف لم يجتز الفحص الأمني ولا يمكن فتحه أو تنزيله.",
    };
  }
  if (BLOCKED_INLINE_MIME_TYPES.has(contentType) || BLOCKED_INLINE_EXTENSIONS.has(extension)) {
    return {
      kind: "blocked",
      canPreview: false,
      canStream: false,
      contentType,
      reason: "هذا النوع لا يفتح داخل النظام لأنه قد يشغل محتوى نشطاً.",
    };
  }
  if (contentType === "application/pdf") {
    return { kind: "pdf", canPreview: true, canStream: true, contentType, reason: "يفتح كملف PDF داخل العارض الآمن." };
  }
  if (IMAGE_PREVIEW_MIME_TYPES.has(contentType)) {
    return { kind: "image", canPreview: true, canStream: true, contentType, reason: "يفتح كصورة داخل النظام." };
  }
  if (contentType === "audio/mpeg" || contentType === "audio/mp3" || contentType === "audio/wav" || contentType === "audio/webm") {
    return { kind: "audio", canPreview: true, canStream: true, contentType, reason: "يفتح كمقطع صوتي داخل المتصفح." };
  }
  if (contentType === "video/mp4" || contentType === "video/webm") {
    return { kind: "video", canPreview: true, canStream: true, contentType, reason: "يفتح كمقطع فيديو داخل المتصفح." };
  }
  if (TEXT_PREVIEW_MIME_TYPES.has(contentType) || (contentType === "text/plain" && TEXT_EXTENSIONS.has(extension))) {
    return {
      kind: "text",
      canPreview: true,
      canStream: false,
      contentType: contentType.startsWith("text/") ? `${contentType}; charset=utf-8` : contentType,
      reason: input.size && input.size > MAX_TEXT_PREVIEW_BYTES
        ? "سيتم عرض أول 1MB فقط من النص داخل النظام."
        : "يفتح كنص مقروء داخل النظام بدون تفسير HTML.",
    };
  }
  if (officePreviewType(input)) {
    if (input.size && input.size > MAX_OFFICE_PREVIEW_BYTES) {
      return {
        kind: "office",
        canPreview: false,
        canStream: false,
        contentType,
        reason: "حجم ملف Office يتجاوز حد المعاينة الداخلية 25MB.",
      };
    }
    return {
      kind: "office",
      canPreview: true,
      canStream: false,
      contentType,
      reason: "يحوّل إلى PDF محلياً ثم يفتح داخل عارض PDF الآمن.",
    };
  }
  return {
    kind: "unsupported",
    canPreview: false,
    canStream: false,
    contentType,
    reason: "هذا النوع غير مدعوم للمعاينة الداخلية حالياً.",
  };
}
