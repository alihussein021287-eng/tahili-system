import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/data-center/access";
import { DataCenterDenied, exportQuotaOk, recordExport } from "@/lib/data-center/operations";
import { runExport } from "@/lib/data-center/export";
import { sheetLib } from "@/lib/data-center/spreadsheet";

export const dynamic = "force-dynamic";
const HEAD = { "Cache-Control": "no-store, no-cache, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };

export async function GET(req: Request) {
  const actor = await currentActor();
  if (!actor) return new Response("غير مصرح", { status: 401, headers: HEAD });
  const q = new URL(req.url).searchParams;
  const domain = q.get("domain") ?? "";
  const format = q.get("format") === "csv" ? "csv" : "xlsx";
  const branchRaw = q.get("branchId");
  const branchId = branchRaw ? Number(branchRaw) : null;
  const request = { domain, branchId: branchId != null && Number.isFinite(branchId) ? branchId : null, from: q.get("from"), to: q.get("to") };
  try {
    if (!(await exportQuotaOk(prisma, actor))) return new Response("تجاوزت الحد المسموح من عمليات التصدير في الساعة", { status: 429, headers: HEAD });
    if (q.get("count") === "1") {
      const r = await runExport(prisma, actor, request, true);
      return Response.json({ count: r.count }, { headers: HEAD });
    }
    const result = await runExport(prisma, actor, request);
    await recordExport(prisma, actor, domain, "COMPLETED", { branchId: result.branchId, scope: result.scope, rowCount: result.count, format });
    const lib = sheetLib();
    const rows = [result.headers, ...result.rows.map((r) => r.map((c) => String(c)))];
    const stamp = new Date().toISOString().slice(0, 10);
    const bytes = format === "csv" ? lib.writeCsv(rows) : lib.writeXlsx([{ name: "التصدير", rows, widths: result.headers.map(() => 22) }]);
    return new Response(new Uint8Array(bytes), { headers: { ...HEAD, "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="tahili-${domain}-${stamp}.${format}"` } });
  } catch (e) {
    if (e instanceof DataCenterDenied) return new Response(e.message, { status: 403, headers: HEAD });
    throw e;
  }
}
