import { getApiSession } from "@/lib/access";
import { NextRequest } from "next/server";
import { readStoredFile } from "@/lib/storage";
import { apiPermissionResponse, checkApiPermission } from "@/lib/api-permissions";
import { prisma } from "@/lib/db";
import { canReadLegacyPatientFile } from "@/lib/legacy-patient-file-access";
import { canAccessPatientRecord } from "@/lib/patient-access";
import { referralAccessScope } from "@/lib/referral-access";
import { scanBufferWithClamAv } from "@/lib/collaboration-scan";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { session, response } = await getApiSession();
  if (response || !session) return response!;

  const { key } = await params;
  const rawKey = key.join("/");
  if (key.length !== 1 || rawKey.includes("..") || rawKey.includes("/") || rawKey.includes("\\")) {
    return new Response("مسار غير صالح", { status: 400, headers: NO_STORE_HEADERS });
  }

  const fileUrl = `/api/files/${rawKey}`;
  const [patientAttachment, patientPhoto, officialDocument, referralResult, expenseAttachment, purchaseAttachment] = await Promise.all([
    prisma.attachment.findFirst({ where: { fileUrl }, select: { patientId: true, wound: { select: { patientId: true } } } }),
    prisma.patient.findFirst({ where: { photoUrl: fileUrl }, select: { id: true } }),
    prisma.officialDocument.findFirst({ where: { attachmentUrl: fileUrl }, select: { patientId: true, createdById: true } }),
    prisma.referralRequest.findFirst({ where: { resultAttachmentUrl: fileUrl }, select: { id: true } }),
    prisma.woundedExpenseAttachment.findFirst({ where: { fileUrl }, select: { expense: { select: { patientId: true } } } }),
    prisma.purchaseOrderAttachment.findFirst({ where: { fileUrl }, select: { id: true } }),
  ]);
  if (!patientAttachment && !patientPhoto && !officialDocument && !referralResult && !expenseAttachment && !purchaseAttachment) {
    return new Response("غير موجود", { status: 404, headers: NO_STORE_HEADERS });
  }
  const userId = (session.user as any)?.id as string | undefined;
  const role = (session.user as any)?.role;
  if (!userId || !role) return new Response("غير موجود", { status: 404, headers: NO_STORE_HEADERS });
  const permission = await checkApiPermission(
    userId, role,
    ["patients.view", "officialdocs.view", "referrals.view", "expenses.view", "pharmacy.purchase.view"],
  );
  if (permission.allowed === false) return apiPermissionResponse(permission);

  const actor = { userId, role, permissions: permission.permissions };
  const patientAccess = (patientId: string | null) =>
    patientId
      ? canReadLegacyPatientFile(prisma, actor, patientId).then(async (ok) => ok || (await canAccessPatientRecord(prisma, actor, patientId)))
      : Promise.resolve(false);
  const checks: Promise<boolean>[] = [];
  if (patientAttachment) checks.push(patientAccess(patientAttachment.patientId ?? patientAttachment.wound?.patientId ?? null));
  if (patientPhoto) checks.push(patientAccess(patientPhoto.id));
  if (officialDocument) checks.push(
    Promise.resolve(permission.permissions.has("officialdocs.view") && (
      officialDocument.patientId != null
      || officialDocument.createdById === userId
      || (role === "ADMIN" || (role === "MANAGER" && permission.permissions.has("centers.central.view")))
    )).then(async (allowed) => allowed && (
      officialDocument.patientId ? await patientAccess(officialDocument.patientId) : true
    )),
  );
  if (referralResult) checks.push((async () => {
    try {
      const scope = await referralAccessScope(prisma, actor);
      return !!(await prisma.referralRequest.findFirst({ where: { id: referralResult.id, AND: [scope.where] }, select: { id: true } }));
    } catch { return false; }
  })());
  if (expenseAttachment) checks.push(Promise.resolve(permission.permissions.has("expenses.view"))
    .then(async (allowed) => allowed && await patientAccess(expenseAttachment.expense.patientId)));
  if (purchaseAttachment) checks.push(Promise.resolve(permission.permissions.has("pharmacy.purchase.view")));
  if ((await Promise.all(checks)).some((allowed) => !allowed)) {
    return new Response("غير موجود", { status: 404, headers: NO_STORE_HEADERS });
  }

  const buf = await readStoredFile(rawKey);
  if (!buf) return new Response("غير موجود", { status: 404, headers: NO_STORE_HEADERS });
  // Legacy records have no scan provenance; scan each read without mutating their status.
  let scan;
  try {
    scan = await scanBufferWithClamAv(buf);
  } catch {
    return new Response("فحص الملف غير متاح", { status: 503, headers: NO_STORE_HEADERS });
  }
  if (scan.status !== "SAFE") return new Response("غير موجود", { status: 404, headers: NO_STORE_HEADERS });
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
