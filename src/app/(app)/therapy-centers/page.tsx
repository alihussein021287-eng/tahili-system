import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminIntro, AdminSection, StatCard } from "@/components/AdminPageSections";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { AdmissionsTable, CenterProgramTable, PlanTable, TherapySessionTable } from "@/components/therapy/TherapyTables";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, requireSession } from "@/lib/access";
import { accessibleCenterIds } from "@/lib/center-access";
import { SERVICE_LABELS } from "@/lib/center-workspaces";
import { prisma } from "@/lib/db";
import { baghdadDayRange } from "@/lib/display-utils";
import { APPT_STATUS, fmtDate } from "@/lib/labels";
import { THERAPY_CENTERS_MOVED, THERAPY_CENTERS_NAV, movedTabUrl } from "@/lib/hub-nav";
import { evaluationDue } from "@/lib/therapy-plan-rules";

export const dynamic = "force-dynamic";

type TherapyCentersTab = "overview" | "sessions" | "followup";

// The overview, the sessions list and the follow-up board live here. Plans, today's sessions,
// centres, beds and meds each have their own page (see THERAPY_CENTERS_NAV).
const TABS: { key: TherapyCentersTab; title: string; description: string; perms: string[] }[] = [
  {
    key: "overview",
    title: "لوحة المسار العلاجي والمراكز",
    description: "ملخص للخطط والجلسات والمراكز والرقود وأدوية الراقدين ضمن الصلاحيات المتاحة.",
    perms: ["therapy.view", "therapy.session.record", "centers.view", "centers.sessions.record", "beds.view", "meds.view"],
  },
  {
    key: "sessions",
    title: "الجلسات العلاجية",
    description: "جلسات العلاج المجدولة حسب اليوم، الحالة، المعالج، المركز، والقاعة.",
    perms: ["therapy.view", "therapy.session.record"],
  },
  {
    key: "followup",
    title: "المتابعة والتقييمات",
    description: "تقييمات دورية مستحقة، خطط قربت تنتهي، وتقييمات المراكز الحديثة دون عرض الملاحظات الحساسة.",
    perms: ["therapy.view", "centers.view"],
  },
];

function hasAny(perms: Set<string>, keys: string[]) {
  return keys.some((key) => perms.has(key));
}

function normalizeTab(raw: string | undefined, visible: typeof TABS): TherapyCentersTab {
  return (visible.some((tab) => tab.key === raw) ? raw : visible[0]?.key) as TherapyCentersTab;
}

function tabHref(key: TherapyCentersTab) {
  return `/therapy-centers?tab=${key}`;
}

