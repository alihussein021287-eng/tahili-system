import { NextRequest } from "next/server";
import { readCollaborationFile } from "@/lib/collaboration-service";
import { collaborationDownloadFileName } from "@/lib/collaboration-rules";

export const dynamic = "force-dynamic";

const BASE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

const TEXT_PREVIEW_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
]);

function baseMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

function isInlinePreviewable(mimeType: string) {
  const base = baseMimeType(mimeType);
  if (base === "application/pdf") return true;
  if (base.startsWith("image/") && base !== "image/svg+xml") return true;
  if (base.startsWith("video/") || base.startsWith("audio/")) return true;
  return TEXT_PREVIEW_MIME_TYPES.has(base);
}

function previewContentType(mimeType: string) {
  const base = baseMimeType(mimeType);
  if (TEXT_PREVIEW_MIME_TYPES.has(base) && !/;\s*charset=/i.test(mimeType)) return `${base}; charset=utf-8`;
  return base;
}

function disposition(name: string, inline: boolean) {
  const safe = name.replace(/["\r\n]/g, " ").slice(0, 180);
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const requestedVersion = url.searchParams.get("version");
    const version = requestedVersion ? Number(requestedVersion) : undefined;
    const preview = url.searchParams.get("preview") === "1";
    const { file, version: resolvedVersion, buffer } = await readCollaborationFile(id, version);
    const inlinePreview = preview && isInlinePreviewable(file.mimeType);
    const finalName = collaborationDownloadFileName({
      displayName: file.displayName,
      originalName: file.originalName,
      mimeType: file.mimeType,
      version: resolvedVersion.version,
      includeVersion: Boolean(requestedVersion),
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        ...BASE_HEADERS,
        "Content-Type": inlinePreview ? previewContentType(file.mimeType) : "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": disposition(finalName, inlinePreview),
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "تعذر قراءة الملف", { status: 403, headers: BASE_HEADERS });
  }
}
