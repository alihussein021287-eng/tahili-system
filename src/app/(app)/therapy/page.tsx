import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { PlanTable, emptyRow } from "@/components/therapy/TherapyTables";
import { getSession, requirePerm } from "@/lib/access";
import { activeCenterHallOptions } from "@/lib/center-halls";
import { THERAPY_CENTERS_NAV } from "@/lib/hub-nav";
import { PLAN_STATUS, THERAPY, fmtDate } from "@/lib/labels";
import { evaluationDue } from "@/lib/therapy-plan-rules";

export const dynamic = "force-dynamic";

type Search = { q?: string; status?: string; type?: string; center?: string; therapist?: string; headTherapist?: string; hall?: string };

function patientSearchWhere(q?: string) {
  const query = q?.trim();
  if (!query) return undefined;
  const asNumber = Number(query);
  return { OR: [{ fullName: { contains: query, mode: "insensitive" } }, ...(!Number.isNaN(asNumber) ? [{ fileNumber: asNumber }] : [])] };
}

/** The one list of treatment plans: referrals waiting for a plan, every plan with filters, and therapist load. */
export default async function TherapyPlansPage({ searchParams }: { searchParams: Promise<Search> }) {
  const perms = await requirePerm("therapy.view");
  const sp = await searchParams;
  const session = await getSession();
  const userId = (session?.user as any)?.id as string;
  const role = (session?.user as any)?.role as string;
  const isLead = role === "ADMIN" || role === "HEAD_THERAPIST";

  const managedCenterIds = role === "HEAD_THERAPIST"
    ? (await prisma.centerMembership.findMany({ where: { userId, role: "HEAD_THERAPIST", status: "ACTIVE" }, select: { centerId: true } })).map((row) => row.centerId)
    : [];
  const selectedHeadCenterIds = sp.headTherapist
    ? (await prisma.centerMembership.findMany({ where: { userId: sp.headTherapist, role: "HEAD_THERAPIST", status: "ACTIVE" }, select: { centerId: true } })).map((row) => row.centerId)
    : null;

  const scope: any = role === "ADMIN" ? {} : role === "HEAD_THERAPIST" ? { centerId: { in: managedCenterIds } } : { therapistId: userId };
  const planWhere: any = { ...scope };
  const and: any[] = [];
  const patient = patientSearchWhere(sp.q);
  if (patient) and.push({ patient });
  if (sp.status && sp.status in PLAN_STATUS) planWhere.status = sp.status;
  if (sp.type && sp.type in THERAPY) planWhere.therapyType = sp.type;
  const centerId = Number(sp.center);
  if (sp.center && Number.isInteger(centerId)) and.push({ centerId });
  const hallId = Number(sp.hall);
  if (sp.hall && Number.isInteger(hallId)) planWhere.hallId = hallId;
  if (isLead && sp.therapist) planWhere.therapistId = sp.therapist;
  if (selectedHeadCenterIds) and.push({ centerId: { in: selectedHeadCenterIds } });
  if (and.length) planWhere.AND = and;

  const [plans, accepted, centers, halls, therapists, headTherapists, load] = await Promise.all([
    prisma.treatmentPlan.findMany({
      where: planWhere,
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, center: true, therapist: { select: { fullName: true } }, specialistDoctor: { select: { fullName: true } }, hall: true, sessions: true, periodicEvaluations: { orderBy: { evaluatedAt: "asc" } } },
      orderBy: [{ status: "asc" }, { expectedEndDate: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.referralRequest.findMany({
      where: { status: "ACCEPTED", destinationScope: "INTERNAL_CENTER", treatmentPlan: null, destinationCenter: { is: { active: true } }, ...(role === "ADMIN" ? {} : { destinationCenterId: { in: managedCenterIds } }) },
      include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, destinationCenter: true },
      orderBy: { acceptedAt: "asc" },
      take: 80,
    }),
    prisma.center.findMany({ where: { active: true, ...(role === "HEAD_THERAPIST" ? { id: { in: managedCenterIds } } : {}) }, orderBy: { name: "asc" } }),
    activeCenterHallOptions(prisma),
    isLead ? prisma.user.findMany({ where: { isActive: true, role: { in: ["THERAPIST", "HEAD_THERAPIST"] } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }) : Promise.resolve([]),
    role === "ADMIN" ? prisma.user.findMany({ where: { isActive: true, centerMemberships: { some: { role: "HEAD_THERAPIST", status: "ACTIVE" } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }) : Promise.resolve([]),
    isLead
      ? prisma.user.findMany({
          where: { role: "THERAPIST", isActive: true, ...(role === "ADMIN" ? {} : { centerMemberships: { some: { centerId: { in: managedCenterIds }, role: "THERAPIST", status: "ACTIVE" } } }) },
          include: { centerMemberships: { where: { status: "ACTIVE", role: "THERAPIST" }, include: { center: true } }, _count: { select: { therapyPlansAssigned: { where: { status: "ACTIVE" } }, therapyAppointmentsAssigned: { where: { status: "SCHEDULED" } } } } },
          orderBy: { fullName: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const due = (plans as any[]).filter((plan) => evaluationDue(plan));
  const visibleHalls = (halls as any[]).filter((hall) => !sp.center || String(hall.centerId) === sp.center);
  const uniqueHalls = Array.from(new Map(visibleHalls.map((hall) => [hall.hallId, hall])).values());
  const activeCount = [sp.status, sp.type, sp.center, sp.therapist, sp.headTherapist, sp.hall].filter(Boolean).length;

  const suggestedIds = [...new Set((accepted as any[]).map((row) => row.suggestedTherapistId).filter(Boolean))] as string[];
  const suggestedNames = new Map((suggestedIds.length ? await prisma.user.findMany({ where: { id: { in: suggestedIds } }, select: { id: true, fullName: true } }) : []).map((user) => [user.id, user.fullName]));

  return (
    <div className="space-y-5">
      <PageHeader title="الخطط العلاجية" subtitle="الإحالات التي تنتظر خطة، وكل الخطط ضمن نطاقك" icon="🏃">
        {perms.has("workload.view") ? <Link href="/workload" className="btn-ghost bg-white text-brand-700">حمل المعالجين</Link> : null}
      </PageHeader>
      <HubTabs nav={THERAPY_CENTERS_NAV} active="plans" label="تبويبات المسار العلاجي والمراكز" perms={perms} />

      {due.length ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-bold text-amber-900">تقييمات دورية مستحقة ({due.length})</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {due.map((plan: any) => <Link key={plan.id} href={`/patients/${plan.patientId}?tab=therapyProgram`} className="rounded bg-white px-3 py-2 text-sm text-amber-900 hover:bg-amber-100">{plan.patient.fullName}، {plan.title}</Link>)}
          </div>
        </section>
      ) : null}

      {isLead || accepted.length ? (
        <section className="card overflow-hidden">
          <h2 className="border-b p-4 font-bold">إحالات مقبولة تنتظر خطة ({accepted.length})</h2>
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead><tr><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الخدمة</th><th className="th">معالج مقترح</th><th className="th">تاريخ القبول</th><th className="th"></th></tr></thead>
              <tbody>
                {(accepted as any[]).map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="td"><Link href={`/patients/${row.patientId}`} className="text-brand-700 hover:underline">{row.patient.fullName}</Link><div className="text-xs text-gray-400">#{row.patient.fileNumber}</div></td>
                    <td className="td">{row.destinationCenter?.name || "—"}</td>
                    <td className="td">{row.requestedService}</td>
                    <td className="td">{row.suggestedTherapistId ? (suggestedNames.get(row.suggestedTherapistId) || "—") : <span className="text-xs text-gray-400">يقرر رئيس المعالجين</span>}</td>
                    <td className="td">{fmtDate(row.acceptedAt)}</td>
                    <td className="td"><Link href={`/patients/${row.patientId}?tab=therapyProgram`} className="btn-ghost text-xs">إنشاء البرنامج ←</Link></td>
                  </tr>
                ))}
                {accepted.length === 0 && emptyRow(6, "لا توجد إحالات تنتظر خطة.")}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <FilterBar action="/therapy" query={sp.q} placeholder="اسم المراجع أو رقم الملف…" activeCount={activeCount} clearHref="/therapy">
        <label className="label">الحالة<select name="status" className="input mt-1" defaultValue={sp.status ?? ""}><option value="">كل الحالات</option>{Object.entries(PLAN_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="label">نوع العلاج<select name="type" className="input mt-1" defaultValue={sp.type ?? ""}><option value="">الكل</option>{Object.entries(THERAPY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="label">المركز<select name="center" className="input mt-1" defaultValue={sp.center ?? ""}><option value="">كل المراكز</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
        <label className="label">القاعة<select name="hall" className="input mt-1" defaultValue={sp.hall ?? ""}><option value="">كل القاعات</option>{uniqueHalls.map((hall: any) => <option key={`${hall.centerId}-${hall.resourceId}`} value={hall.hallId}>{hall.hallName}</option>)}</select></label>
        {isLead ? <label className="label">المعالج<select name="therapist" className="input mt-1" defaultValue={sp.therapist ?? ""}><option value="">كل المعالجين</option>{(therapists as any[]).map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label> : null}
        {role === "ADMIN" ? <label className="label">رئيس المعالجين<select name="headTherapist" className="input mt-1" defaultValue={sp.headTherapist ?? ""}><option value="">الكل</option>{(headTherapists as any[]).map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label> : null}
      </FilterBar>

      <section className="card overflow-hidden p-4">
        <h2 className="mb-3 font-bold">الخطط ({plans.length})</h2>
        <PlanTable rows={plans as any[]} />
      </section>

      {isLead && load.length ? (
        <details className="card p-4">
          <summary className="cursor-pointer font-bold">حمل المعالجين قبل الإسناد</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {(load as any[]).map((therapist) => (
              <div key={therapist.id} className="rounded-lg border p-3">
                <div className="font-medium">{therapist.fullName}</div>
                <div className="text-xs text-gray-500">{therapist.centerMemberships.map((membership: any) => membership.center.name).join("، ")}</div>
                <div className="mt-1 text-sm text-gray-600">{therapist._count.therapyPlansAssigned} خطط نشطة، {therapist._count.therapyAppointmentsAssigned} مواعيد قادمة</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
