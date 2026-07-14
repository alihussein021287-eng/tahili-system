import { requirePerm } from "@/lib/access";
import { getReadinessChecks } from "@/lib/readiness";
import { getSystemStatus } from "@/lib/system-status";

export async function GET() {
  await requirePerm("settings.view");
  const [checks, system] = await Promise.all([getReadinessChecks(), getSystemStatus()]);
  const result = checks.some((x) => x.status === "fail") ? "غير جاهز" : checks.some((x) => x.status === "warn") ? "تحذير" : "جاهز";
  return new Response(JSON.stringify({ result, system, checks }, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": "attachment; filename=readiness-report.json", "cache-control": "no-store" } });
}
