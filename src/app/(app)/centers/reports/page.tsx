import { prisma } from "@/lib/db";
import { accessibleCenterIds } from "@/lib/center-access";
import { requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { SERVICE_LABELS } from "@/lib/center-workspaces";

export const dynamic = "force-dynamic";

export default async function CenterReports() {
  await requirePerm("centers.view");
  const ids = await accessibleCenterIds();
  const [programs, sessions, centers] = await Promise.all([
    prisma.centerProgram.groupBy({ by: ["centerId", "serviceType", "status"], where: ids ? { centerId: { in: ids } } : {}, _count: { _all: true } }),
    prisma.centerSession.groupBy({ by: ["centerId", "status"], where: ids ? { centerId: { in: ids } } : {}, _count: { _all: true } }),
    prisma.center.findMany({ where: ids ? { id: { in: ids } } : {}, select: { id: true, name: true } }),
  ]);
  const names = new Map(centers.map((center)=>[center.id,center.name]));
  return <div className="space-y-5"><PageHeader title="تقارير المراكز والخدمات" subtitle="البرامج والجلسات حسب المركز والخدمة والحالة" icon="📊" /><section className="card overflow-hidden"><table className="w-full text-sm"><thead><tr><th className="th">المركز</th><th className="th">الخدمة</th><th className="th">الحالة</th><th className="th">البرامج</th></tr></thead><tbody>{programs.map((row)=><tr key={`${row.centerId}-${row.serviceType}-${row.status}`}><td className="td">{names.get(row.centerId)}</td><td className="td">{SERVICE_LABELS[row.serviceType]}</td><td className="td">{row.status}</td><td className="td">{row._count._all}</td></tr>)}</tbody></table></section><section className="card overflow-hidden"><table className="w-full text-sm"><thead><tr><th className="th">المركز</th><th className="th">حالة الجلسة</th><th className="th">العدد</th></tr></thead><tbody>{sessions.map((row)=><tr key={`${row.centerId}-${row.status}`}><td className="td">{names.get(row.centerId)}</td><td className="td">{row.status}</td><td className="td">{row._count._all}</td></tr>)}</tbody></table></section></div>;
}
