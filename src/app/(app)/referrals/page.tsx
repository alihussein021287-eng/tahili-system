import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { ReferralStatus, REFERRAL_STATUS_LABELS } from "@/components/referrals/ReferralStatus";

export const dynamic = "force-dynamic";

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; q?: string }> }) {
  await requirePerm("referrals.view");
  const sp = await searchParams;
  const where: any = {};
  if (sp.status) where.status = sp.status;
  if (sp.type) where.type = sp.type;
  if (sp.q?.trim()) where.OR = [
    { requestedService: { contains: sp.q.trim(), mode: "insensitive" } },
    { externalEntity: { contains: sp.q.trim(), mode: "insensitive" } },
    { patient: { fullName: { contains: sp.q.trim(), mode: "insensitive" } } },
  ];
  const rows = await prisma.referralRequest.findMany({ where, include: { patient: { select: { fullName: true, fileNumber: true } }, destinationCenter: { select: { name: true } }, assignedReviewer: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return <div className="space-y-5">
    <PageHeader title="طلبات الفحوص والإحالات" subtitle="متابعة الإحالات الداخلية وكتب الإرسال والنتائج" icon="↗">
      <Link href="/patients-care?tab=referrals" className="btn-ghost bg-white text-brand-700">لوحة المرضى والرعاية</Link>
    </PageHeader>
    <form action="/referrals" className="card grid gap-3 p-4 md:grid-cols-4" autoComplete="off">
      <label className="label md:col-span-2">بحث<input name="q" className="input mt-1" defaultValue={sp.q || ""} placeholder="اسم المراجع أو الجهة أو الخدمة…" /></label>
      <label className="label">الحالة<select name="status" className="input mt-1" defaultValue={sp.status || ""}><option value="">كل الحالات</option>{Object.entries(REFERRAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">النوع<select name="type" className="input mt-1" defaultValue={sp.type || ""}><option value="">كل الأنواع</option>{["LAB","RADIOLOGY","IMAGING","SPECIALIST","TREATMENT_CENTER","HOSPITAL","OTHER"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <div className="md:col-span-4 flex gap-2"><button className="btn-primary">تطبيق الفلاتر</button><Link href="/referrals" className="btn-ghost">مسح الفلاتر</Link><Link href="/referrals?status=PENDING_PRINT" className="btn-ghost">قائمة كتب الإرسال</Link></div>
    </form>
    <div className="grid gap-3">
      {rows.map((row) => <Link key={row.id} href={`/referrals/${row.id}`} className="card p-4 hover:border-brand-300 focus-visible:ring-2 focus-visible:ring-brand-500"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="font-bold text-gray-900 break-words">{row.requestedService}</div><div className="mt-1 text-sm text-gray-500">{row.patient.fullName}، ملف #{row.patient.fileNumber}</div><div className="mt-1 text-xs text-gray-400">{row.externalEntity || row.destinationCenter?.name || row.assignedReviewer?.fullName || "وجهة داخلية"}</div></div><ReferralStatus status={row.status} /></div></Link>)}
      {rows.length === 0 ? <div className="card p-8 text-center text-sm text-gray-500">لا توجد طلبات مطابقة.</div> : null}
    </div>
  </div>;
}
