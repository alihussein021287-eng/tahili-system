import { getServerSession } from "next-auth";
import { PageHeader } from "@/components/PageHeader";
import { authOptions } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadPerms } from "@/lib/access";
import { PermMatrix } from "@/components/PermMatrix";

export const dynamic = "force-dynamic";
const ROLES = ["MANAGER", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "PHARMACIST", "ACCOUNTANT", "RECEPTION", "RESIDENT", "DATA_ENTRY", "LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS", "VIEWER"] as const;

export default async function PermissionsPage() {
  const session = await getServerSession(authOptions);
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");

  const roleSets: Record<string, string[]> = {};
  for (const r of ROLES) roleSets[r] = Array.from(await loadPerms(undefined, r as any));

  const [users, overrides] = await Promise.all([
    prisma.user.findMany({ where: { role: { not: "ADMIN" } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, role: true } }),
    prisma.userPermission.findMany(),
  ]);
  const userOverrides: Record<string, Record<string, boolean>> = {};
  for (const o of overrides) { (userOverrides[o.userId] ||= {})[o.permKey] = o.allowed; }

  return (
    <div className="space-y-5">
      <PageHeader title="إدارة الصلاحيات" subtitle="صلاحيات الأدوار واستثناءات المستخدمين — مدير النظام يملك الكل" icon="🔐" />
      <PermMatrix roleSets={roleSets} users={users} userOverrides={userOverrides} />
    </div>
  );
}
