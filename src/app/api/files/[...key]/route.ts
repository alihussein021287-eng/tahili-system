import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readStoredFile } from "@/lib/storage";
import { apiPermissionResponse, checkApiPermission } from "@/lib/api-permissions";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("غير مصرّح", { status: 401, headers: NO_STORE_HEADERS });

  const { key } = await params;
  const rawKey = key.join("/");
  if (key.length !== 1 || rawKey.includes("..") || rawKey.includes("/") || rawKey.includes("\\")) {
    return new Response("مسار غير صالح", { status: 400, headers: NO_STORE_HEADERS });
  }

  const fileUrl = `/api/files/${rawKey}`;
  const [patientAttachment, officialDocument] = await Promise.all([
    prisma.attachment.findFirst({ where: { fileUrl }, select: { id: true } }),
    prisma.officialDocument.findFirst({ where: { attachmentUrl: fileUrl }, select: { id: true } }),
  ]);
  const requiredPermissions = [
    ...(patientAttachment || !officialDocument ? ["patients.view"] : []),
    ...(officialDocument ? ["officialdocs.view"] : []),
  ];
  const permission = await checkApiPermission(
    (session.user as any)?.id,
    (session.user as any)?.role,
    requiredPermissions,
  );
  if (permission.allowed === false) return apiPermissionResponse(permission);

  const buf = await readStoredFile(rawKey);
  if (!buf) return new Response("غير موجود", { status: 404, headers: NO_STORE_HEADERS });
  const lower = rawKey.toLowerCase();
  const contentType = lower.endsWith(".png") ? "image/png"
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg"
    : lower.endsWith(".gif") ? "image/gif"
    : lower.endsWith(".webp") ? "image/webp"
    : lower.endsWith(".pdf") ? "application/pdf"
    : "application/octet-stream";

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentType,
      ...NO_STORE_HEADERS,
    },
  });
}
