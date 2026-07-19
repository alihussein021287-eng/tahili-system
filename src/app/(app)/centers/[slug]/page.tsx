import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms } from "@/lib/access";
import { centerActor } from "@/lib/center-access";
import { CENTER_SPACES, resolveCenter } from "@/lib/center-workspaces";
import { CenterWorkspace } from "@/components/centers/CenterWorkspace";

export const dynamic = "force-dynamic";

export default async function CenterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(slug in CENTER_SPACES)) notFound();
  const { config, center } = await resolveCenter(prisma, slug as keyof typeof CENTER_SPACES);
  if (!center) notFound();
  await centerActor(center.id);
  const perms = await currentPerms();
  const [referrals, programs, members, users] = await Promise.all([
    prisma.referralRequest.findMany({ where: { destinationCenterId: center.id, destinationScope: "INTERNAL_CENTER", status: { in: ["READY", "ACCEPTED"] }, centerProgram: null }, include: { patient: true }, orderBy: { createdAt: "asc" } }),
    prisma.centerProgram.findMany({ where: { centerId: center.id }, include: { patient: true, assignedTo: true, sessions: { where: { scheduledAt: { gte: new Date() } } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.centerMembership.findMany({ where: { centerId: center.id }, include: { user: true }, orderBy: { startDate: "desc" } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  return <div className="space-y-5"><PageHeader title={config.title} subtitle="الإحالات والبرامج والعضويات والجلسات" icon="🏥"><Link href="/therapy-centers?tab=centers" className="btn-ghost bg-white text-brand-700">لوحة المسار العلاجي والمراكز</Link></PageHeader><CenterWorkspace slug={slug} center={center} services={config.services} referrals={referrals} programs={programs} members={members} users={users} canManageMembers={perms.has("centers.memberships.manage")} canManagePrograms={perms.has("centers.programs.manage")} canViewSensitive={perms.has("centers.psych.sensitive")} /></div>;
}
