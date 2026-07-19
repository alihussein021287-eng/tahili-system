import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminIntro, AdminSection, AdminSectionTabs, StatCard } from "@/components/AdminPageSections";
import { PageHeader } from "@/components/PageHeader";
import { REFERRAL_STATUS_LABELS } from "@/components/referrals/ReferralStatus";
import { currentPerms, requireSession } from "@/lib/access";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { baghdadDayRange } from "@/lib/display-utils";
import { APPT_STATUS, CASE_TYPE, PATIENT_STATUS, QUEUE_STATUS, fmtDate, fmtDateTime, fmtTime } from "@/lib/labels";
import { normalizeStationName } from "@/lib/stations";

export const dynamic = "force-dynamic";

type PatientsCareTab =
  | "overview"
  | "patients"
  | "new"
  | "visits"
  | "queue"
  | "journey"
  | "referrals"
  | "appointments"
  | "relatives"
  | "alerts";

const TABS: { key: PatientsCareTab; label: string; title: string; description: string; perms: string[] }[] = [
  {
    key: "overview",
    label: "نظرة عامة",
    title: "لوحة المرضى والرعاية",
    description: "ملخص تشغيلي للمراجعين، حضور اليوم، الطابور، مسار الرعاية، الفحوص، والمواعيد.",
    perms: ["patients.view", "visits.view", "queue.view", "journey.view", "referrals.view", "appointments.view"],
  },
  {
    key: "patients",
    label: "المراجعون",
    title: "قائمة المراجعين",
    description: "عرض المراجعين الأساسي مع فلاتر الاسم، رقم الملف، الهاتف، الفرع، المحافظة، ونوع الإصابة.",
    perms: ["patients.view"],
  },
  {
    key: "new",
    label: "تسجيل جديد",
    title: "تسجيل مراجع جديد",
    description: "اختصارات التسجيل والاستيراد وجودة البيانات دون نقل وظيفة صفحة المراجعين الأصلية.",
    perms: ["patients.create", "patients.import"],
  },
  {
    key: "visits",
    label: "زيارات اليوم",
    title: "زيارات وحضور اليوم",
    description: "متابعة الحضور المسجل اليوم والرجوع السريع إلى صفحة الاستعلامات والحضور.",
    perms: ["visits.view"],
  },
  {
    key: "queue",
    label: "الطابور",
    title: "طابور المراجعين",
    description: "الحالات النشطة في طابور اليوم، مع إبراز من دخل الجلسة أو ما زال بالانتظار.",
    perms: ["queue.view"],
  },
  {
    key: "journey",
    label: "مسار الرعاية",
    title: "مسار الرعاية",
    description: "المحطات النشطة في مسار متابعة المراجع دون خلطها مع صفحات العلاج والمراكز.",
    perms: ["journey.view"],
  },
  {
    key: "referrals",
    label: "الفحوص والإحالات",
    title: "الفحوص والإحالات",
    description: "طلبات الفحوص والإحالات وكتب الإرسال والنتائج المرتبطة بالرعاية الأساسية.",
    perms: ["referrals.view"],
  },
  {
    key: "appointments",
    label: "المواعيد",
    title: "المواعيد",
    description: "المواعيد القادمة أو مواعيد يوم محدد مع فلاتر الحالة والمراجع.",
    perms: ["appointments.view"],
  },
  {
    key: "relatives",
    label: "مرافقون وملاحظات",
    title: "المرافقون والملاحظات",
    description: "آخر بيانات ذوي القربى والملاحظات العامة الموجودة في ملفات المراجعين.",
    perms: ["patients.view"],
  },
  {
    key: "alerts",
    label: "تنبيهات ومتابعة",
    title: "تنبيهات الرعاية",
    description: "ملفات ناقصة، إحالات معلقة، طابور نشط، ومحطات متأخرة تحتاج متابعة.",
    perms: ["patients.view", "queue.view", "journey.view", "referrals.view"],
  },
];

const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_SESSION"] as const;
const ACTIVE_STAGE_STATUSES = ["WAITING", "IN_PROGRESS"] as const;
const PENDING_REFERRAL_STATUSES = ["DRAFT", "PENDING_PRINT", "READY", "SENT", "RESULT_RECEIVED"] as const;
const REFERRAL_TYPES = ["LAB", "RADIOLOGY", "IMAGING", "SPECIALIST", "TREATMENT_CENTER", "HOSPITAL", "OTHER"] as const;
const REFERRAL_STATUSES = Object.keys(REFERRAL_STATUS_LABELS);
const APPOINTMENT_STATUSES = Object.keys(APPT_STATUS);
const PATIENT_STATUSES = Object.keys(PATIENT_STATUS);
const CASE_TYPES = Object.keys(CASE_TYPE);

function hasAny(perms: Set<string>, keys: string[]) {
  return keys.some((key) => perms.has(key));
}

function normalizeTab(raw: string | undefined, visible: typeof TABS): PatientsCareTab {
  return (visible.some((tab) => tab.key === raw) ? raw : visible[0]?.key) as PatientsCareTab;
}

function tabHref(key: PatientsCareTab) {
  return `/patients-care?tab=${key}`;
}

function pickAllowed(value: string | undefined, allowed: readonly string[]) {
  return value && allowed.includes(value) ? value : undefined;
}

function positiveInt(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
      { phone: { contains: query } },
      ...(!Number.isNaN(asNumber) ? [{ fileNumber: asNumber }] : []),
    ],
  };
}

function badge(children: ReactNode, tone = "bg-gray-100 text-gray-600") {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{children}</span>;
}

