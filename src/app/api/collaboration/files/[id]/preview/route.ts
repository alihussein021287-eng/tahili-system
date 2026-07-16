import { NextRequest } from "next/server";
import { OfficePreviewError, getOrCreatePreviewPdfWithConfig } from "@/lib/collaboration-office-preview";
import { previewCollaborationFile } from "@/lib/collaboration-service";
import { MAX_TEXT_PREVIEW_BYTES, collaborationPreviewPolicy } from "@/lib/collaboration-preview";
import { getAdminConfig } from "@/lib/admin-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function disposition(name: string) {
  const safe = name.replace(/["\r\n]/g, " ").slice(0, 180);
  return `inline; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function pdfPreviewName(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/["\r\n]/g, " ").trim().slice(0, 160) || "preview";
  return `${base}.pdf`;
}

function textFromBuffer(buffer: Buffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, MAX_TEXT_PREVIEW_BYTES));
}

function previewStreamUrl(fileId: string, requestedVersion: string | null) {
  return `/api/collaboration/files/${fileId}/preview?stream=1${requestedVersion ? `&version=${encodeURIComponent(requestedVersion)}` : ""}`;
}

function officePreviewFailureReason(error: unknown) {
  if (error instanceof OfficePreviewError && error.message) return error.message;
  return "المعاينة غير متاحة لهذا الملف.";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const requestedVersion = url.searchParams.get("version");
    const version = requestedVersion ? Number(requestedVersion) : undefined;
    const stream = url.searchParams.get("stream") === "1";
    const [{ file, version: resolvedVersion, buffer }, previewConfig] = await Promise.all([
      previewCollaborationFile(id, version),
      getAdminConfig(),
    ]);
    const policy = collaborationPreviewPolicy({
      mimeType: resolvedVersion.mimeType,
      name: file.originalName || file.displayName,
      scanStatus: resolvedVersion.scanStatus,
      size: resolvedVersion.size,
    }, previewConfig);

    if (policy.kind === "office") {
      if (!policy.canPreview) {
        return Response.json({
          ok: false,
          kind: policy.kind,
          mimeType: policy.contentType,
          previewMimeType: "application/pdf",
          name: file.displayName,
          size: resolvedVersion.size,
          version: resolvedVersion.version,
          streamUrl: null,
          reason: policy.reason,
        }, { status: stream ? 415 : 200, headers: BASE_HEADERS });
      }
      try {
        const preview = await getOrCreatePreviewPdfWithConfig({
          fileId: file.id,
          version: resolvedVersion.version,
          originalName: file.originalName || file.displayName,
          mimeType: resolvedVersion.mimeType,
          scanStatus: resolvedVersion.scanStatus,
          size: resolvedVersion.size,
          sha256: resolvedVersion.sha256,
          buffer,
        }, previewConfig);

        if (stream) {
          return new Response(new Uint8Array(preview.buffer), {
            headers: {
              ...BASE_HEADERS,
              "Content-Type": "application/pdf",
              "Content-Length": String(preview.buffer.length),
              "Content-Disposition": disposition(pdfPreviewName(file.displayName || file.originalName)),
              "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
            },
          });
        }

        return Response.json({
          ok: true,
          kind: policy.kind,
          mimeType: "application/pdf",
          originalMimeType: policy.contentType,
          previewMimeType: "application/pdf",
          name: file.displayName,
          size: resolvedVersion.size,
          version: resolvedVersion.version,
          cached: preview.cached,
          streamUrl: previewStreamUrl(file.id, requestedVersion),
          reason: "تم تجهيز معاينة PDF داخلية لهذا الملف.",
        }, { headers: BASE_HEADERS });
      } catch (error) {
        return Response.json({
          ok: false,
          kind: policy.kind,
          mimeType: policy.contentType,
          previewMimeType: "application/pdf",
          name: file.displayName,
          size: resolvedVersion.size,
          version: resolvedVersion.version,
          streamUrl: null,
          reason: officePreviewFailureReason(error),
        }, { status: stream ? 422 : 200, headers: BASE_HEADERS });
      }
    }

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
      streamUrl: policy.canStream ? previewStreamUrl(file.id, requestedVersion) : null,
      reason: policy.reason,
    }, { headers: BASE_HEADERS });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "تعذر فتح الملف" }, { status: 403, headers: BASE_HEADERS });
  }
}
