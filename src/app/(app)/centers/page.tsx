import Link from "next/link";
import { prisma } from "@/lib/db";
import { accessibleCenterIds } from "@/lib/center-access";
import { activeSecretaryWhere } from "@/lib/center-membership";
import { requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { CENTER_PROGRAM_STATUS, CenterProgramTable } from "@/components/therapy/TherapyTables";
import { CENTER_SPACES, SERVICE_LABELS } from "@/lib/center-workspaces";
import { THERAPY_CENTERS_NAV } from "@/lib/hub-nav";

export const dynamic = "force-dynamic";

type Search = { q?: string; center?: string; service?: string; status?: string };

function SecretaryLine({ count }: { count: number }) {
  return <>
    <p className="mt-1 text-sm text-gray-600">{count} سكرتارية فعالة</p>
    {count === 0 ? <p role="alert" className="mt-1 text-sm font-medium text-amber-800">لا توجد سكرتارية لهذا المركز</p> : null}
  </>;
}

/** The one centres page: each centre's workspace, then every centre programme with filters. */
export default async function CentersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const perms = await requirePerm("centers.view");
  const sp = await searchParams;
  const ids = await accessibleCenterIds();
  const now = new Date();

  const programWhere: any = {};
  const and: any[] = [];
  if (ids) and.push({ centerId: { in: ids } });
  const centerId = Number(sp.center);
  if (sp.center && Number.isInteger(centerId)) and.push({ centerId });
  if (and.length) programWhere.AND = and;
  if (sp.status && sp.status in CENTER_PROGRAM_STATUS) programWhere.status = sp.status;
  if (sp.service && sp.service in SERVICE_LABELS) programWhere.serviceType = sp.service;
  const query = sp.q?.trim();
  if (query) {
    const asNumber = Number(query);
    programWhere.patient = { OR: [{ fullName: { contains: query, mode: "insensitive" } }, ...(!Number.isNaN(asNumber) ? [{ fileNumber: asNumber }] : [])] };
  }

  const [centers, programs] = await Promise.all([
    prisma.center.findMany({
      where: { ...(ids ? { id: { in: ids } } : {}), active: true },
      include: { memberships: { where: activeSecretaryWhere(), select: { id: true } }, _count: { select: { memberships: { where: { status: "ACTIVE" } }, programs: { where: { status: "ACTIVE" } }, resources: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.centerProgram.findMany({
      where: programWhere,
      include: { center: true, patient: { select: { id: true, fullName: true, fileNumber: true } }, assignedTo: { select: { fullName: true } }, sessions: { where: { scheduledAt: { gte: now } }, orderBy: { scheduledAt: "asc" }, take: 2 } },
      orderBy: [{ status: "asc" }, { expectedEndDate: "asc" }, { updatedAt: "desc" }],
      take: 150,
    }),
  ]);

  const spaceCenterIds = new Set<number>();
  const spaces = Object.entries(CENTER_SPACES).map(([slug, space]) => {
    const center = centers.find((item) => space.patterns.some((pattern) => item.name.includes(pattern)));
    if (center) spaceCenterIds.add(center.id);
    return { slug, space, center };
  });
  const otherCenters = centers.filter((center) => !spaceCenterIds.has(center.id));
  const activeCount = [sp.center, sp.service, sp.status].filter(Boolean).length;

  return (
    <div className="space-y-5">
      <PageHeader title="المراكز والبرامج" subtitle="مساحات عمل المراكز وكل برامجها" icon="🏥">
        <Link href="/centers/reports" className="btn-ghost bg-white text-brand-700">تقارير المراكز</Link>
      </PageHeader>
      <HubTabs nav={THERAPY_CENTERS_NAV} active="centers" label="تبويبات المسار العلاجي والمراكز" perms={perms} />

      <div className="grid gap-4 md:grid-cols-3">
        {spaces.map(({ slug, space, center }) => (
          <article key={slug} className="card p-5">
            <h2 className="text-lg font-bold">{space.title}</h2>
            {center ? <>
              <p className="mt-2 text-sm text-gray-600">{center._count.programs} برامج نشطة، {center._count.memberships} أعضاء، {center._count.resources} موارد</p>
              <SecretaryLine count={center.memberships.length} />
              <div className="mt-4 flex flex-wrap gap-2"><Link href={`/centers/${slug}`} className="btn-primary">فتح مساحة المركز</Link><Link href={`/centers/${slug}/today`} className="btn-ghost">جلسات اليوم</Link></div>
            </> : <p className="mt-3 text-sm text-amber-700">لم يُعثر على مركز مطابق ضمن المراكز المعرفة.</p>}
          </article>
        ))}
        {otherCenters.map((center) => (
          <article key={center.id} className="card p-5">
            <h2 className="text-lg font-bold">{center.name}</h2>
            <p className="mt-2 text-sm text-gray-600">{center._count.programs} برامج نشطة، {center._count.memberships} أعضاء، {center._count.resources} موارد</p>
            <SecretaryLine count={center.memberships.length} />
          </article>
        ))}
      </div>

      <FilterBar action="/centers" query={sp.q} placeholder="اسم المراجع أو رقم الملف…" activeCount={activeCount} clearHref="/centers">
        <label className="label">المركز<select name="center" className="input mt-1" defaultValue={sp.center ?? ""}><option value="">كل المراكز</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
        <label className="label">الخدمة<select name="service" className="input mt-1" defaultValue={sp.service ?? ""}><option value="">كل الخدمات</option>{Object.entries(SERVICE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="label">الحالة<select name="status" className="input mt-1" defaultValue={sp.status ?? ""}><option value="">كل الحالات</option>{Object.entries(CENTER_PROGRAM_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </FilterBar>

      <section className="card p-4">
        <h2 className="mb-3 font-bold">برامج المراكز ({programs.length})</h2>
        <CenterProgramTable rows={programs as any[]} />
      </section>
    </div>
  );
}
