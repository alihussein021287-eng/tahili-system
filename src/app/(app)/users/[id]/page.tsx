import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { canManageUsers, ROLE_LABELS } from "@/lib/permissions";
import { loadPerms } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { UserTabs } from "@/components/UserTabs";

export const dynamic = "force-dynamic";

export default async function UserDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireSession();
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");

  const user = await prisma.user.findUnique({ where: { id }, include: { branch: true } });
  if (!user) notFound();

  const isAdmin = user.role === "ADMIN";
  const [effectiveSet, overrides, activity, logins, branches] = await Promise.all([
    loadPerms(user.id, user.role),
    prisma.userPermission.findMany({ where: { userId: id }, select: { permKey: true, allowed: true } }),
    prisma.auditLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.loginLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const ov: Record<string, boolean> = {};
  for (const o of overrides) ov[o.permKey] = o.allowed;

  return (
    <div className="space-y-5">
      <PageHeader title={user.fullName || user.username} subtitle={`@${user.username} · ${ROLE_LABELS[user.role]}`} icon="👤" />

      <div className="flex items-center justify-between">
        <Link href="/users" className="text-sm text-brand-700 hover:underline">→ رجوع لقائمة المستخدمين</Link>
        <span className={`badge ${user.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {user.isActive ? "فعّال" : "معطّل"}
        </span>
      </div>

      <UserTabs
        user={JSON.parse(JSON.stringify(user))}
        isAdmin={isAdmin}
        effective={Array.from(effectiveSet)}
        overrides={ov}
        activity={JSON.parse(JSON.stringify(activity))}
        logins={JSON.parse(JSON.stringify(logins))}
        branches={JSON.parse(JSON.stringify(branches))}
        initialTab={sp.tab}
      />
    </div>
  );
}
