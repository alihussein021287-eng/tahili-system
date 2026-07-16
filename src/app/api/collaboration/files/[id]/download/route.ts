import { NextRequest } from "next/server";
import { readCollaborationFile } from "@/lib/collaboration-service";
import { collaborationPreviewPolicy } from "@/lib/collaboration-preview";
import { collaborationDownloadFileName } from "@/lib/collaboration-rules";

export const dynamic = "force-dynamic";

const BASE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function baseMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
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
    const previewPolicy = collaborationPreviewPolicy({
      mimeType: resolvedVersion.mimeType,
      name: file.originalName || file.displayName,
      scanStatus: resolvedVersion.scanStatus,
      size: resolvedVersion.size,
    });
    const inlinePreview = preview && previewPolicy.canStream;
    const finalName = collaborationDownloadFileName({
      displayName: file.displayName,
      originalName: file.originalName,
      mimeType: resolvedVersion.mimeType,
      version: resolvedVersion.version,
      includeVersion: Boolean(requestedVersion),
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        ...BASE_HEADERS,
        "Content-Type": inlinePreview ? baseMimeType(resolvedVersion.mimeType) : "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": disposition(finalName, inlinePreview),
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "تعذر قراءة الملف", { status: 403, headers: BASE_HEADERS });
  }
}
