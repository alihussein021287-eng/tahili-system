import { NextRequest } from "next/server";
import { previewCollaborationFile } from "@/lib/collaboration-service";
import { MAX_TEXT_PREVIEW_BYTES, collaborationPreviewPolicy } from "@/lib/collaboration-preview";

export const dynamic = "force-dynamic";

const BASE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function disposition(name: string) {
  const safe = name.replace(/["\r\n]/g, " ").slice(0, 180);
  return `inline; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function textFromBuffer(buffer: Buffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, MAX_TEXT_PREVIEW_BYTES));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const requestedVersion = url.searchParams.get("version");
    const version = requestedVersion ? Number(requestedVersion) : undefined;
    const stream = url.searchParams.get("stream") === "1";
    const { file, version: resolvedVersion, buffer } = await previewCollaborationFile(id, version);
    const policy = collaborationPreviewPolicy({
      mimeType: resolvedVersion.mimeType,
      name: file.originalName || file.displayName,
      scanStatus: resolvedVersion.scanStatus,
      size: resolvedVersion.size,
    });

    if (stream) {
      if (!policy.canStream) {
        return Response.json({ ok: false, kind: policy.kind, reason: policy.reason }, { status: 415, headers: BASE_HEADERS });
      }
      return new Response(new Uint8Array(buffer), {
        headers: {
          ...BASE_HEADERS,
          "Content-Type": policy.contentType,
          "Content-Length": String(buffer.length),
          "Content-Disposition": disposition(file.displayName || file.originalName),
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
        },
      });
    }

    if (policy.kind === "text") {
      return Response.json({
        ok: true,
        kind: policy.kind,
        mimeType: policy.contentType,
        name: file.displayName,
        size: resolvedVersion.size,
        version: resolvedVersion.version,
        text: textFromBuffer(buffer),
        truncated: buffer.length > MAX_TEXT_PREVIEW_BYTES,
        reason: policy.reason,
      }, { headers: BASE_HEADERS });
    }

    return Response.json({
      ok: true,
      kind: policy.kind,
      mimeType: policy.contentType,
      name: file.displayName,
      size: resolvedVersion.size,
      version: resolvedVersion.version,
      streamUrl: policy.canStream ? `/api/collaboration/files/${file.id}/preview?stream=1${requestedVersion ? `&version=${encodeURIComponent(requestedVersion)}` : ""}` : null,
      reason: policy.reason,
    }, { headers: BASE_HEADERS });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "تعذر فتح الملف" }, { status: 403, headers: BASE_HEADERS });
  }
}
