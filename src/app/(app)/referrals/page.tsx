import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentPerms, getSession, requirePerm } from "@/lib/access";
import { referralAccessScope } from "@/lib/referral-access";
import { PageHeader } from "@/components/PageHeader";
import { ReferralStatus, REFERRAL_STATUS_LABELS } from "@/components/referrals/ReferralStatus";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { PATIENTS_CARE_NAV } from "@/lib/hub-nav";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";

export const dynamic = "force-dynamic";

const TYPES = ["LAB", "RADIOLOGY", "IMAGING", "SPECIALIST", "TREATMENT_CENTER", "HOSPITAL", "OTHER"] as const;
const TYPE_LABELS: Record<string, string> = { LAB: "مختبر", RADIOLOGY: "أشعة", IMAGING: "تصوير", SPECIALIST: "اختصاص", TREATMENT_CENTER: "مركز علاج", HOSPITAL: "مستشفى", OTHER: "أخرى" };
/** Not finished yet: the default view, so open work is what shows first. */
const PENDING = ["DRAFT", "PENDING_PRINT", "READY", "SENT", "RESULT_RECEIVED"] as const;

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; q?: string; branch?: string }> }) {
  await requirePerm("referrals.view");
  const sp = await searchParams;
  const perms = await currentPerms();
  const session = await getSession();
  const scope = await referralAccessScope(prisma, { userId: (session!.user as any).id, role: (session!.user as any).role, permissions: perms });
  const userBranch = await currentUserBranch();
  const activeBranchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const status = sp.status ?? "pending";
  const where: any = {};
  if (status === "pending") where.status = { in: [...PENDING] };
  else if (status !== "all" && status in REFERRAL_STATUS_LABELS) where.status = status;
  if (sp.type && (TYPES as readonly string[]).includes(sp.type)) where.type = sp.type;
  if (sp.q?.trim()) where.OR = [
    { requestedService: { contains: sp.q.trim(), mode: "insensitive" } },
    { externalEntity: { contains: sp.q.trim(), mode: "insensitive" } },
    { patient: { fullName: { contains: sp.q.trim(), mode: "insensitive" } } },
  ];
  if (activeBranchId) where.patient = { branchId: activeBranchId };
  const [rows, branches] = await Promise.all([
    prisma.referralRequest.findMany({ where: { AND: [where, scope.where] }, include: { patient: { select: { fullName: true, fileNumber: true } }, destinationCenter: { select: { name: true } }, assignedReviewer: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const activeCount = [sp.status && sp.status !== "pending" ? sp.status : null, sp.type, sp.branch].filter(Boolean).length;

  return <div className="space-y-5">
    <PageHeader title="الفحوص والإحالات" subtitle="متابعة الإحالات الداخلية وكتب الإرسال والنتائج" icon="↗">
      <Link href="/referrals?status=PENDING_PRINT" className="btn-ghost bg-white text-brand-700">قائمة كتب الإرسال</Link>
    </PageHeader>
    <HubTabs nav={PATIENTS_CARE_NAV} active="referrals" label="تبويبات المرضى والرعاية" perms={perms} />
    <FilterBar action="/referrals" query={sp.q} placeholder="اسم المراجع أو الجهة أو الخدمة…" activeCount={activeCount} clearHref="/referrals">
      <label className="label">الحالة<select name="status" className="input mt-1" defaultValue={status}>
        <option value="pending">غير منتهية</option>
        <option value="all">كل الحالات</option>
        {Object.entries(REFERRAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="label">النوع<select name="type" className="input mt-1" defaultValue={sp.type || ""}><option value="">كل الأنواع</option>{TYPES.map((value) => <option key={value} value={value}>{TYPE_LABELS[value]}</option>)}</select></label>
      {branches.length > 0 ? (
        <label className="label">الفرع<select name="branch" className="input mt-1" defaultValue={sp.branch === "all" ? "all" : activeBranchId ? String(activeBranchId) : "all"}>
          <option value="all">كل الفروع</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select></label>
      ) : null}
    </FilterBar>
    <div className="grid gap-3">
      {rows.map((row) => <Link key={row.id} href={`/referrals/${row.id}`} className="card p-4 hover:border-brand-300 focus-visible:ring-2 focus-visible:ring-brand-500"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="font-bold text-gray-900 break-words">{row.requestedService}</div><div className="mt-1 text-sm text-gray-500">{row.patient.fullName}، ملف #{row.patient.fileNumber}</div><div className="mt-1 text-xs text-gray-400">{row.externalEntity || row.destinationCenter?.name || row.assignedReviewer?.fullName || "وجهة داخلية"}</div></div><ReferralStatus status={row.status} /></div></Link>)}
      {rows.length === 0 ? <div className="card p-8 text-center text-sm text-gray-500">لا توجد طلبات مطابقة.</div> : null}
    </div>
  </div>;
}
