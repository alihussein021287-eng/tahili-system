import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminIntro, AdminSection, AdminSectionTabs, StatCard } from "@/components/AdminPageSections";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, requireSession } from "@/lib/access";
import { accessibleCenterIds } from "@/lib/center-access";
import { SERVICE_LABELS } from "@/lib/center-workspaces";
import { prisma } from "@/lib/db";
import { baghdadDayRange } from "@/lib/display-utils";
import { ADMISSION, APPT_STATUS, PLAN_STATUS, THERAPY, fmtDate, fmtDateTime, fmtTime } from "@/lib/labels";
import { evaluationDue } from "@/lib/therapy-plan-rules";

export const dynamic = "force-dynamic";

type TherapyCentersTab =
  | "overview"
  | "plans"
  | "sessions"
  | "program"
  | "today"
  | "centers"
  | "beds"
  | "meds"
  | "followup";

const TABS: { key: TherapyCentersTab; label: string; title: string; description: string; perms: string[] }[] = [
  {
    key: "overview",
    label: "نظرة عامة",
    title: "لوحة المسار العلاجي والمراكز",
    description: "ملخص للخطط والجلسات والمراكز والرقود وأدوية الراقدين ضمن الصلاحيات المتاحة.",
    perms: ["therapy.view", "therapy.session.record", "centers.view", "beds.view", "meds.view"],
  },
  {
    key: "plans",
    label: "الخطط العلاجية",
    title: "الخطط العلاجية",
    description: "خطط العلاج الطبيعي والاختصاصات العلاجية مع فلاتر الحالة والمركز والمعالج.",
    perms: ["therapy.view", "clinical.plan", "therapy.plan.manage"],
  },
  {
    key: "sessions",
    label: "الجلسات العلاجية",
    title: "الجلسات العلاجية",
    description: "جلسات العلاج المجدولة حسب اليوم، الحالة، المعالج، المركز، والقاعة.",
    perms: ["therapy.view", "clinical.session", "therapy.session.record"],
  },
  {
    key: "program",
    label: "برنامج العلاج الطبيعي",
    title: "برنامج العلاج الطبيعي",
    description: "الإحالات المقبولة التي تنتظر خطة والبرامج النشطة التي تحتاج متابعة.",
    perms: ["therapy.view"],
  },
  {
    key: "today",
    label: "جلساتي اليوم",
    title: "جلساتي اليوم",
    description: "الجلسات المسندة للمستخدم اليوم في العلاج الطبيعي أو مساحات المراكز.",
    perms: ["therapy.session.record", "centers.sessions.record"],
  },
  {
    key: "centers",
    label: "مساحات المراكز",
    title: "مساحات المراكز",
    description: "المراكز والبرامج والموارد والجلسات القادمة ضمن نطاق العضوية.",
    perms: ["centers.view"],
  },
  {
    key: "beds",
    label: "الرقود والفندقة",
    title: "الرقود والفندقة",
    description: "إشغال الأسرّة والرقود النشط والرقود الذي تجاوز موعد الخروج المتوقع.",
    perms: ["beds.view"],
  },
  {
    key: "meds",
    label: "أدوية الراقدين",
    title: "أدوية الراقدين",
    description: "جرعات اليوم للمرضى الراقدين مع إبراز الجرعات غير المؤشرة كمصروفة.",
    perms: ["meds.view"],
  },
  {
    key: "followup",
    label: "المتابعة والتقييمات",
    title: "المتابعة والتقييمات",
    description: "تقييمات دورية مستحقة، خطط قربت تنتهي، وتقييمات المراكز الحديثة دون عرض الملاحظات الحساسة.",
    perms: ["therapy.view", "therapy.evaluation.periodic", "centers.view"],
  },
];

const CENTER_PROGRAM_STATUS: Record<string, string> = {
  ASSESSMENT: "تقييم",
  ACTIVE: "نشط",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغى",
};

