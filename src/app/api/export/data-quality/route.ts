import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { apiPermissionResponse, checkApiPermission } from "@/lib/api-permissions";
import { getPatientDataQuality } from "@/lib/data-quality";
import { fmtDate } from "@/lib/labels";

export const dynamic = "force-dynamic";

function esc(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("غير مصرّح", { status: 401 });
  const permission = await checkApiPermission((session.user as any)?.id, (session.user as any)?.role, "patients.view");
  if (permission.allowed === false) return apiPermissionResponse(permission);

  const url = new URL(req.url);
  const report = await getPatientDataQuality(url.searchParams.get("kind") ?? undefined);
  const headers = ["نوع المشكلة", "رقم الملف", "الاسم", "الهاتف", "سنة التولد", "المحافظة", "نوع الإصابة", "نوع الحالة", "تاريخ الأرشفة", "التفاصيل"];
  const rows = report.issues.map((i) => [
    i.label,
    i.fileNumber,
    i.fullName,
    i.phone,
    i.birthYear,
    i.governorate,
    i.injuryType,
    i.caseType,
    i.archivedAt ? fmtDate(i.archivedAt) : "",
    i.detail,
  ]);
  const csv = "\uFEFFsep=,\r\n" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="patient-data-quality-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
