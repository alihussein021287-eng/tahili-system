import { getApiSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { consentActor, recordSignedConsent } from "@/lib/patient-consent-service";
import type { ClinicalActor } from "@/lib/clinical-review-service";
export async function POST(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const { session, response } = await getApiSession(); if (response) return response;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const origins = new Set([new URL(request.url).origin]);
    if (process.env.NEXTAUTH_URL) origins.add(new URL(process.env.NEXTAUTH_URL).origin);
    if (!origins.has(request.headers.get("origin") || "")) throw new Error("origin");
    const { patientId } = await params;
    const u = session!.user as { id: string; role: ClinicalActor["role"]; authVersion: number };
    const actor = { userId: u.id, role: u.role, authVersion: u.authVersion };
    await prisma.$transaction(tx => consentActor(tx, actor, "consents.record", patientId, "files.upload"));
    const limit = 22 * 1024 * 1024, length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error("size");
    const reader = request.body?.getReader(); if (!reader) throw new Error("empty");
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) throw new Error("size"); chunks.push(value); } }
    finally { await reader.cancel(); }
    const form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") || "" }, body: Buffer.concat(chunks) }).formData();
    const text = (k: string) => form.get(k)?.toString().trim() || "";
    const file = form.get("signedFile"); if (!(file instanceof File)) throw new Error("file");
    await recordSignedConsent(actor, patientId, { procedure: text("procedure"), documentCode: text("documentCode"), documentVersion: text("documentVersion"),
      signerName: text("signerName"), signerCapacity: text("signerCapacity"), representationBasis: text("representationBasis"), signedAt: text("signedAt"), attestedSigned: text("attestedSigned") === "1" }, file);
    return Response.json({ ok: true }, { headers });
  } catch { return Response.json({ error: "تعذر تسجيل الموافقة؛ تحقق من الصلاحيات والبيانات والملف الموقع والفحص الأمني" }, { status: 400, headers }); }
}
