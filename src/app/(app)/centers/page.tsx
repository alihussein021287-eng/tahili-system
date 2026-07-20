import Link from "next/link";
import { prisma } from "@/lib/db";
import { accessibleCenterIds } from "@/lib/center-access";
import { requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { CENTER_SPACES } from "@/lib/center-workspaces";

export const dynamic = "force-dynamic";

export default async function CentersPage() {
  await requirePerm("centers.view");
  const ids = await accessibleCenterIds();
  const centers = await prisma.center.findMany({ where: { ...(ids ? { id: { in: ids } } : {}), active: true }, include: { _count: { select: { memberships: { where: { status: "ACTIVE" } }, programs: { where: { status: "ACTIVE" } }, resources: true } } }, orderBy: { name: "asc" } });
  return <div className="space-y-5"><PageHeader title="مساحات عمل المراكز" subtitle="العضويات والبرامج والجلسات والموارد" icon="🏥"><Link href="/therapy-centers?tab=centers" className="btn-ghost bg-white text-brand-700">لوحة المسار العلاجي والمراكز</Link></PageHeader><div className="grid gap-4 md:grid-cols-3">{Object.entries(CENTER_SPACES).map(([slug, space])=>{const center=centers.find((item)=>space.patterns.some((pattern)=>item.name.includes(pattern)));return <article key={slug} className="card p-5"><h2 className="text-lg font-bold">{space.title}</h2>{center ? <><p className="mt-2 text-sm text-gray-600">{center._count.programs} برامج نشطة، {center._count.memberships} أعضاء، {center._count.resources} موارد</p><div className="mt-4 flex flex-wrap gap-2"><Link href={`/centers/${slug}`} className="btn-primary">فتح مساحة المركز</Link><Link href={`/centers/${slug}/today`} className="btn-ghost">جلسات اليوم</Link></div></> : <p className="mt-3 text-sm text-amber-700">لم يُعثر على مركز مطابق ضمن المراكز المعرفة.</p>}</article>})}</div></div>;
}
