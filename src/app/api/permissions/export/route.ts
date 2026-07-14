import { requireSession } from "@/lib/access";
import { canManageUsers } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { ALL_PERMS, roleDefaultSet } from "@/lib/perms";

export async function GET() {
  const session = await requireSession();
  if (!canManageUsers((session?.user as any)?.role)) return new Response("Forbidden", { status: 403 });
  const [users, permissions] = await Promise.all([prisma.user.findMany({ orderBy: { username: "asc" } }), prisma.userPermission.findMany()]);
  const byUser = new Map<string, typeof permissions>(); for (const p of permissions) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
  const rows = [["username", "role", ...ALL_PERMS]];
  for (const user of users) { const base = roleDefaultSet(user.role); const ov = new Map((byUser.get(user.id) ?? []).map((x) => [x.permKey, x.allowed])); rows.push([user.username, user.role, ...ALL_PERMS.map((k) => String(user.role === "ADMIN" || (ov.has(k) ? ov.get(k) : base.has(k))))]); }
  const csv = "\uFEFF" + rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=permissions.csv" } });
}
