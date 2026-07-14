import { requireSession } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { canManageUsers } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadPerms } from "@/lib/access";
import { PermMatrix } from "@/components/PermMatrix";

export const dynamic = "force-dynamic";
const ROLES = ["MANAGER", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "PHARMACIST", "ACCOUNTANT", "RECEPTION", "RESIDENT", "DATA_ENTRY", "LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS", "VIEWER"] as const;

export default async function PermissionsPage() {
  const session = await requireSession();
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");

  const roleSets: Record<string, string[]> = {};
  for (const r of ROLES) roleSets[r] = Array.from(await loadPerms(undefined, r as any));

  const [users, overrides, changes] = await Promise.all([
    prisma.user.findMany({ where: { role: { not: "ADMIN" } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, role: true } }),
    prisma.userPermission.findMany(),
    prisma.auditLog.findMany({ where: { tableName: { in: ["user_permissions", "role_permissions"] } }, include: { user: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const userOverrides: Record<string, Record<string, boolean>> = {};
  for (const o of overrides) { (userOverrides[o.userId] ||= {})[o.permKey] = o.allowed; }

  return (
    <div className="space-y-5">
      <PageHeader title="إدارة الصلاحيات" subtitle="صلاحيات الأدوار واستثناءات المستخدمين — مدير النظام يملك الكل" icon="🔐" />
      <div className="flex justify-end"><a href="/api/permissions/export" className="btn-ghost">تصدير مصفوفة الصلاحيات CSV</a></div>
      <PermMatrix roleSets={roleSets} users={users} userOverrides={userOverrides} />
      <section className="card overflow-hidden"><div className="border-b p-4 font-semibold">سجل تغييرات الصلاحيات</div><div className="divide-y">{changes.map((x)=><div key={x.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm"><span>{x.user?.fullName ?? "النظام"} · {x.action} · {x.recordId}</span><time className="text-gray-500">{x.createdAt.toLocaleString("ar-IQ")}</time></div>)}</div></section>
    </div>
  );
}
