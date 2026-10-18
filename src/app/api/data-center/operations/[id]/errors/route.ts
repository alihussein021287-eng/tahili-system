import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/data-center/access";
import { errorReportRows } from "@/lib/data-center/operations";

export const dynamic = "force-dynamic";
const HEAD = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Protected error report (operation owner or ADMIN): row number, field and the required correction, never cell values. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor || !actor.permissions.has("datacenter.view")) return new Response("غير مصرح", { status: 403, headers: HEAD });
  const { id } = await params;
  const report = await errorReportRows(prisma, actor, id);
  if (!report) return new Response("غير موجود", { status: 404, headers: HEAD });
  const rows = [report.head, ...report.body.map((r) => r.map((c) => String(c)))];
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  const bytes = csv ? report.lib.writeCsv(rows) : report.lib.writeXlsx([{ name: "تقرير الأخطاء", rows, widths: [16, 18, 18, 34, 70] }]);
  return new Response(new Uint8Array(bytes), { headers: { ...HEAD, "Content-Type": csv ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="tahili-import-errors-${id.slice(-8)}.${csv ? "csv" : "xlsx"}"` } });
}
