import { currentActor } from "@/lib/data-center/access";
import { importAllowed } from "@/lib/data-center/operations";
import { prisma } from "@/lib/db";
import { currentDatabaseName } from "@/lib/data-center/operations";
import { loadReferences } from "@/lib/data-center/reference";
import { buildTemplate } from "@/lib/data-center/templates";

export const dynamic = "force-dynamic";
const HEAD = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(req: Request, { params }: { params: Promise<{ domain: string }> }) {
  const actor = await currentActor();
  if (!actor) return new Response("غير مصرح", { status: 401, headers: HEAD });
  const { domain } = await params;
  if (!importAllowed(actor, domain)) return new Response("غير مصرح", { status: 403, headers: HEAD });
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const t = buildTemplate(domain, format, await loadReferences(prisma), { databaseName: await currentDatabaseName(prisma) });
  if (!t) return new Response(format === "csv" ? "هذا القالب XLSX فقط (ملف موحّد بأوراق مترابطة)" : "غير موجود", { status: format === "csv" ? 400 : 404, headers: HEAD });
  return new Response(new Uint8Array(t.bytes), { headers: { ...HEAD, "Content-Type": t.contentType, "Content-Disposition": `attachment; filename="${t.filename}"` } });
}