const CENTER_SESSION_STATUS: Record<string, string> = {
  SCHEDULED: "مجدولة",
  ATTENDED: "حضور مسجل",
  COMPLETED: "مكتملة",
  CANCELLED: "ملغاة",
  NO_SHOW: "لم يحضر",
};

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

function badge(children: ReactNode, tone = "bg-gray-100 text-gray-600") {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{children}</span>;
}

function quickLink(href: string, label: string) {
  return <Link href={href} className="btn-ghost bg-white text-brand-700">{label}</Link>;
}

function emptyRow(colSpan: number, text = "لا توجد نتائج مطابقة.") {
  return <tr><td className="td text-center text-gray-400" colSpan={colSpan}>{text}</td></tr>;
}

export default async function TherapyCentersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const perms = await currentPerms();
  const userId = (session.user as any)?.id as string;
  const role = (session.user as any)?.role as string;
  const canTherapy = perms.has("therapy.view");
  const canTherapyRecord = perms.has("therapy.session.record");
  const canCenterView = perms.has("centers.view");
  const canCenterRecord = perms.has("centers.sessions.record");
  const canBeds = perms.has("beds.view");
  const canMeds = perms.has("meds.view");
  const canCentralCenters = perms.has("centers.central.view");

  const visibleTabs = TABS.filter((tab) => hasAny(perms, tab.perms));
  if (!visibleTabs.length) redirect("/");
  const activeTab = normalizeTab(sp.tab, visibleTabs);
  const requestedTab = sp.tab && TABS.some((tab) => tab.key === sp.tab) ? sp.tab : activeTab;
  if (requestedTab !== activeTab) redirect(tabHref(activeTab));

  const navTabs = visibleTabs.map((tab) => ({ key: tab.key, label: tab.label, href: tabHref(tab.key) }));
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

  const centerSessionTodayWhere: any = {
    scheduledAt: { gte: todayStart, lt: todayEnd },
    ...(centerIds ? { centerId: { in: centerIds } } : {}),
    ...(canCentralCenters ? {} : { assignedToId: userId }),
  };

  const admissionWhere: any = { status: "ADMITTED" };
  if (selectedCenterId && !Number.isNaN(selectedCenterId)) admissionWhere.centerId = selectedCenterId;

  const [
    centers,
    halls,
    therapists,
    headTherapists,
    activePlanCount,
    todayTherapySessionCount,
    lateTherapySessionCount,
    admittedCount,
    activeProgramCount,
    pendingMedCount,
    planRows,
    acceptedReferrals,
    therapySessionRows,
    todayTherapyRows,
    centerRows,
    centerProgramRows,
    centerSessionRows,
    centerAssessments,
    rooms,
    admissions,
    medRows,
  ] = await Promise.all([
    canCenterView || canTherapy ? prisma.center.findMany({ where: selectedCenterWhere, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canTherapy ? prisma.therapyHall.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canTherapy ? prisma.user.findMany({ where: { isActive: true, role: { in: ["THERAPIST", "HEAD_THERAPIST"] } }, select: { id: true, fullName: true, role: true }, orderBy: { fullName: "asc" } }) : Promise.resolve([]),
    canTherapy ? prisma.user.findMany({ where: { isActive: true, centerMemberships: { some: { role: "HEAD_THERAPIST", status: "ACTIVE" } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }) : Promise.resolve([]),
    canTherapy ? prisma.treatmentPlan.count({ where: { ...therapyScopeWhere, status: "ACTIVE" } }) : Promise.resolve(0),
    canTherapy || canTherapyRecord ? prisma.appointment.count({ where: todayAppointmentWhere }) : Promise.resolve(0),
    canTherapy || canTherapyRecord ? prisma.appointment.count({ where: lateAppointmentWhere }) : Promise.resolve(0),
    canBeds ? prisma.admission.count({ where: { status: "ADMITTED" } }) : Promise.resolve(0),
    canCenterView ? prisma.centerProgram.count({ where: { ...centerScopeWhere, status: "ACTIVE" } }) : Promise.resolve(0),
    canMeds ? prisma.medDose.count({ where: { date: { gte: todayStart, lt: todayEnd }, given: false } }) : Promise.resolve(0),
    canTherapy
      ? prisma.treatmentPlan.findMany({
          where: planWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, center: true, therapist: { select: { fullName: true } }, specialistDoctor: { select: { fullName: true } }, hall: true, sessions: true, periodicEvaluations: { orderBy: { evaluatedAt: "asc" } } },
          orderBy: [{ status: "asc" }, { expectedEndDate: "asc" }, { createdAt: "desc" }],
          take: 160,
        })
      : Promise.resolve([]),
    canTherapy
      ? prisma.referralRequest.findMany({
          where: { status: "ACCEPTED", destinationScope: "INTERNAL_CENTER", treatmentPlan: null, ...(role === "ADMIN" ? {} : { destinationCenterId: { in: managedCenterIds } }) },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, destinationCenter: true },
          orderBy: { acceptedAt: "asc" },
          take: 80,
        })
      : Promise.resolve([]),
    canTherapy || canTherapyRecord
      ? prisma.appointment.findMany({
          where: therapyAppointmentWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, assignedToUser: { select: { fullName: true } }, session: { include: { plan: { select: { title: true, status: true } }, therapyHall: true, center: true } } },
          orderBy: { scheduledAt: "asc" },
          take: 160,
        })
      : Promise.resolve([]),
    canTherapyRecord
      ? prisma.appointment.findMany({
          where: { scheduledAt: { gte: todayStart, lt: todayEnd }, assignedToId: userId, session: { treatmentPlanId: { not: null } } },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, session: { include: { plan: true, therapyHall: true } } },
          orderBy: { scheduledAt: "asc" },
          take: 80,
        })
      : Promise.resolve([]),
    canCenterView
      ? prisma.center.findMany({
          where: centerIds ? { id: { in: centerIds } } : {},
          include: { _count: { select: { memberships: { where: { status: "ACTIVE" } }, programs: { where: { status: "ACTIVE" } }, resources: true } } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    canCenterView
      ? prisma.centerProgram.findMany({
          where: centerProgramWhere,
          include: { center: true, patient: { select: { id: true, fullName: true, fileNumber: true } }, assignedTo: { select: { fullName: true } }, sessions: { where: { scheduledAt: { gte: now } }, orderBy: { scheduledAt: "asc" }, take: 2 } },
          orderBy: [{ status: "asc" }, { expectedEndDate: "asc" }, { updatedAt: "desc" }],
          take: 120,
        })
      : Promise.resolve([]),
    canCenterRecord || canCenterView
      ? prisma.centerSession.findMany({
          where: centerSessionTodayWhere,
          include: { center: true, patient: { select: { id: true, fullName: true, fileNumber: true } }, program: true, resource: true, assignedTo: { select: { fullName: true } } },
          orderBy: { scheduledAt: "asc" },
          take: 100,
        })
      : Promise.resolve([]),
    canCenterView
      ? prisma.centerAssessment.findMany({
          where: centerAssessmentWhere,
          select: { id: true, kind: true, summary: true, functionalCapacity: true, createdAt: true, patient: { select: { id: true, fullName: true, fileNumber: true } }, program: { select: { serviceType: true, center: { select: { name: true } } } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    canBeds ? prisma.room.findMany({ include: { beds: { orderBy: { label: "asc" } } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canBeds
      ? prisma.admission.findMany({
          where: admissionWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, center: true, room: true, bed: true },
          orderBy: [{ expectedDischargeDate: "asc" }, { admissionDate: "asc" }],
          take: 120,
        })
      : Promise.resolve([]),
    canMeds
      ? prisma.medDose.findMany({
          where: { date: { gte: todayStart, lt: todayEnd } },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } } },
          orderBy: [{ given: "asc" }, { timeLabel: "asc" }],
          take: 140,
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
  const pendingMeds = (medRows as any[]).filter((dose) => !dose.given);

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
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات المسار العلاجي والمراكز" />
      <AdminIntro title={activeInfo.title} description={activeInfo.description}>
        <div className="flex flex-wrap gap-2">
          {canTherapy && quickLink("/therapy", "فتح لوحة الخطط")}
          {canTherapyRecord && quickLink("/therapy/today", "جلسات العلاج اليوم")}
          {canCenterView && quickLink("/centers", "مساحات المراكز")}
          {canBeds && quickLink("/beds", "الرقود والفندقة")}
          {canMeds && quickLink("/meds", "أدوية الراقدين")}
        </div>
      </AdminIntro>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => <StatCard key={card.label} {...card} />)}
      </div>

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

      {activeTab === "plans" && canTherapy && (
        <AdminSection id="plans" title="الخطط العلاجية" description="الفلاتر لا تغير البيانات، وتستخدم نطاق العرض نفسه للوحة العلاج.">
          <PlanFilters sp={sp} centers={centers as any[]} halls={halls as any[]} therapists={therapists as any[]} headTherapists={headTherapists as any[]} />
          <PlanTable rows={planRows as any[]} />
        </AdminSection>
      )}

      {activeTab === "sessions" && (canTherapy || canTherapyRecord) && (
        <AdminSection id="sessions" title="الجلسات العلاجية" description="فلترة جلسات العلاج المجدولة حسب اليوم والحالة والمعالج.">
          <SessionFilters sp={sp} centers={centers as any[]} therapists={therapists as any[]} />
          <TherapySessionTable rows={therapySessionRows as any[]} />
        </AdminSection>
      )}

      {activeTab === "program" && canTherapy && (
        <div className="grid gap-4 xl:grid-cols-2">
          <AdminSection id="accepted-referrals" title="إحالات مقبولة تنتظر خطة" description="مرتبطة ببرنامج العلاج الطبيعي ولا تنقل إجراءات الإحالات.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الخدمة</th><th className="th">تاريخ القبول</th></tr></thead>
                <tbody>
                  {(acceptedReferrals as any[]).map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="td"><Link href={`/patients/${row.patientId}`} className="text-brand-700 hover:underline">{row.patient.fullName}</Link></td>
                      <td className="td">{row.destinationCenter?.name ?? "—"}</td>
                      <td className="td">{row.requestedService}</td>
                      <td className="td">{fmtDate(row.acceptedAt)}</td>
                    </tr>
                  ))}
                  {(acceptedReferrals as any[]).length === 0 && emptyRow(4, "لا توجد إحالات تنتظر خطة.")}
                </tbody>
              </table>
            </div>
            <Link href="/therapy" className="btn-ghost inline-flex">إنشاء أو جدولة خطة من صفحة العلاج</Link>
          </AdminSection>
          <AdminSection id="active-plans" title="برامج علاج فعالة" description="نظرة مختصرة على الخطط النشطة.">
            <PlanTable rows={(planRows as any[]).filter((plan) => plan.status === "ACTIVE").slice(0, 20)} compact />
          </AdminSection>
        </div>
      )}

      {activeTab === "today" && (
        <div className="grid gap-4 xl:grid-cols-2">
          {canTherapyRecord && (
            <AdminSection id="today-therapy" title="جلسات العلاج الطبيعي اليوم" description="الجلسات المسندة للمستخدم الحالي فقط.">
              <TherapySessionTable rows={todayTherapyRows as any[]} />
              <Link href="/therapy/today" className="btn-ghost inline-flex">فتح صفحة التسجيل</Link>
            </AdminSection>
          )}
          {(canCenterRecord || canCenterView) && (
            <AdminSection id="today-centers" title="جلسات المراكز اليوم" description={canCentralCenters ? "جلسات المراكز اليوم ضمن الصلاحية المركزية." : "جلسات المراكز المسندة للمستخدم الحالي."}>
              <CenterSessionTable rows={centerSessionRows as any[]} />
            </AdminSection>
          )}
        </div>
      )}

      {activeTab === "centers" && canCenterView && (
        <AdminSection id="centers" title="مساحات المراكز" description="المراكز المتاحة لك حسب العضوية أو صلاحية العرض المركزي.">
          <div className="grid gap-3 md:grid-cols-3">
            {(centerRows as any[]).map((center) => (
              <article key={center.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <h3 className="font-semibold text-gray-900">{center.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{center._count.programs} برامج نشطة، {center._count.memberships} أعضاء، {center._count.resources} موارد</p>
              </article>
            ))}
            {(centerRows as any[]).length === 0 && <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 md:col-span-3">لا توجد مراكز متاحة.</div>}
          </div>
          <CenterFilters sp={sp} centers={centers as any[]} />
          <CenterProgramTable rows={centerProgramRows as any[]} />
          <div className="flex flex-wrap gap-2"><Link href="/centers" className="btn-ghost">فتح صفحة المراكز</Link><Link href="/centers/reports" className="btn-ghost">تقارير المراكز</Link></div>
        </AdminSection>
      )}

      {activeTab === "beds" && canBeds && (
        <AdminSection id="beds" title="الرقود والفندقة" description="ملخص الإشغال والرقود النشط.">
          <div className="grid gap-3 md:grid-cols-4">
            <StatCard label="إجمالي الأسرّة" value={totalBeds} />
            <StatCard label="مشغولة" value={occupiedBeds} tone="text-amber-700" />
            <StatCard label="متاحة" value={freeBeds} tone="text-emerald-700" />
            <StatCard label="تجاوزت موعد الخروج" value={overdueAdmissions.length} tone="text-red-700" />
          </div>
          <AdmissionsTable rows={admissions as any[]} />
          <Link href="/beds" className="btn-ghost inline-flex">إدارة الرقود والفندقة</Link>
        </AdminSection>
      )}

      {activeTab === "meds" && canMeds && (
        <AdminSection id="meds" title="أدوية الراقدين" description="جرعات اليوم مع إبراز الجرعات غير المصروفة.">
          <MedTable rows={medRows as any[]} />
          <Link href="/meds" className="btn-ghost inline-flex">فتح جدول أدوية الراقدين</Link>
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

function PlanFilters({ sp, centers, halls, therapists, headTherapists }: { sp: Record<string, string | undefined>; centers: any[]; halls: any[]; therapists: any[]; headTherapists: any[] }) {
  return (
    <form action="/therapy-centers" className="grid gap-3 md:grid-cols-4" autoComplete="off">
      <input type="hidden" name="tab" value="plans" />
      <label className="label md:col-span-2">المراجع<input name="q" className="input mt-1" defaultValue={sp.q ?? ""} placeholder="اسم أو رقم ملف" /></label>
      <label className="label">الحالة<select name="planStatus" className="input mt-1" defaultValue={sp.planStatus ?? ""}><option value="">كل الحالات</option>{Object.entries(PLAN_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">نوع العلاج<select name="therapyType" className="input mt-1" defaultValue={sp.therapyType ?? ""}><option value="">الكل</option>{Object.entries(THERAPY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">المركز<select name="center" className="input mt-1" defaultValue={sp.center ?? ""}><option value="">كل المراكز</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
      <label className="label">المعالج<select name="therapist" className="input mt-1" defaultValue={sp.therapist ?? ""}><option value="">كل المعالجين</option>{therapists.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
      <label className="label">رئيس المعالجين<select name="headTherapist" className="input mt-1" defaultValue={sp.headTherapist ?? ""}><option value="">الكل</option>{headTherapists.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
      <label className="label">القاعة<select name="hall" className="input mt-1" defaultValue={sp.hall ?? ""}><option value="">كل القاعات</option>{halls.map((hall) => <option key={hall.id} value={hall.id}>{hall.name}</option>)}</select></label>
      <div className="flex items-end gap-2"><button className="btn-primary">تطبيق</button><Link href="/therapy-centers?tab=plans" className="btn-ghost">مسح</Link></div>
    </form>
  );
}

function SessionFilters({ sp, centers, therapists }: { sp: Record<string, string | undefined>; centers: any[]; therapists: any[] }) {
  return (
    <form action="/therapy-centers" className="grid gap-3 md:grid-cols-4" autoComplete="off">
      <input type="hidden" name="tab" value="sessions" />
      <label className="label">اليوم<input name="sessionDate" type="date" className="input mt-1" defaultValue={sp.sessionDate ?? ""} /></label>
      <label className="label">الحالة<select name="sessionStatus" className="input mt-1" defaultValue={sp.sessionStatus ?? ""}><option value="">كل الحالات</option>{Object.entries(APPT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">المركز<select name="center" className="input mt-1" defaultValue={sp.center ?? ""}><option value="">كل المراكز</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
      <label className="label">المعالج<select name="therapist" className="input mt-1" defaultValue={sp.therapist ?? ""}><option value="">كل المعالجين</option>{therapists.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
      <label className="label md:col-span-2">المراجع<input name="q" className="input mt-1" defaultValue={sp.q ?? ""} placeholder="اسم أو رقم ملف" /></label>
      <div className="flex items-end gap-2 md:col-span-2"><button className="btn-primary">تطبيق</button><Link href="/therapy-centers?tab=sessions" className="btn-ghost">مسح</Link><Link href="/therapy/today" className="btn-ghost">جلساتي اليوم</Link></div>
    </form>
  );
}

function CenterFilters({ sp, centers }: { sp: Record<string, string | undefined>; centers: any[] }) {
  return (
    <form action="/therapy-centers" className="grid gap-3 md:grid-cols-4" autoComplete="off">
      <input type="hidden" name="tab" value="centers" />
      <label className="label">المركز<select name="center" className="input mt-1" defaultValue={sp.center ?? ""}><option value="">كل المراكز</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
      <label className="label">الخدمة<select name="serviceType" className="input mt-1" defaultValue={sp.serviceType ?? ""}><option value="">كل الخدمات</option>{Object.entries(SERVICE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">الحالة<select name="programStatus" className="input mt-1" defaultValue={sp.programStatus ?? ""}><option value="">كل الحالات</option>{Object.entries(CENTER_PROGRAM_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">المراجع<input name="q" className="input mt-1" defaultValue={sp.q ?? ""} placeholder="اسم أو رقم ملف" /></label>
      <div className="flex items-end gap-2 md:col-span-4"><button className="btn-primary">تطبيق</button><Link href="/therapy-centers?tab=centers" className="btn-ghost">مسح</Link></div>
    </form>
  );
}

function PlanTable({ rows, compact }: { rows: any[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">المراجع</th><th className="th">الخطة</th><th className="th">المركز/القاعة</th><th className="th">المعالج</th>{!compact && <th className="th">المدة</th>}<th className="th">الحالة</th><th className="th">تنبيه</th></tr></thead>
        <tbody>
          {rows.map((plan) => {
            const due = evaluationDue(plan);
            const nearEnd = plan.status === "ACTIVE" && plan.expectedEndDate && plan.expectedEndDate < new Date(Date.now() + 7 * 86_400_000);
            return (
              <tr key={plan.id} className={due || nearEnd ? "bg-amber-50/40" : "hover:bg-gray-50"}>
                <td className="td"><Link href={`/patients/${plan.patientId}`} className="font-medium text-brand-700 hover:underline">{plan.patient.fullName}</Link><div className="text-xs text-gray-400">#{plan.patient.fileNumber}</div></td>
                <td className="td"><div className="font-medium">{plan.title}</div><div className="text-xs text-gray-400">{plan.therapyType ? THERAPY[plan.therapyType as keyof typeof THERAPY] : "عام"}</div></td>
                <td className="td">{plan.center?.name ?? "—"}{plan.hall?.name ? <div className="text-xs text-gray-400">{plan.hall.name}</div> : null}</td>
                <td className="td">{plan.therapist?.fullName ?? "—"}{plan.specialistDoctor?.fullName ? <div className="text-xs text-gray-400">الطبيب: {plan.specialistDoctor.fullName}</div> : null}</td>
                {!compact && <td className="td">{fmtDate(plan.startDate)} ← {fmtDate(plan.expectedEndDate)}</td>}
                <td className="td">{badge(PLAN_STATUS[plan.status as keyof typeof PLAN_STATUS] ?? plan.status, plan.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600")}</td>
                <td className="td"><div className="flex flex-wrap gap-1">{due ? badge("تقييم مستحق", "bg-orange-100 text-orange-800") : null}{nearEnd ? badge("قرب الانتهاء", "bg-amber-100 text-amber-800") : null}</div></td>
              </tr>
            );
          })}
          {rows.length === 0 && emptyRow(compact ? 6 : 7)}
        </tbody>
      </table>
    </div>
  );
}

function TherapySessionTable({ rows }: { rows: any[] }) {
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">الخطة</th><th className="th">القاعة/المركز</th><th className="th">المعالج</th><th className="th">الحالة</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.status === "SCHEDULED" && row.scheduledAt < now ? "bg-red-50/40" : "hover:bg-gray-50"}>
              <td className="td">{fmtDateTime(row.scheduledAt)}</td>
              <td className="td"><Link href={`/patients/${row.patientId}`} className="font-medium text-brand-700 hover:underline">{row.patient.fullName}</Link><div className="text-xs text-gray-400">#{row.patient.fileNumber}</div></td>
              <td className="td">{row.session?.plan?.title ?? "جلسة علاج"}{row.session?.plan?.status ? <div className="text-xs text-gray-400">{PLAN_STATUS[row.session.plan.status as keyof typeof PLAN_STATUS] ?? row.session.plan.status}</div> : null}</td>
              <td className="td">{row.session?.therapyHall?.name || row.session?.hall || row.session?.center?.name || "—"}</td>
              <td className="td">{row.assignedToUser?.fullName || row.assignedTo || "—"}</td>
              <td className="td">{badge(APPT_STATUS[row.status as keyof typeof APPT_STATUS] ?? row.status, row.status === "SCHEDULED" ? "bg-sky-50 text-sky-700" : "bg-gray-100 text-gray-600")}</td>
            </tr>
          ))}
          {rows.length === 0 && emptyRow(6, "لا توجد جلسات ضمن النطاق.")}
        </tbody>
      </table>
    </div>
  );
}

function CenterProgramTable({ rows }: { rows: any[] }) {
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الخدمة</th><th className="th">المسؤول</th><th className="th">النهاية المتوقعة</th><th className="th">الحالة</th><th className="th">تنبيه</th></tr></thead>
        <tbody>
          {rows.map((program) => {
            const overdue = program.status === "ACTIVE" && program.expectedEndDate && program.expectedEndDate < now;
            return (
              <tr key={program.id} className={overdue ? "bg-amber-50/50" : "hover:bg-gray-50"}>
                <td className="td"><Link href={`/patients/${program.patientId}`} className="font-medium text-brand-700 hover:underline">{program.patient.fullName}</Link><div className="text-xs text-gray-400">#{program.patient.fileNumber}</div></td>
                <td className="td">{program.center?.name ?? "—"}</td>
                <td className="td">{SERVICE_LABELS[program.serviceType] ?? program.serviceType}</td>
                <td className="td">{program.assignedTo?.fullName ?? "غير مسند"}</td>
                <td className="td">{fmtDate(program.expectedEndDate)}</td>
                <td className="td">{badge(CENTER_PROGRAM_STATUS[program.status] ?? program.status, program.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600")}</td>
                <td className="td">{overdue ? badge("متأخر", "bg-amber-100 text-amber-800") : program.sessions?.[0] ? `جلسة قادمة ${fmtDate(program.sessions[0].scheduledAt)}` : "—"}</td>
              </tr>
            );
          })}
          {rows.length === 0 && emptyRow(7, "لا توجد برامج ضمن الفلاتر.")}
        </tbody>
      </table>
    </div>
  );
}

function CenterSessionTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الخدمة</th><th className="th">المورد</th><th className="th">المسؤول</th><th className="th">الحالة</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              <td className="td">{fmtTime(row.scheduledAt)}</td>
              <td className="td"><Link href={`/patients/${row.patientId}`} className="text-brand-700 hover:underline">{row.patient.fullName}</Link></td>
              <td className="td">{row.center?.name ?? "—"}</td>
              <td className="td">{SERVICE_LABELS[row.program?.serviceType] ?? row.program?.serviceType ?? "—"}</td>
              <td className="td">{row.resource?.name ?? "—"}</td>
              <td className="td">{row.assignedTo?.fullName ?? "—"}</td>
              <td className="td">{badge(CENTER_SESSION_STATUS[row.status] ?? row.status)}</td>
            </tr>
          ))}
          {rows.length === 0 && emptyRow(7, "لا توجد جلسات مراكز اليوم.")}
        </tbody>
      </table>
    </div>
  );
}

function AdmissionsTable({ rows }: { rows: any[] }) {
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">المراجع</th><th className="th">المركز</th><th className="th">الغرفة/السرير</th><th className="th">الدخول</th><th className="th">الخروج المتوقع</th><th className="th">الحالة</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const overdue = row.expectedDischargeDate && row.expectedDischargeDate < now;
            return (
              <tr key={row.id} className={overdue ? "bg-red-50/40" : "hover:bg-gray-50"}>
                <td className="td"><Link href={`/patients/${row.patientId}`} className="font-medium text-brand-700 hover:underline">{row.patient.fullName}</Link><div className="text-xs text-gray-400">#{row.patient.fileNumber}</div></td>
                <td className="td">{row.center?.name ?? "—"}</td>
                <td className="td">{row.room?.name ?? "غير مخصص"}{row.bed?.label ? ` / ${row.bed.label}` : ""}</td>
                <td className="td">{fmtDate(row.admissionDate)}</td>
                <td className="td">{fmtDate(row.expectedDischargeDate)}</td>
                <td className="td">{badge(overdue ? "انتهت المدة" : ADMISSION[row.status as keyof typeof ADMISSION] ?? row.status, overdue ? "bg-red-100 text-red-800" : "bg-amber-50 text-amber-700")}</td>
              </tr>
            );
          })}
          {rows.length === 0 && emptyRow(6, "لا يوجد رقود نشط ضمن النطاق.")}
        </tbody>
      </table>
    </div>
  );
}

function MedTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">الحالة</th><th className="th">المراجع</th><th className="th">الدواء</th><th className="th">الجرعة</th><th className="th">الوقت</th><th className="th">أعطي في</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={!row.given ? "bg-amber-50/50" : "hover:bg-gray-50"}>
              <td className="td">{row.given ? badge("مصروف", "bg-emerald-50 text-emerald-700") : badge("غير مصروف", "bg-amber-100 text-amber-800")}</td>
              <td className="td"><Link href={`/patients/${row.patientId}`} className="font-medium text-brand-700 hover:underline">{row.patient.fullName}</Link><div className="text-xs text-gray-400">#{row.patient.fileNumber}</div></td>
              <td className="td">{row.drug}</td>
              <td className="td">{row.dose || "—"}</td>
              <td className="td">{row.timeLabel}</td>
              <td className="td">{row.givenAt ? fmtTime(row.givenAt) : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && emptyRow(6, "لا توجد جرعات مسجلة اليوم.")}
        </tbody>
      </table>
    </div>
  );
}