function parseDateStart(value?: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function nextDay(date: Date) {
  return new Date(date.getTime() + 86_400_000);
}

function patientSearchWhere(q?: string) {
  const query = q?.trim();
  if (!query) return undefined;
  const asNumber = Number(query);
  return {
    OR: [
      { fullName: { contains: query, mode: "insensitive" } },
      ...(!Number.isNaN(asNumber) ? [{ fileNumber: asNumber }] : []),
    ],
  };
}

function quickLink(href: string, label: string) {
  return <Link href={href} className="btn-ghost bg-white text-brand-700">{label}</Link>;
}

export default async function TherapyCentersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const moved = sp.tab ? movedTabUrl(THERAPY_CENTERS_MOVED, sp.tab, sp) : null;
  if (moved) redirect(moved);
  const perms = await currentPerms();
  const userId = (session.user as any)?.id as string;
  const role = (session.user as any)?.role as string;
  const canTherapy = perms.has("therapy.view");
  const canTherapyRecord = perms.has("therapy.session.record");
  const canCenterView = perms.has("centers.view");
  const canBeds = perms.has("beds.view");
  const canMeds = perms.has("meds.view");

  const visibleTabs = TABS.filter((tab) => hasAny(perms, tab.perms));
  if (!visibleTabs.length) redirect("/");
  const activeTab = normalizeTab(sp.tab, visibleTabs);
  const requestedTab = sp.tab && TABS.some((tab) => tab.key === sp.tab) ? sp.tab : activeTab;
  if (requestedTab !== activeTab) redirect(tabHref(activeTab));

  const activeInfo = TABS.find((tab) => tab.key === activeTab)!;
  const { start: todayStart, end: todayEnd } = baghdadDayRange(new Date());
  const now = new Date();
  const q = (sp.q ?? "").trim();
  const sessionDate = parseDateStart(sp.sessionDate) ?? todayStart;
  const nearEndCutoff = new Date(now.getTime() + 7 * 86_400_000);
  const selectedCenterId = sp.center ? Number(sp.center) : null;
  const selectedHallId = sp.hall ? Number(sp.hall) : null;

  const managedCenterIds =
    role === "HEAD_THERAPIST"
      ? (await prisma.centerMembership.findMany({ where: { userId, role: "HEAD_THERAPIST", status: "ACTIVE" }, select: { centerId: true } })).map((row) => row.centerId)
      : [];
  const selectedHeadCenterIds = sp.headTherapist
    ? (await prisma.centerMembership.findMany({ where: { userId: sp.headTherapist, role: "HEAD_THERAPIST", status: "ACTIVE" }, select: { centerId: true } })).map((row) => row.centerId)
    : null;
  const centerIds = canCenterView ? await accessibleCenterIds() : null;
  const centerScopeWhere = centerIds ? { centerId: { in: centerIds } } : {};

  const therapyScopeWhere: any =
    role === "ADMIN"
      ? {}
      : role === "HEAD_THERAPIST"
        ? { centerId: { in: managedCenterIds } }
        : { therapistId: userId };

  const planWhere: any = { ...therapyScopeWhere };
  const planAnd: any[] = [];
  const patientSearch = patientSearchWhere(q);
  if (patientSearch) planAnd.push({ patient: patientSearch });
  if (sp.planStatus) planWhere.status = sp.planStatus;
  if (sp.therapyType) planWhere.therapyType = sp.therapyType;
  if (selectedCenterId && !Number.isNaN(selectedCenterId)) planAnd.push({ centerId: selectedCenterId });
  if (selectedHallId && !Number.isNaN(selectedHallId)) planWhere.hallId = selectedHallId;
  if ((role === "ADMIN" || role === "HEAD_THERAPIST") && sp.therapist) planWhere.therapistId = sp.therapist;
  if (selectedHeadCenterIds) planAnd.push({ centerId: { in: selectedHeadCenterIds } });
  if (planAnd.length) planWhere.AND = planAnd;

  const appointmentSessionWhere: any = { treatmentPlanId: { not: null } };
  if (role === "HEAD_THERAPIST") appointmentSessionWhere.centerId = { in: managedCenterIds };
  if (selectedCenterId && !Number.isNaN(selectedCenterId)) appointmentSessionWhere.centerId = selectedCenterId;
  const therapyAppointmentWhere: any = {
    scheduledAt: { gte: sessionDate, lt: nextDay(sessionDate) },
    session: appointmentSessionWhere,
  };
  if (role === "THERAPIST") therapyAppointmentWhere.assignedToId = userId;
  if (sp.sessionStatus) therapyAppointmentWhere.status = sp.sessionStatus;
  if ((role === "ADMIN" || role === "HEAD_THERAPIST") && sp.therapist) therapyAppointmentWhere.assignedToId = sp.therapist;
  if (q) therapyAppointmentWhere.patient = patientSearchWhere(q);

  const todayAppointmentWhere: any = {
    scheduledAt: { gte: todayStart, lt: todayEnd },
    session: { treatmentPlanId: { not: null }, ...(role === "HEAD_THERAPIST" ? { centerId: { in: managedCenterIds } } : {}) },
    ...(role === "THERAPIST" ? { assignedToId: userId } : {}),
  };
  const lateAppointmentWhere: any = {
    scheduledAt: { lt: now },
    status: "SCHEDULED",
    session: { treatmentPlanId: { not: null }, ...(role === "HEAD_THERAPIST" ? { centerId: { in: managedCenterIds } } : {}) },
    ...(role === "THERAPIST" ? { assignedToId: userId } : {}),
  };

  const selectedCenterWhere: any = {};
  selectedCenterWhere.active = true;
  if (centerIds) selectedCenterWhere.id = { in: centerIds };
  if (selectedCenterId && !Number.isNaN(selectedCenterId)) {
    selectedCenterWhere.AND = [{ id: selectedCenterId }];
  }

  const centerProgramWhere: any = {};
  const centerProgramAnd: any[] = [];
  if (centerIds) centerProgramAnd.push({ centerId: { in: centerIds } });
  if (selectedCenterId && !Number.isNaN(selectedCenterId)) centerProgramAnd.push({ centerId: selectedCenterId });
  if (centerProgramAnd.length) centerProgramWhere.AND = centerProgramAnd;
  if (sp.programStatus) centerProgramWhere.status = sp.programStatus;
  if (sp.serviceType) centerProgramWhere.serviceType = sp.serviceType;
  if (q) centerProgramWhere.patient = patientSearchWhere(q);
  const centerAssessmentWhere = centerIds ? { program: { centerId: { in: centerIds } } } : {};

  const admissionWhere: any = { status: "ADMITTED" };
  if (selectedCenterId && !Number.isNaN(selectedCenterId)) admissionWhere.centerId = selectedCenterId;

  const [
    centers,
    therapists,
    activePlanCount,
    todayTherapySessionCount,
    lateTherapySessionCount,
    admittedCount,
    activeProgramCount,
    pendingMedCount,
    planRows,
    therapySessionRows,
    centerProgramRows,
    centerAssessments,
    rooms,
    admissions,
  ] = await Promise.all([
    canCenterView || canTherapy ? prisma.center.findMany({ where: selectedCenterWhere, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canTherapy ? prisma.user.findMany({ where: { isActive: true, role: { in: ["THERAPIST", "HEAD_THERAPIST"] } }, select: { id: true, fullName: true, role: true }, orderBy: { fullName: "asc" } }) : Promise.resolve([]),
    canTherapy ? prisma.treatmentPlan.count({ where: { ...therapyScopeWhere, status: "ACTIVE" } }) : Promise.resolve(0),
    canTherapy || canTherapyRecord ? prisma.appointment.count({ where: todayAppointmentWhere }) : Promise.resolve(0),
    canTherapy || canTherapyRecord ? prisma.appointment.count({ where: lateAppointmentWhere }) : Promise.resolve(0),
    canBeds ? prisma.admission.count({ where: { status: "ADMITTED" } }) : Promise.resolve(0),
    canCenterView ? prisma.centerProgram.count({ where: { ...centerScopeWhere, status: "ACTIVE" } }) : Promise.resolve(0),
    canMeds ? prisma.medDose.count({ where: { date: { gte: todayStart, lt: todayEnd }, given: false } }) : Promise.resolve(0),
    canTherapy && activeTab !== "sessions"
      ? prisma.treatmentPlan.findMany({
          where: planWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, center: true, therapist: { select: { fullName: true } }, specialistDoctor: { select: { fullName: true } }, hall: true, sessions: true, periodicEvaluations: { orderBy: { evaluatedAt: "asc" } } },
          orderBy: [{ status: "asc" }, { expectedEndDate: "asc" }, { createdAt: "desc" }],
          take: 160,
        })
      : Promise.resolve([]),
    (canTherapy || canTherapyRecord) && activeTab !== "followup"
      ? prisma.appointment.findMany({
          where: therapyAppointmentWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, assignedToUser: { select: { fullName: true } }, session: { include: { plan: { select: { title: true, status: true } }, therapyHall: true, center: true } } },
          orderBy: { scheduledAt: "asc" },
          take: 160,
        })
      : Promise.resolve([]),
    canCenterView && activeTab !== "sessions"
      ? prisma.centerProgram.findMany({
          where: centerProgramWhere,
          include: { center: true, patient: { select: { id: true, fullName: true, fileNumber: true } }, assignedTo: { select: { fullName: true } }, sessions: { where: { scheduledAt: { gte: now } }, orderBy: { scheduledAt: "asc" }, take: 2 } },
          orderBy: [{ status: "asc" }, { expectedEndDate: "asc" }, { updatedAt: "desc" }],
          take: 120,
        })
      : Promise.resolve([]),
    canCenterView && activeTab === "followup"
      ? prisma.centerAssessment.findMany({
          where: centerAssessmentWhere,
          select: { id: true, kind: true, summary: true, functionalCapacity: true, createdAt: true, patient: { select: { id: true, fullName: true, fileNumber: true } }, program: { select: { serviceType: true, center: { select: { name: true } } } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    canBeds && activeTab === "overview" ? prisma.room.findMany({ include: { beds: { orderBy: { label: "asc" } } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canBeds && activeTab === "overview"
      ? prisma.admission.findMany({
          where: admissionWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, center: true, room: true, bed: true },
          orderBy: [{ expectedDischargeDate: "asc" }, { admissionDate: "asc" }],
          take: 120,
        })
      : Promise.resolve([]),
  ]);

  const duePlans = (planRows as any[]).filter((plan) => evaluationDue(plan));
  const nearEndPlans = (planRows as any[]).filter((plan) => plan.status === "ACTIVE" && plan.expectedEndDate && plan.expectedEndDate <= nearEndCutoff);
  const overdueAdmissions = (admissions as any[]).filter((admission) => admission.expectedDischargeDate && admission.expectedDischargeDate < now);
  const totalBeds = (rooms as any[]).reduce((sum, room) => sum + (room.capacity ?? room.beds?.length ?? 0), 0);
  const occupiedBeds = (admissions as any[]).filter((admission) => admission.roomId != null).length;
  const freeBeds = Math.max(0, totalBeds - occupiedBeds);
  const dueCenterPrograms = (centerProgramRows as any[]).filter((program) => program.status === "ACTIVE" && program.expectedEndDate && program.expectedEndDate < now);

  const statCards = [
    canTherapy ? { label: "خطط علاجية فعالة", value: activePlanCount, description: "ضمن نطاق العلاج الحالي", tone: "text-brand-700" } : null,
    canTherapy || canTherapyRecord ? { label: "جلسات اليوم", value: todayTherapySessionCount, description: fmtDate(todayStart), tone: "text-sky-700" } : null,
    canTherapy || canTherapyRecord ? { label: "جلسات متأخرة", value: lateTherapySessionCount, description: "مجدولة ولم تكتمل", tone: "text-red-700" } : null,
    canBeds ? { label: "مرضى راقدون", value: admittedCount, description: "رقود نشط", tone: "text-amber-700" } : null,
    canBeds ? { label: "الأسرّة", value: `${occupiedBeds}/${totalBeds}`, description: `${freeBeds} متاح`, tone: "text-indigo-700" } : null,
    canCenterView ? { label: "برامج مراكز فعالة", value: activeProgramCount, description: "حسب العضوية أو العرض المركزي", tone: "text-emerald-700" } : null,
    canTherapy ? { label: "تقييمات دورية مستحقة", value: duePlans.length, description: "ضمن الخطط المعروضة", tone: "text-orange-700" } : null,
    canMeds ? { label: "أدوية راقدين غير مصروفة", value: pendingMedCount, description: "جرعات اليوم", tone: "text-red-700" } : null,
  ].filter(Boolean) as { label: string; value: ReactNode; description?: string; tone?: string }[];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="المسار العلاجي والمراكز" subtitle="صفحة جامعة للعلاج، المراكز، الرقود، وأدوية الراقدين" icon="🏥" />
      <HubTabs nav={THERAPY_CENTERS_NAV} active={activeTab} label="تبويبات المسار العلاجي والمراكز" perms={perms} />
      <AdminIntro title={activeInfo.title} description={activeInfo.description}>
        {activeTab === "overview" ? (
          <div className="flex flex-wrap gap-2">
            {canTherapy && quickLink("/therapy", "فتح لوحة الخطط")}
            {canTherapyRecord && quickLink("/therapy/today", "جلسات العلاج اليوم")}
            {canCenterView && quickLink("/centers", "مساحات المراكز")}
            {canBeds && quickLink("/beds", "الرقود والفندقة")}
            {canMeds && quickLink("/meds", "أدوية الراقدين")}
          </div>
        ) : null}
      </AdminIntro>

      {activeTab === "overview" && statCards.length > 0 ? (
        <section className="space-y-3" aria-labelledby="therapy-summary-title">
          <h2 id="therapy-summary-title" className="font-semibold text-gray-900">ملخص العلاج والمراكز</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {statCards.map((card) => <StatCard key={card.label} {...card} />)}
          </div>
        </section>
      ) : null}

      {activeTab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-2">
          {(canTherapy || canTherapyRecord) && (
            <AdminSection id="overview-sessions" title="جلسات اليوم" description="جلسات علاج طبيعي مجدولة اليوم ضمن نطاق المستخدم.">
              <TherapySessionTable rows={(therapySessionRows as any[]).slice(0, 10)} />
              <Link href="/therapy/today" className="btn-ghost inline-flex">فتح جلسات المعالج اليوم</Link>
            </AdminSection>
          )}
          {canTherapy && (
            <AdminSection id="overview-plans" title="خطط تحتاج متابعة" description="تقييمات دورية مستحقة أو خطط قرب موعد انتهائها.">
              <PlanTable rows={[...duePlans, ...nearEndPlans.filter((plan) => !duePlans.some((due) => due.id === plan.id))].slice(0, 10)} compact />
              <Link href="/therapy" className="btn-ghost inline-flex">فتح برنامج العلاج الطبيعي</Link>
            </AdminSection>
          )}
          {canCenterView && (
            <AdminSection id="overview-centers" title="برامج المراكز" description="برامج نشطة أو قريبة من موعد المتابعة.">
              <CenterProgramTable rows={(centerProgramRows as any[]).slice(0, 10)} />
              <Link href="/centers" className="btn-ghost inline-flex">فتح مساحات المراكز</Link>
            </AdminSection>
          )}
          {canBeds && (
            <AdminSection id="overview-beds" title="الرقود والفندقة" description="الرقود النشط وحالات تجاوز موعد الخروج المتوقع.">
              <AdmissionsTable rows={(overdueAdmissions.length ? overdueAdmissions : admissions as any[]).slice(0, 10)} />
              <Link href="/beds" className="btn-ghost inline-flex">فتح الرقود والفندقة</Link>
            </AdminSection>
          )}
        </div>
      )}

      {activeTab === "sessions" && (canTherapy || canTherapyRecord) && (
        <AdminSection id="sessions" title="الجلسات العلاجية" description="فلترة جلسات العلاج المجدولة حسب اليوم والحالة والمعالج.">
          <SessionFilters sp={sp} centers={centers as any[]} therapists={therapists as any[]} />
          <TherapySessionTable rows={therapySessionRows as any[]} />
        </AdminSection>
      )}

      {activeTab === "followup" && (
        <div className="grid gap-4 xl:grid-cols-2">
          {canTherapy && (
            <AdminSection id="due-evaluations" title="تقييمات دورية مستحقة" description="حسب قواعد تقييم الخطط الموجودة.">
              <PlanTable rows={duePlans} compact />
              <Link href="/therapy" className="btn-ghost inline-flex">فتح لوحة الخطط</Link>
            </AdminSection>
          )}
          {canTherapy && (
            <AdminSection id="near-end-plans" title="خطط قربت تنتهي" description="خطط فعالة تنتهي خلال أسبوع أو أقل.">
              <PlanTable rows={nearEndPlans} compact />
            </AdminSection>
          )}
          {canCenterView && (
            <AdminSection id="due-center-programs" title="برامج مراكز تحتاج متابعة" description="برامج نشطة تجاوزت نهاية متوقعة أو تحتاج إغلاقاً.">
              <CenterProgramTable rows={dueCenterPrograms} />
            </AdminSection>
          )}
          {canCenterView && (
            <AdminSection id="center-assessments" title="تقييمات المراكز الحديثة" description="لا يتم عرض الملاحظات الحساسة هنا.">
              <div className="space-y-2">
                {(centerAssessments as any[]).map((assessment) => (
                  <Link key={assessment.id} href={`/patients/${assessment.patient.id}`} className="block rounded-lg border border-gray-200 bg-white p-3 hover:border-brand-300">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-brand-700">{assessment.patient.fullName} <span className="text-xs text-gray-400">#{assessment.patient.fileNumber}</span></div>
                      <span className="text-xs text-gray-500">{fmtDate(assessment.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{assessment.program.center.name}، {SERVICE_LABELS[assessment.program.serviceType] ?? assessment.program.serviceType}، {assessment.kind}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-500">{assessment.summary || assessment.functionalCapacity || "تقييم بلا ملخص ظاهر"}</p>
                  </Link>
                ))}
                {(centerAssessments as any[]).length === 0 && <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">لا توجد تقييمات حديثة ضمن النطاق.</div>}
              </div>
            </AdminSection>
          )}
        </div>
      )}
    </div>
  );
}

function SessionFilters({ sp, centers, therapists }: { sp: Record<string, string | undefined>; centers: any[]; therapists: any[] }) {
  return (
    <FilterBar action="/therapy-centers" query={sp.q} placeholder="اسم المراجع أو رقم الملف…" activeCount={[sp.sessionDate, sp.sessionStatus, sp.center, sp.therapist].filter(Boolean).length} clearHref="/therapy-centers?tab=sessions" hidden={<input type="hidden" name="tab" value="sessions" />}>
      <label className="label">اليوم<input name="sessionDate" type="date" className="input mt-1" defaultValue={sp.sessionDate ?? ""} /></label>
      <label className="label">الحالة<select name="sessionStatus" className="input mt-1" defaultValue={sp.sessionStatus ?? ""}><option value="">كل الحالات</option>{Object.entries(APPT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">المركز<select name="center" className="input mt-1" defaultValue={sp.center ?? ""}><option value="">كل المراكز</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
      <label className="label">المعالج<select name="therapist" className="input mt-1" defaultValue={sp.therapist ?? ""}><option value="">كل المعالجين</option>{therapists.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
    </FilterBar>
  );
}
