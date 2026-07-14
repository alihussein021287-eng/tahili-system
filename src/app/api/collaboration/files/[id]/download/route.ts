import { NextRequest } from "next/server";
import { readCollaborationFile } from "@/lib/collaboration-service";

export const dynamic = "force-dynamic";

const BASE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function disposition(name: string, inline: boolean) {
  const safe = name.replace(/["\r\n]/g, " ").slice(0, 180);
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const version = url.searchParams.get("version") ? Number(url.searchParams.get("version")) : undefined;
    const preview = url.searchParams.get("preview") === "1";
    const { file, version: resolvedVersion, buffer } = await readCollaborationFile(id, version);
    const previewable = file.mimeType.startsWith("image/") || file.mimeType === "application/pdf";
    return new Response(new Uint8Array(buffer), {
      headers: {
        ...BASE_HEADERS,
        "Content-Type": preview && previewable ? file.mimeType : "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": disposition(`${file.displayName || file.originalName}.v${resolvedVersion.version}`, preview && previewable),
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "تعذر قراءة الملف", { status: 403, headers: BASE_HEADERS });
  }
}
