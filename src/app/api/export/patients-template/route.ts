import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadPerms } from "@/lib/access";

export const dynamic = "force-dynamic";

function esc(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("غير مصرّح", { status: 401 });
  const perms = await loadPerms((session.user as any)?.id, (session.user as any)?.role);
  if (!perms.has("patients.import")) return new Response("لا تملك صلاحية الاستيراد", { status: 403 });

  const headers = ["الاسم الرباعي", "الهاتف", "اسم الأم", "سنة التولد", "السكن", "ملاحظات"];
  const example = ["علي حسين قاسم محمد", "07701234567", "زينب", "1990", "بغداد", "سطر مثال - احذفه قبل الاستيراد"];
  const csv = "\uFEFFsep=,\r\n" + [headers, example].map((r) => r.map(esc).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="patients-import-template.csv"`,
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
