import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { canManageUsers, ROLE_LABELS } from "@/lib/permissions";
import { loadPerms } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { UserTabs } from "@/components/UserTabs";
import { userDeletionBlockers } from "@/lib/user-deletion";

export const dynamic = "force-dynamic";

export default async function UserDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; new?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireSession();
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");

  const user = await prisma.user.findUnique({ where: { id }, include: { branch: true, employeeRecord: { select: { id: true, name: true } } } });
  if (!user) notFound();

  const isAdmin = user.role === "ADMIN";
  const [effectiveSet, overrides, activity, logins, branches, deletionBlockers, centers, memberships] = await Promise.all([
    loadPerms(user.id, user.role),
    prisma.userPermission.findMany({ where: { userId: id }, select: { permKey: true, allowed: true } }),
    prisma.auditLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.loginLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    userDeletionBlockers(prisma, id),
    prisma.center.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.centerMembership.findMany({
      where: { userId: id },
      include: { center: { select: { id: true, name: true } } },
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
    }),
  ]);
  const ov: Record<string, boolean> = {};
  for (const o of overrides) ov[o.permKey] = o.allowed;

  return (
    <div className="space-y-5">
      <PageHeader title={user.fullName || user.username} subtitle={`@${user.username} · ${ROLE_LABELS[user.role]}`} icon="👤">
        {user.employeeRecord ? <Link href={`/staff/employees/${user.employeeRecord.id}`} className="btn-ghost" data-testid="employee-record-link">السجل الوظيفي: {user.employeeRecord.name}</Link> : null}
      </PageHeader>

      <div className="flex items-center justify-between">
        <Link href="/users" className="text-sm text-brand-700 hover:underline">→ رجوع إلى الحسابات والأدوار</Link>
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
        deletionBlockers={deletionBlockers}
        isCurrentUser={(session?.user as any)?.id === id}
        centers={JSON.parse(JSON.stringify(centers))}
        memberships={JSON.parse(JSON.stringify(memberships))}
        isNewAccount={sp.new === "1"}
      />
    </div>
  );
}
