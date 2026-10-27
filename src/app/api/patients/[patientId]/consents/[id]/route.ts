import { getApiSession } from "@/lib/access";
import { readConsentEvidence } from "@/lib/patient-consent-service";
import type { ClinicalActor } from "@/lib/clinical-review-service";
const headers = { "Cache-Control": "no-store, no-cache, max-age=0", "X-Content-Type-Options": "nosniff" };
export async function GET(_request: Request, { params }: { params: Promise<{ patientId: string; id: string }> }) {
  const { session, response } = await getApiSession(); if (response) return response;
  try {
    const { patientId, id } = await params;
    const u = session!.user as { id: string; role: ClinicalActor["role"]; authVersion: number };
    const { row, buffer } = await readConsentEvidence({ userId: u.id, role: u.role, authVersion: u.authVersion }, patientId, id);
    return new Response(new Uint8Array(buffer), { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.originalName.replace(/["\r\n]/g, " "))}` } });
  } catch { return new Response("دليل الموافقة غير متاح", { status: 403, headers }); }
}