function quickLink(href: string, label: string) {
  return (
    <Link href={href} className="btn-ghost bg-white text-brand-700">
      {label}
    </Link>
  );
}

function emptyRow(colSpan: number, text = "لا توجد نتائج مطابقة.") {
  return (
    <tr>
      <td className="td text-center text-gray-400" colSpan={colSpan}>
        {text}
      </td>
    </tr>
  );
}

export default async function PatientsCarePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession();
  const sp = await searchParams;
  const perms = await currentPerms();
  const userBranch = await currentUserBranch();
  const canPatients = perms.has("patients.view");
  const canPatientCreate = perms.has("patients.create");
  const canPatientImport = perms.has("patients.import");
  const canPatientExport = perms.has("patients.export");
  const canVisits = perms.has("visits.view");
  const canQueue = perms.has("queue.view");
  const canJourney = perms.has("journey.view");
  const canReferrals = perms.has("referrals.view");
  const canAppointments = perms.has("appointments.view");

  const visibleTabs = TABS.filter((tab) => hasAny(perms, tab.perms));
  if (!visibleTabs.length) redirect("/");
  const activeTab = normalizeTab(sp.tab, visibleTabs);
  const requestedTab = sp.tab && TABS.some((tab) => tab.key === sp.tab) ? sp.tab : activeTab;
  if (requestedTab !== activeTab) redirect(tabHref(activeTab));

  const activeInfo = TABS.find((tab) => tab.key === activeTab)!;
  const navTabs = visibleTabs.map((tab) => ({ key: tab.key, label: tab.label, href: tabHref(tab.key) }));
  const { start: todayStart, end: todayEnd } = baghdadDayRange(new Date());
  const now = new Date();
  const monthStart = new Date(todayStart);
  monthStart.setUTCDate(1);
  const delayedCutoff = new Date(now.getTime() - 86_400_000);
  const activeBranchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const q = (sp.q ?? "").trim();
  const lastVisitFrom = parseDateStart(sp.lastVisitFrom);
  const lastVisitTo = parseDateStart(sp.lastVisitTo);
  const visitDate = parseDateStart(sp.visitDate) ?? todayStart;
  const appointmentDate = parseDateStart(sp.appointmentDate);
  const patientStatus = pickAllowed(sp.patientStatus, PATIENT_STATUSES);
  const caseType = pickAllowed(sp.caseType, CASE_TYPES);
  const governorateId = positiveInt(sp.gov);
  const districtId = positiveInt(sp.district);
  const injuryTypeId = positiveInt(sp.injury);
  const referralStatus = pickAllowed(sp.referralStatus, REFERRAL_STATUSES);
  const referralType = pickAllowed(sp.referralType, REFERRAL_TYPES);
  const appointmentStatus = pickAllowed(sp.appointmentStatus, APPOINTMENT_STATUSES);

  const basePatientWhere: any = { archivedAt: null };
  if (activeBranchId) basePatientWhere.branchId = activeBranchId;

  const filteredPatientWhere: any = { ...basePatientWhere };
  const patientSearch = patientSearchWhere(q);
  if (patientSearch) Object.assign(filteredPatientWhere, patientSearch);
  if (patientStatus) filteredPatientWhere.status = patientStatus;
  if (governorateId) filteredPatientWhere.governorateId = governorateId;
  if (districtId) filteredPatientWhere.districtId = districtId;
  if (injuryTypeId) filteredPatientWhere.injuryTypeId = injuryTypeId;
  if (caseType) filteredPatientWhere.caseType = caseType;
  if (lastVisitFrom || lastVisitTo) {
    filteredPatientWhere.visits = {
      some: {
        visitDate: {
          ...(lastVisitFrom ? { gte: lastVisitFrom } : {}),
          ...(lastVisitTo ? { lt: nextDay(lastVisitTo) } : {}),
        },
      },
    };
  }

  const incompleteWhere: any = {
    ...basePatientWhere,
    OR: [
      { phone: null },
      { phone: "" },
      { governorateId: null },
      { injuryTypeId: null },
      { caseType: null },
      { branchId: null },
    ],
  };

  const referralWhere: any = {};
  if (referralStatus) referralWhere.status = referralStatus;
  else referralWhere.status = { in: [...PENDING_REFERRAL_STATUSES] };
  if (referralType) referralWhere.type = referralType;
  if (q) {
    referralWhere.OR = [
      { requestedService: { contains: q, mode: "insensitive" } },
      { externalEntity: { contains: q, mode: "insensitive" } },
      { patient: { fullName: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (activeBranchId) referralWhere.patient = { branchId: activeBranchId };

  const appointmentWhere: any = {};
  if (appointmentDate) appointmentWhere.scheduledAt = { gte: appointmentDate, lt: nextDay(appointmentDate) };
  else appointmentWhere.scheduledAt = { gte: todayStart };
  if (appointmentStatus) appointmentWhere.status = appointmentStatus;
  if (q) {
    const asNumber = Number(q);
    appointmentWhere.patient = Number.isNaN(asNumber)
      ? { fullName: { contains: q, mode: "insensitive" } }
      : { OR: [{ fileNumber: asNumber }, { fullName: { contains: q, mode: "insensitive" } }] };
  }
  if (activeBranchId) {
    const existing = appointmentWhere.patient;
    appointmentWhere.patient = existing ? { AND: [existing, { branchId: activeBranchId }] } : { branchId: activeBranchId };
  }

  const [
    branches,
    governorates,
    districts,
    injuryTypes,
    totalPatients,
    newPatientsThisMonth,
    todayVisitsCount,
    queueCount,
    inSessionQueueCount,
    activeStageCount,
    pendingReferralCount,
    incompleteCount,
    patientRows,
    todayVisits,
    queueRows,
    stageRows,
    delayedStages,
    referralRows,
    appointmentRows,
    relativeRows,
    noteRows,
    incompleteRows,
  ] = await Promise.all([
    canPatients ? prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canPatients ? prisma.governorate.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    canPatients ? prisma.district.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    canPatients ? prisma.injuryType.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
    canPatients ? prisma.patient.count({ where: basePatientWhere }) : Promise.resolve(0),
    canPatients ? prisma.patient.count({ where: { ...basePatientWhere, registrationDate: { gte: monthStart } } }) : Promise.resolve(0),
    canVisits ? prisma.visit.count({ where: { visitDate: { gte: todayStart, lt: todayEnd }, ...(activeBranchId ? { patient: { branchId: activeBranchId } } : {}) } }) : Promise.resolve(0),
    canQueue ? prisma.queueEntry.count({ where: { createdAt: { gte: todayStart, lt: todayEnd }, status: { in: [...ACTIVE_QUEUE_STATUSES] }, ...(activeBranchId ? { patient: { branchId: activeBranchId } } : {}) } }) : Promise.resolve(0),
    canQueue ? prisma.queueEntry.count({ where: { createdAt: { gte: todayStart, lt: todayEnd }, status: "IN_SESSION", ...(activeBranchId ? { patient: { branchId: activeBranchId } } : {}) } }) : Promise.resolve(0),
    canJourney ? prisma.careStage.count({ where: { status: { in: [...ACTIVE_STAGE_STATUSES] }, patient: basePatientWhere } }) : Promise.resolve(0),
    canReferrals ? prisma.referralRequest.count({ where: { status: { in: [...PENDING_REFERRAL_STATUSES] }, ...(activeBranchId ? { patient: { branchId: activeBranchId } } : {}) } }) : Promise.resolve(0),
    canPatients ? prisma.patient.count({ where: incompleteWhere }) : Promise.resolve(0),
    canPatients
      ? prisma.patient.findMany({
          where: filteredPatientWhere,
          include: {
            governorate: true,
            district: true,
            branch: true,
            injuryType: true,
            visits: { orderBy: { visitDate: "desc" }, take: 1 },
            queueEntries: { where: { createdAt: { gte: todayStart, lt: todayEnd }, status: { in: [...ACTIVE_QUEUE_STATUSES] } }, orderBy: { createdAt: "desc" }, take: 1 },
            referralRequests: { where: { status: { in: [...PENDING_REFERRAL_STATUSES] } }, orderBy: { createdAt: "desc" }, take: 1 },
            careStages: { where: { status: { in: [...ACTIVE_STAGE_STATUSES] } }, orderBy: { sequence: "asc" }, take: 1 },
            _count: { select: { visits: true, appointments: true, referralRequests: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
    canVisits
      ? prisma.visit.findMany({
          where: { visitDate: { gte: visitDate, lt: nextDay(visitDate) }, ...(activeBranchId ? { patient: { branchId: activeBranchId } } : {}) },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true, branch: { select: { name: true } } } } },
          orderBy: { visitDate: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
    canQueue
      ? prisma.queueEntry.findMany({
          where: { createdAt: { gte: todayStart, lt: todayEnd }, status: { in: [...ACTIVE_QUEUE_STATUSES] }, ...(activeBranchId ? { patient: { branchId: activeBranchId } } : {}) },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, center: { select: { name: true } } },
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
          take: 120,
        })
      : Promise.resolve([]),
    canJourney
      ? prisma.careStage.findMany({
          where: { status: { in: [...ACTIVE_STAGE_STATUSES] }, patient: basePatientWhere },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } } },
          orderBy: [{ updatedAt: "desc" }, { sequence: "asc" }],
          take: 120,
        })
      : Promise.resolve([]),
    canJourney
      ? prisma.careStage.findMany({
          where: { status: { in: [...ACTIVE_STAGE_STATUSES] }, updatedAt: { lt: delayedCutoff }, patient: basePatientWhere },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } } },
          orderBy: { updatedAt: "asc" },
          take: 20,
        })
      : Promise.resolve([]),
    canReferrals
      ? prisma.referralRequest.findMany({
          where: referralWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true, branch: { select: { name: true } } } }, destinationCenter: { select: { name: true } }, assignedReviewer: { select: { fullName: true } } },
          orderBy: { createdAt: "desc" },
          take: 120,
        })
      : Promise.resolve([]),
    canAppointments
      ? prisma.appointment.findMany({
          where: appointmentWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true, branch: { select: { name: true } } } }, assignedToUser: { select: { fullName: true } }, session: { select: { hall: true } } },
          orderBy: { scheduledAt: "asc" },
          take: 120,
        })
      : Promise.resolve([]),
    canPatients
      ? prisma.relative.findMany({
          where: { patient: basePatientWhere },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } } },
          orderBy: { createdAt: "desc" },
          take: 80,
        })
      : Promise.resolve([]),
    canPatients
      ? prisma.patient.findMany({
          where: { ...basePatientWhere, notes: { not: null } },
          select: { id: true, fullName: true, fileNumber: true, notes: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 40,
        })
      : Promise.resolve([]),
    canPatients
      ? prisma.patient.findMany({
          where: incompleteWhere,
          include: { branch: true, governorate: true, injuryType: true },
          orderBy: { updatedAt: "desc" },
          take: 40,
        })
      : Promise.resolve([]),
  ]);

  const statCards = [
    canPatients ? { label: "إجمالي المراجعين", value: totalPatients, description: activeBranchId ? "ضمن الفرع الحالي" : "كل الفروع", tone: "text-brand-700" } : null,
    canPatients ? { label: "مراجعون جدد هذا الشهر", value: newPatientsThisMonth, description: "حسب تاريخ التسجيل", tone: "text-emerald-700" } : null,
    canVisits ? { label: "زيارات اليوم", value: todayVisitsCount, description: fmtDate(todayStart), tone: "text-sky-700" } : null,
    canQueue ? { label: "في الطابور", value: queueCount, description: "بالانتظار أو داخل الجلسة", tone: "text-amber-700" } : null,
    canQueue || canJourney ? { label: "قيد المعالجة", value: inSessionQueueCount + activeStageCount, description: "جلسة حالية أو مسار مفتوح", tone: "text-indigo-700" } : null,
    canReferrals ? { label: "إحالات أو فحوص معلقة", value: pendingReferralCount, description: "لم تصل للإنهاء بعد", tone: "text-orange-700" } : null,
    canPatients ? { label: "ملفات بياناتها ناقصة", value: incompleteCount, description: "هاتف أو موقع أو إصابة أو فرع", tone: "text-red-700" } : null,
  ].filter(Boolean) as { label: string; value: ReactNode; description?: string; tone?: string }[];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="المرضى والرعاية" subtitle="صفحة جامعة للمراجعين والرعاية الأساسية" icon="🧑‍⚕️" />
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات المرضى والرعاية" />
      <AdminIntro title={activeInfo.title} description={activeInfo.description}>
        <div className="flex flex-wrap gap-2">
          {canPatientCreate && quickLink("/patients/new", "إضافة مراجع")}
          {canVisits && quickLink("/visits", "تسجيل حضور")}
          {canQueue && quickLink("/queue", "فتح الطابور")}
          {canJourney && quickLink("/care-board", "فتح لوحة الرعاية")}
          {canPatients && quickLink("/patients", "قائمة المراجعين")}
        </div>
      </AdminIntro>

      {userBranch?.branch?.name && canPatients ? (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800">
          {activeBranchId ? `البيانات مفلترة افتراضياً حسب فرعك: ${userBranch.branch.name}` : "تعرض كل الفروع حالياً"}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-2">
          {canVisits && (
            <AdminSection id="overview-visits" title="حضور اليوم" description="آخر الزيارات المسجلة اليوم">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">الفرع</th><th className="th">ملاحظات</th></tr>
                  </thead>
                  <tbody>
                    {todayVisits.slice(0, 10).map((visit: any) => (
                      <tr key={visit.id} className="hover:bg-gray-50">
                        <td className="td">{fmtTime(visit.visitDate)}</td>
                        <td className="td"><Link href={`/patients/${visit.patientId}`} className="text-brand-700 hover:underline">{visit.patient.fullName}</Link></td>
                        <td className="td">{visit.patient.branch?.name ?? "بدون فرع"}</td>
                        <td className="td">{visit.notes ?? "—"}</td>
                      </tr>
                    ))}
                    {todayVisits.length === 0 && emptyRow(4, "لا يوجد حضور مسجل اليوم.")}
                  </tbody>
                </table>
              </div>
              <Link href="/visits" className="btn-ghost inline-flex">فتح سجل الحضور</Link>
            </AdminSection>
          )}
          {canQueue && (
            <AdminSection id="overview-queue" title="الطابور الحالي" description="المراجعون الموجودون في طابور اليوم">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr><th className="th">الحالة</th><th className="th">المراجع</th><th className="th">القاعة</th><th className="th">منذ</th></tr>
                  </thead>
                  <tbody>
                    {queueRows.slice(0, 10).map((entry: any) => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="td">{badge(QUEUE_STATUS[entry.status as keyof typeof QUEUE_STATUS] ?? entry.status, entry.status === "IN_SESSION" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700")}</td>
                        <td className="td"><Link href={`/patients/${entry.patientId}`} className="text-brand-700 hover:underline">{entry.patient.fullName}</Link></td>
                        <td className="td">{entry.hall || entry.center?.name || "—"}</td>
                        <td className="td">{fmtTime(entry.createdAt)}</td>
                      </tr>
                    ))}
                    {queueRows.length === 0 && emptyRow(4, "لا يوجد طابور نشط حالياً.")}
                  </tbody>
                </table>
              </div>
              <Link href="/queue" className="btn-ghost inline-flex">فتح الطابور</Link>
            </AdminSection>
          )}
          {canReferrals && (
            <AdminSection id="overview-referrals" title="فحوص وإحالات معلقة" description="طلبات تحتاج طباعة أو إرسال أو نتيجة أو مراجعة">
              <ReferralTable rows={referralRows.slice(0, 8)} />
              <Link href="/referrals" className="btn-ghost inline-flex">فتح الفحوص والإحالات</Link>
            </AdminSection>
          )}
          {canPatients && (
            <AdminSection id="overview-incomplete" title="ملفات ناقصة" description="مؤشرات جودة بيانات تحتاج إكمال">
              <IncompleteTable rows={incompleteRows.slice(0, 8)} />
              <Link href="/patients/data-quality" className="btn-ghost inline-flex">فتح جودة البيانات</Link>
            </AdminSection>
          )}
        </div>
      )}

      {activeTab === "patients" && canPatients && (
        <AdminSection id="patients" title="المراجعون" description="هذه قائمة عرض مختصرة. صفحة /patients تبقى القائمة التشغيلية الأساسية.">
          <PatientFilters
            sp={sp}
            branches={branches}
            governorates={governorates}
            districts={districts}
            injuryTypes={injuryTypes}
            activeBranchId={activeBranchId}
            patientStatus={patientStatus}
            caseType={caseType}
            governorateId={governorateId}
            districtId={districtId}
            injuryTypeId={injuryTypeId}
          />
          <PatientTable rows={patientRows} />
        </AdminSection>
      )}

      {activeTab === "new" && (
        <AdminSection id="new" title="تسجيل جديد" description="روابط التسجيل والاستيراد وجودة البيانات حسب الصلاحيات المتاحة.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {canPatientCreate && <ActionCard href="/patients/new" title="إضافة مراجع" description="فتح استمارة التسجيل الكاملة." />}
            {canPatientImport && <ActionCard href="/patients/import" title="استيراد جماعي" description="رفع CSV مع معاينة قبل الحفظ." />}
            {canPatients && <ActionCard href="/patients/data-quality" title="جودة البيانات" description="مراجعة الملفات التي تحتاج إكمال." />}
            {canPatientExport && <ActionCard href="/api/export/full" title="تصدير شامل" description="تصدير البيانات المتاحة حسب الصلاحية." external />}
          </div>
          {canPatients && <PatientTable rows={patientRows.slice(0, 12)} compactTitle="آخر ملفات ظاهرة ضمن الفلاتر" />}
        </AdminSection>
      )}

      {activeTab === "visits" && canVisits && (
        <AdminSection id="visits" title="زيارات اليوم" description="فلتر حسب يوم محدد، مع رابط مباشر إلى صفحة تسجيل الحضور.">
          <form action="/patients-care" className="grid gap-3 md:grid-cols-4">
            <input type="hidden" name="tab" value="visits" />
            <label className="label">اليوم<input name="visitDate" type="date" className="input mt-1" defaultValue={sp.visitDate ?? ""} /></label>
            <label className="label md:col-span-2">بحث عام<input name="q" className="input mt-1" defaultValue={sp.q ?? ""} placeholder="اسم، هاتف، أو رقم ملف" /></label>
            <div className="flex items-end gap-2"><button className="btn-primary">تطبيق</button><Link href="/patients-care?tab=visits" className="btn-ghost">مسح</Link></div>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">رقم الملف</th><th className="th">الفرع</th><th className="th">ملاحظات</th></tr></thead>
              <tbody>
                {todayVisits.map((visit: any) => (
                  <tr key={visit.id} className="hover:bg-gray-50">
                    <td className="td">{fmtDateTime(visit.visitDate)}</td>
                    <td className="td"><Link href={`/patients/${visit.patientId}`} className="text-brand-700 hover:underline">{visit.patient.fullName}</Link></td>
                    <td className="td">#{visit.patient.fileNumber}</td>
                    <td className="td">{visit.patient.branch?.name ?? "بدون فرع"}</td>
                    <td className="td">{visit.notes ?? "—"}</td>
                  </tr>
                ))}
                {todayVisits.length === 0 && emptyRow(5, "لا توجد زيارات في اليوم المحدد.")}
              </tbody>
            </table>
          </div>
          <Link href="/visits" className="btn-ghost inline-flex">تسجيل أو استعلام حضور</Link>
        </AdminSection>
      )}

      {activeTab === "queue" && canQueue && (
        <AdminSection id="queue" title="الطابور" description="الحالات النشطة في طابور اليوم فقط.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">الحالة</th><th className="th">المراجع</th><th className="th">رقم الملف</th><th className="th">القاعة/المركز</th><th className="th">الدخول</th><th className="th">ملاحظة</th></tr></thead>
              <tbody>
                {queueRows.map((entry: any) => (
                  <tr key={entry.id} className={entry.status === "IN_SESSION" ? "bg-amber-50/50" : "hover:bg-gray-50"}>
                    <td className="td">{badge(QUEUE_STATUS[entry.status as keyof typeof QUEUE_STATUS] ?? entry.status, entry.status === "IN_SESSION" ? "bg-amber-100 text-amber-800" : "bg-sky-50 text-sky-700")}</td>
                    <td className="td"><Link href={`/patients/${entry.patientId}`} className="text-brand-700 hover:underline">{entry.patient.fullName}</Link></td>
                    <td className="td">#{entry.patient.fileNumber}</td>
                    <td className="td">{entry.hall || entry.center?.name || "—"}</td>
                    <td className="td">{fmtTime(entry.createdAt)}</td>
                    <td className="td">{entry.note ?? "—"}</td>
                  </tr>
                ))}
                {queueRows.length === 0 && emptyRow(6, "لا يوجد طابور نشط حالياً.")}
              </tbody>
            </table>
          </div>
          <Link href="/queue" className="btn-ghost inline-flex">إدارة الطابور</Link>
        </AdminSection>
      )}

      {activeTab === "journey" && canJourney && (
        <AdminSection id="journey" title="مسار الرعاية" description="المحطات المفتوحة للمراجعين حسب صفحة لوحة الرعاية.">
          <StageTable rows={stageRows} />
          <Link href="/care-board" className="btn-ghost inline-flex">فتح لوحة المرضى حسب المحطة</Link>
        </AdminSection>
      )}

      {activeTab === "referrals" && canReferrals && (
        <AdminSection id="referrals" title="الفحوص والإحالات" description="فلترة طلبات الفحص أو الإحالة حسب الحالة والنوع.">
          <form action="/patients-care" className="grid gap-3 md:grid-cols-4" autoComplete="off">
            <input type="hidden" name="tab" value="referrals" />
            <label className="label md:col-span-2">بحث<input name="q" className="input mt-1" defaultValue={sp.q ?? ""} placeholder="اسم المراجع أو الجهة أو الخدمة" /></label>
            <label className="label">الحالة<select name="referralStatus" className="input mt-1" defaultValue={referralStatus ?? ""}><option value="">المعلقة</option>{Object.entries(REFERRAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="label">النوع<select name="referralType" className="input mt-1" defaultValue={referralType ?? ""}><option value="">كل الأنواع</option>{REFERRAL_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <div className="flex gap-2 md:col-span-4"><button className="btn-primary">تطبيق الفلاتر</button><Link href="/patients-care?tab=referrals" className="btn-ghost">مسح</Link><Link href="/referrals" className="btn-ghost">فتح الصفحة الأصلية</Link></div>
          </form>
          <ReferralTable rows={referralRows} />
        </AdminSection>
      )}

      {activeTab === "appointments" && canAppointments && (
        <AdminSection id="appointments" title="المواعيد" description="المواعيد القادمة افتراضياً، أو يوم محدد عند اختيار تاريخ.">
          <form action="/patients-care" className="grid gap-3 md:grid-cols-4" autoComplete="off">
            <input type="hidden" name="tab" value="appointments" />
            <label className="label">اليوم<input name="appointmentDate" type="date" className="input mt-1" defaultValue={sp.appointmentDate ?? ""} /></label>
            <label className="label">الحالة<select name="appointmentStatus" className="input mt-1" defaultValue={appointmentStatus ?? ""}><option value="">كل الحالات</option>{Object.entries(APPT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="label md:col-span-2">المراجع<input name="q" className="input mt-1" defaultValue={sp.q ?? ""} placeholder="اسم أو رقم ملف" /></label>
            <div className="flex gap-2 md:col-span-4"><button className="btn-primary">تطبيق الفلاتر</button><Link href="/patients-care?tab=appointments" className="btn-ghost">مسح</Link><Link href="/appointments" className="btn-ghost">فتح المواعيد</Link></div>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">الموعد</th><th className="th">المراجع</th><th className="th">النوع</th><th className="th">المسؤول</th><th className="th">الحالة</th></tr></thead>
              <tbody>
                {appointmentRows.map((appointment: any) => (
                  <tr key={appointment.id} className={appointment.status === "SCHEDULED" && appointment.scheduledAt < now ? "bg-amber-50/50" : "hover:bg-gray-50"}>
                    <td className="td">{fmtDateTime(appointment.scheduledAt)}</td>
                    <td className="td"><Link href={`/patients/${appointment.patientId}`} className="text-brand-700 hover:underline">{appointment.patient.fullName}</Link></td>
                    <td className="td">{appointment.type || appointment.session?.hall || "موعد"}</td>
                    <td className="td">{appointment.assignedToUser?.fullName || appointment.assignedTo || "—"}</td>
                    <td className="td">{badge(APPT_STATUS[appointment.status as keyof typeof APPT_STATUS] ?? appointment.status, appointment.status === "SCHEDULED" ? "bg-sky-50 text-sky-700" : "bg-gray-100 text-gray-600")}</td>
                  </tr>
                ))}
                {appointmentRows.length === 0 && emptyRow(5, "لا توجد مواعيد ضمن الفلاتر.")}
              </tbody>
            </table>
          </div>
        </AdminSection>
      )}

      {activeTab === "relatives" && canPatients && (
        <div className="grid gap-4 xl:grid-cols-2">
          <AdminSection id="relatives" title="مرافقون وذوو قربى" description="آخر سجلات ذوي القربى المثبتة في الملفات.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="th">المراجع</th><th className="th">القريب/المرافق</th><th className="th">الوظيفة</th><th className="th">آخر تحديث</th></tr></thead>
                <tbody>
                  {relativeRows.map((row: any) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="td"><Link href={`/patients/${row.patientId}`} className="text-brand-700 hover:underline">{row.patient.fullName}</Link></td>
                      <td className="td">{row.name || "—"}</td>
                      <td className="td">{row.job || row.workplace || "—"}</td>
                      <td className="td">{fmtDate(row.createdAt)}</td>
                    </tr>
                  ))}
                  {relativeRows.length === 0 && emptyRow(4, "لا توجد سجلات مرافقين ضمن الفلاتر.")}
                </tbody>
              </table>
            </div>
          </AdminSection>
          <AdminSection id="notes" title="ملاحظات عامة" description="ملاحظات عامة من ملف المراجع دون عرض تفاصيل علاجية حساسة.">
            <div className="space-y-2">
              {noteRows.map((row: any) => (
                <Link key={row.id} href={`/patients/${row.id}`} className="block rounded-lg border border-gray-200 bg-white p-3 hover:border-brand-300">
                  <div className="font-semibold text-brand-700">{row.fullName} <span className="text-xs text-gray-400">#{row.fileNumber}</span></div>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-600">{row.notes}</p>
                </Link>
              ))}
              {noteRows.length === 0 && <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">لا توجد ملاحظات عامة ظاهرة.</div>}
            </div>
          </AdminSection>
        </div>
      )}

      {activeTab === "alerts" && (
        <div className="grid gap-4 xl:grid-cols-2">
          {canPatients && (
            <AdminSection id="alerts-incomplete" title="بيانات ناقصة" description="ملفات تحتاج إكمال بيانات تعريفية أو تنظيمية.">
              <IncompleteTable rows={incompleteRows} />
            </AdminSection>
          )}
          {canJourney && (
            <AdminSection id="alerts-delayed" title="تأخر في المسار" description="محطات مفتوحة منذ أكثر من يوم.">
              <StageTable rows={delayedStages} />
            </AdminSection>
          )}
          {canReferrals && (
            <AdminSection id="alerts-referrals" title="إحالات معلقة" description="طلبات لم تصل إلى مراجعة نهائية أو إلغاء.">
              <ReferralTable rows={referralRows.slice(0, 20)} />
            </AdminSection>
          )}
          {canQueue && (
            <AdminSection id="alerts-queue" title="الطابور النشط" description="مراجعون ما زالوا في الطابور أو داخل الجلسة.">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">الحالة</th><th className="th">المراجع</th><th className="th">القاعة</th><th className="th">الدخول</th></tr></thead>
                  <tbody>
                    {queueRows.map((entry: any) => (
                      <tr key={entry.id}><td className="td">{QUEUE_STATUS[entry.status as keyof typeof QUEUE_STATUS] ?? entry.status}</td><td className="td"><Link href={`/patients/${entry.patientId}`} className="text-brand-700 hover:underline">{entry.patient.fullName}</Link></td><td className="td">{entry.hall || "—"}</td><td className="td">{fmtTime(entry.createdAt)}</td></tr>
                    ))}
                    {queueRows.length === 0 && emptyRow(4, "لا توجد حالات طابور نشطة.")}
                  </tbody>
                </table>
              </div>
            </AdminSection>
          )}
        </div>
      )}
    </div>
  );
}

function PatientFilters({
  sp,
  branches,
  governorates,
  districts,
  injuryTypes,
  activeBranchId,
  patientStatus,
  caseType,
  governorateId,
  districtId,
  injuryTypeId,
}: {
  sp: Record<string, string | undefined>;
  branches: any[];
  governorates: any[];
  districts: any[];
  injuryTypes: any[];
  activeBranchId?: number | null;
  patientStatus?: string;
  caseType?: string;
  governorateId?: number;
  districtId?: number;
  injuryTypeId?: number;
}) {
  return (
    <form action="/patients-care" className="grid gap-3 md:grid-cols-4" autoComplete="off">
      <input type="hidden" name="tab" value="patients" />
      <label className="label md:col-span-2">الاسم/رقم الملف/الهاتف<input name="q" className="input mt-1" defaultValue={sp.q ?? ""} placeholder="بحث عام" /></label>
      <label className="label">الحالة<select name="patientStatus" className="input mt-1" defaultValue={patientStatus ?? ""}><option value="">كل الحالات</option>{Object.entries(PATIENT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">الفرع<select name="branch" className="input mt-1" defaultValue={sp.branch === "all" ? "all" : activeBranchId ? String(activeBranchId) : ""}><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label className="label">المحافظة<select name="gov" className="input mt-1" defaultValue={governorateId ? String(governorateId) : ""}><option value="">الكل</option>{governorates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="label">المنطقة<select name="district" className="input mt-1" defaultValue={districtId ? String(districtId) : ""}><option value="">الكل</option>{districts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="label">نوع الإصابة<select name="injury" className="input mt-1" defaultValue={injuryTypeId ? String(injuryTypeId) : ""}><option value="">الكل</option>{injuryTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="label">نوع الحالة<select name="caseType" className="input mt-1" defaultValue={caseType ?? ""}><option value="">الكل</option>{Object.entries(CASE_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="label">آخر زيارة من<input name="lastVisitFrom" type="date" className="input mt-1" defaultValue={sp.lastVisitFrom ?? ""} /></label>
      <label className="label">آخر زيارة إلى<input name="lastVisitTo" type="date" className="input mt-1" defaultValue={sp.lastVisitTo ?? ""} /></label>
      <div className="flex items-end gap-2 md:col-span-2"><button className="btn-primary">تطبيق الفلاتر</button><Link href="/patients-care?tab=patients" className="btn-ghost">مسح</Link><Link href="/patients" className="btn-ghost">فتح /patients</Link></div>
    </form>
  );
}

function PatientTable({ rows, compactTitle }: { rows: any[]; compactTitle?: string }) {
  return (
    <div className="space-y-3">
      {compactTitle ? <h3 className="text-sm font-semibold text-gray-700">{compactTitle}</h3> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="th">رقم الملف</th><th className="th">المراجع</th><th className="th">الفرع</th><th className="th">المحافظة/المنطقة</th><th className="th">نوع الإصابة</th><th className="th">الحالة</th><th className="th">آخر زيارة/نشاط</th><th className="th">تنبيه</th></tr></thead>
          <tbody>
            {rows.map((patient: any) => {
              const missing = [
                !patient.phone ? "هاتف" : null,
                !patient.governorateId ? "محافظة" : null,
                !patient.injuryTypeId ? "إصابة" : null,
                !patient.caseType ? "نوع الحالة" : null,
                !patient.branchId ? "فرع" : null,
              ].filter(Boolean);
              const queue = patient.queueEntries?.[0];
              const referral = patient.referralRequests?.[0];
              const stage = patient.careStages?.[0];
              return (
                <tr key={patient.id} className={missing.length ? "bg-amber-50/40" : "hover:bg-gray-50"}>
                  <td className="td">#{patient.fileNumber}</td>
                  <td className="td"><Link href={`/patients/${patient.id}`} className="font-medium text-brand-700 hover:underline">{patient.fullName}</Link><div className="text-xs text-gray-400">{patient.phone || "لا يوجد هاتف"}</div></td>
                  <td className="td">{patient.branch?.name ?? "بدون فرع"}</td>
                  <td className="td">{patient.governorate?.name ?? "—"}{patient.district?.name ? ` / ${patient.district.name}` : ""}</td>
                  <td className="td">{patient.injuryType?.name ?? "—"}</td>
                  <td className="td">{badge(PATIENT_STATUS[patient.status as keyof typeof PATIENT_STATUS] ?? patient.status)}</td>
                  <td className="td">{patient.visits?.[0] ? fmtDate(patient.visits[0].visitDate) : fmtDate(patient.updatedAt)}</td>
                  <td className="td"><div className="flex flex-wrap gap-1">{missing.length ? badge(`ناقص: ${missing.join("، ")}`, "bg-amber-100 text-amber-800") : null}{queue ? badge("في الطابور", "bg-sky-50 text-sky-700") : null}{referral ? badge("إحالة معلقة", "bg-orange-50 text-orange-700") : null}{stage ? badge(normalizeStationName(stage.station), "bg-indigo-50 text-indigo-700") : null}</div></td>
                </tr>
              );
            })}
            {rows.length === 0 && emptyRow(8)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReferralTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">الطلب</th><th className="th">المراجع</th><th className="th">الوجهة</th><th className="th">الحالة</th><th className="th">الإنشاء</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={PENDING_REFERRAL_STATUSES.includes(row.status) ? "bg-orange-50/30" : "hover:bg-gray-50"}>
              <td className="td"><Link href={`/referrals/${row.id}`} className="font-medium text-brand-700 hover:underline">{row.requestedService}</Link><div className="text-xs text-gray-400">{row.type}</div></td>
              <td className="td"><Link href={`/patients/${row.patientId}`} className="text-brand-700 hover:underline">{row.patient.fullName}</Link><div className="text-xs text-gray-400">#{row.patient.fileNumber}</div></td>
              <td className="td">{row.externalEntity || row.destinationCenter?.name || row.assignedReviewer?.fullName || "داخلية"}</td>
              <td className="td">{badge(REFERRAL_STATUS_LABELS[row.status as keyof typeof REFERRAL_STATUS_LABELS] ?? row.status, PENDING_REFERRAL_STATUSES.includes(row.status) ? "bg-orange-100 text-orange-800" : "bg-gray-100 text-gray-600")}</td>
              <td className="td">{fmtDate(row.createdAt)}</td>
            </tr>
          ))}
          {rows.length === 0 && emptyRow(5, "لا توجد إحالات ضمن الفلاتر.")}
        </tbody>
      </table>
    </div>
  );
}

function StageTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">المراجع</th><th className="th">المحطة</th><th className="th">الحالة</th><th className="th">الدور</th><th className="th">آخر تحديث</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              <td className="td"><Link href={`/patients/${row.patientId}`} className="font-medium text-brand-700 hover:underline">{row.patient.fullName}</Link><div className="text-xs text-gray-400">#{row.patient.fileNumber}</div></td>
              <td className="td">{normalizeStationName(row.station)}</td>
              <td className="td">{badge(row.status === "IN_PROGRESS" ? "قيد التنفيذ" : "بالانتظار", row.status === "IN_PROGRESS" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600")}</td>
              <td className="td">{row.responsibleRole ?? "—"}</td>
              <td className="td">{fmtDateTime(row.updatedAt)}</td>
            </tr>
          ))}
          {rows.length === 0 && emptyRow(5, "لا توجد محطات نشطة.")}
        </tbody>
      </table>
    </div>
  );
}

function IncompleteTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr><th className="th">المراجع</th><th className="th">الفرع</th><th className="th">المحافظة</th><th className="th">نوع الإصابة</th><th className="th">النواقص</th></tr></thead>
        <tbody>
          {rows.map((patient: any) => {
            const missing = [
              !patient.phone ? "الهاتف" : null,
              !patient.branchId ? "الفرع" : null,
              !patient.governorateId ? "المحافظة" : null,
              !patient.injuryTypeId ? "نوع الإصابة" : null,
              !patient.caseType ? "نوع الحالة" : null,
            ].filter(Boolean);
            return (
              <tr key={patient.id} className="hover:bg-gray-50">
                <td className="td"><Link href={`/patients/${patient.id}`} className="font-medium text-brand-700 hover:underline">{patient.fullName}</Link><div className="text-xs text-gray-400">#{patient.fileNumber}</div></td>
                <td className="td">{patient.branch?.name ?? "—"}</td>
                <td className="td">{patient.governorate?.name ?? "—"}</td>
                <td className="td">{patient.injuryType?.name ?? "—"}</td>
                <td className="td">{missing.length ? missing.join("، ") : "—"}</td>
              </tr>
            );
          })}
          {rows.length === 0 && emptyRow(5, "لا توجد ملفات ناقصة ضمن النطاق الحالي.")}
        </tbody>
      </table>
    </div>
  );
}

function ActionCard({ href, title, description, external }: { href: string; title: string; description: string; external?: boolean }) {
  const cls = "block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm";
  const body = (
    <>
      <div className="font-semibold text-gray-900">{title}</div>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </>
  );
  return external ? <a href={href} className={cls}>{body}</a> : <Link href={href} className={cls}>{body}</Link>;
}
