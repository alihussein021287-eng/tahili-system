import { prisma } from "@/lib/db";
import Link from "next/link";
import { Fragment } from "react";
import { fmtDate, fmtTime, THERAPY } from "@/lib/labels";
import { currentPerms, getSession } from "@/lib/access";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ShortcutsEditor } from "@/components/ShortcutsEditor";
import { PageHeader } from "@/components/PageHeader";
import { stationForRole } from "@/lib/stations";

export const dynamic = "force-dynamic";
const dayMs = 86400000;
const HUB_LINKS = {
  staffTasks: "/staff?tab=tasks",
  staffTasksOverdue: "/staff?tab=tasks&taskStatus=overdue",
  staffAttendance: "/staff?tab=attendance",
  patients: "/patients-care?tab=patients",
  visits: "/patients-care?tab=visits",
  queue: "/patients-care?tab=queue",
  journey: "/patients-care?tab=journey",
  appointments: "/patients-care?tab=appointments",
  therapyToday: "/therapy-centers?tab=today",
  therapyBeds: "/therapy-centers?tab=beds",
  therapyMeds: "/therapy-centers?tab=meds",
  pharmacyDispense: "/pharmacy-inventory?tab=dispense",
  pharmacyStock: "/pharmacy-inventory?tab=stock",
  pharmacyLowStock: "/pharmacy-inventory?tab=stock&stockState=low",
  pharmacyBatchesSoon: "/pharmacy-inventory?tab=batches&batchState=soon",
  reportsPatients: "/reports-finance?tab=patients",
  reportsOfficial: "/reports-finance?tab=official",
  finance: "/reports-finance?tab=finance",
  readiness: "/readiness",
} as const;

const DASHBOARD_LINK_REPLACEMENTS: Record<string, string> = {
  "/tasks": HUB_LINKS.staffTasks,
  "/attendance": HUB_LINKS.staffAttendance,
  "/patients": HUB_LINKS.patients,
  "/visits": HUB_LINKS.visits,
  "/queue": HUB_LINKS.queue,
  "/care-board": HUB_LINKS.journey,
  "/appointments": HUB_LINKS.appointments,
  "/beds": HUB_LINKS.therapyBeds,
  "/meds": HUB_LINKS.therapyMeds,
  "/pharmacy": HUB_LINKS.pharmacyDispense,
  "/pharmacy/stock": HUB_LINKS.pharmacyBatchesSoon,
  "/inventory": HUB_LINKS.pharmacyStock,
  "/reports": HUB_LINKS.reportsPatients,
  "/reports/official": HUB_LINKS.reportsOfficial,
  "/finance": HUB_LINKS.finance,
};

function dashboardHref(href: string) {
  return DASHBOARD_LINK_REPLACEMENTS[href] ?? href;
}

export default async function Dashboard() {
  const now = new Date();
  const session = await getSession();
  const uid = (session?.user as any)?.id;
  const name = session?.user?.name ?? "مستخدم";
  const dateLine = new Intl.DateTimeFormat("ar-IQ-u-ca-gregory", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Baghdad" }).format(new Date());
  const perms = await currentPerms();
  const CANDIDATES = [
    { href: "/patients/new", label: "مراجع جديد", icon: "➕", perm: "patients.create" },
    { href: HUB_LINKS.visits, label: "تسجيل حضور", icon: "📋", perm: "visits.view" },
    { href: HUB_LINKS.queue, label: "الطابور", icon: "⏳", perm: "queue.view" },
    { href: HUB_LINKS.appointments, label: "المواعيد", icon: "📅", perm: "appointments.view" },
    { href: HUB_LINKS.therapyBeds, label: "الرقود والفندقة", icon: "🛏", perm: "beds.view" },
    { href: HUB_LINKS.therapyMeds, label: "أدوية الراقدين", icon: "💊", perm: "meds.view" },
    { href: HUB_LINKS.finance, label: "المالية", icon: "💰", perm: "finance.view" },
    { href: "/analytics", label: "التحليلات", icon: "📊", perm: "analytics.view" },
    { href: HUB_LINKS.readiness, label: "جاهزية النظام", icon: "✅", perm: "settings.view" },
    { href: HUB_LINKS.reportsOfficial, label: "التقرير الرسمي", icon: "📄", perm: "reports.official" },
    { href: HUB_LINKS.pharmacyStock, label: "المخزون", icon: "📦", perm: "inventory.view" },
    { href: HUB_LINKS.staffAttendance, label: "الحضور", icon: "🕒", perm: "attendance.view" },
    { href: "/workload", label: "حمل المعالجين", icon: "👷", perm: "workload.view" },
    { href: "/station-kpis", label: "مؤشرات المحطات", icon: "📈", perm: "reports.view" },
    { href: "/search", label: "بحث", icon: "🔍", perm: "dashboard.view" },
  ].filter((c) => perms.has(c.perm));
  const pref = uid ? await prisma.userPreference.findUnique({ where: { userId: uid } }) : null;
  let favs: string[] = [];
  try {
    const parsed = pref ? JSON.parse(pref.favorites) : [];
    favs = Array.isArray(parsed) ? parsed : [];
  } catch { favs = []; }
  favs = Array.from(new Set(favs.map(dashboardHref)));
  if (favs.length === 0) favs = CANDIDATES.slice(0, 4).map((c) => c.href);
  const myShortcuts = CANDIDATES.filter((c) => favs.includes(c.href));
  const startToday = new Date(now.toDateString());
  const startTomorrow = new Date(startToday.getTime() + dayMs);
  const startDayAfter = new Date(startToday.getTime() + 2 * dayMs);
  const canPatients = perms.has("patients.view");
  const canAppointments = perms.has("appointments.view");
  const canBeds = perms.has("beds.view");
  const canInventory = perms.has("inventory.view") || perms.has("pharmacy.view");

  const [patients, active, admittedCount, sessions, recent, todayAppts, tomorrowAppts, admittedList, meds, devicesDue, queueWaiting, visitsToday, diagnosesToday, followupsDue, therapistToday, activePlans, activeUsers, auditToday] =
    await Promise.all([
      canPatients ? prisma.patient.count() : Promise.resolve(0),
      canPatients ? prisma.patient.count({ where: { status: "ACTIVE" } }) : Promise.resolve(0),
      canBeds ? prisma.admission.count({ where: { status: "ADMITTED" } }) : Promise.resolve(0),
      (perms.has("therapy.view") || perms.has("clinical.session")) ? prisma.therapySession.count() : Promise.resolve(0),
      canPatients ? prisma.patient.findMany({ take: 15, select: { id: true, fileNumber: true, fullName: true, registrationDate: true, governorate: { select: { name: true } } }, orderBy: { registrationDate: "desc" } }) : Promise.resolve([]),
      canAppointments ? prisma.appointment.findMany({ where: { status: "SCHEDULED", scheduledAt: { gte: startToday, lt: startTomorrow } }, select: { id: true, patientId: true, scheduledAt: true, type: true, therapyType: true, assignedTo: true, ...(canPatients ? { patient: { select: { fullName: true } } } : {}) }, orderBy: { scheduledAt: "asc" }, take: 40 }) : Promise.resolve([]),
      canAppointments ? prisma.appointment.findMany({ where: { status: "SCHEDULED", scheduledAt: { gte: startTomorrow, lt: startDayAfter } }, select: { id: true, patientId: true, scheduledAt: true, type: true, therapyType: true, assignedTo: true, ...(canPatients ? { patient: { select: { fullName: true } } } : {}) }, orderBy: { scheduledAt: "asc" }, take: 40 }) : Promise.resolve([]),
      canBeds ? prisma.admission.findMany({ where: { status: "ADMITTED" }, select: { id: true, patientId: true, admissionDate: true, durationDays: true, patient: { select: { fullName: true } }, center: { select: { name: true } } }, orderBy: { admissionDate: "asc" }, take: 50 }) : Promise.resolve([]),
      canInventory ? prisma.medication.findMany({ select: { id: true, quantity: true, minQuantity: true }, orderBy: { id: "asc" }, take: 200 }) : Promise.resolve([]),
      perms.has("devices.view") ? prisma.device.count({ where: { nextMaintenanceAt: { lte: now }, status: { not: "REPLACED" } } }) : Promise.resolve(0),
      perms.has("queue.view") ? prisma.queueEntry.count({ where: { status: { in: ["WAITING", "CALLED", "IN_SESSION"] }, createdAt: { gte: startToday, lt: startTomorrow } } }) : Promise.resolve(0),
      perms.has("visits.view") ? prisma.visit.count({ where: { visitDate: { gte: startToday, lt: startTomorrow } } }) : Promise.resolve(0),
      perms.has("clinical.diagnosis") ? prisma.diagnosis.count({ where: { createdAt: { gte: startToday, lt: startTomorrow } } }) : Promise.resolve(0),
      canPatients ? prisma.patient.count({ where: { nextCheckupAt: { lte: startDayAfter }, archivedAt: null } }) : Promise.resolve(0),
      perms.has("therapy.session.record") ? prisma.appointment.count({ where: { status: "SCHEDULED", assignedTo: name, scheduledAt: { gte: startToday, lt: startTomorrow }, type: { contains: "جلسة" } } }) : Promise.resolve(0),
      (perms.has("therapy.view") || perms.has("workload.view")) ? prisma.treatmentPlan.count({ where: { status: "ACTIVE" } }) : Promise.resolve(0),
      perms.has("users.view") ? prisma.user.count({ where: { isActive: true } }) : Promise.resolve(0),
      perms.has("audit.view") ? prisma.auditLog.count({ where: { createdAt: { gte: startToday, lt: startTomorrow } } }) : Promise.resolve(0),
    ]);

  // الرقود: حساب تاريخ الانتهاء والحالة
  const admEnd = (a: any) => (a.durationDays ? new Date(new Date(a.admissionDate).getTime() + a.durationDays * dayMs) : null);
  const admState = (a: any) => {
    const e = admEnd(a);
    if (!e) return { label: "مستمر", cls: "bg-gray-100 text-gray-600", over: false };
    if (now >= e) return { label: "انتهى وقت الرقود", cls: "bg-red-50 text-red-700", over: true };
    if (e.getTime() - now.getTime() <= dayMs) return { label: "ينتهي قريباً", cls: "bg-amber-50 text-amber-700", over: false };
    return { label: "مستمر", cls: "bg-emerald-50 text-emerald-700", over: false };
  };
  const admOver = admittedList.filter((a) => admState(a).over).length;
  const lowMeds = meds.filter((m: any) => (m.quantity ?? 0) <= (m.minQuantity ?? 0));
  const myRole = (session?.user as any)?.role;
  const myStation = stationForRole(myRole);
  const [myStationWaiting, myStationInProgress] = await Promise.all([
    perms.has("journey.view") && myRole ? prisma.careStage.count({ where: { responsibleRole: myRole, status: "WAITING", patient: { archivedAt: null } } }) : Promise.resolve(0),
    perms.has("journey.view") && myRole ? prisma.careStage.count({ where: { responsibleRole: myRole, status: "IN_PROGRESS", patient: { archivedAt: null } } }) : Promise.resolve(0),
  ]);

  // شريط "ركّز على عملك" — يتكيّف حسب صلاحيات المستخدم
  const wantPharm = perms.has("pharmacy.view");
  const wantFin = perms.has("finance.view");
  const soon60 = new Date(); soon60.setDate(soon60.getDate() + 60);
  const [rxPending, expiringSoon, unpaidInvoices, myOpenTasks, overdueTasks, appointmentSoon] = await Promise.all([
    wantPharm ? prisma.prescription.count({ where: { isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE" } }) : Promise.resolve(0),
    wantPharm ? prisma.medicationBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: soon60 } } }) : Promise.resolve(0),
    wantFin ? prisma.invoice.findMany({ where: { status: { not: "PAID" } }, select: { amount: true, paidAmount: true } }) : Promise.resolve([] as { amount: number; paidAmount: number }[]),
    perms.has("tasks.view") ? prisma.task.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, OR: [{ assignedToId: uid }, { assignedRole: myRole }] } }) : Promise.resolve(0),
    perms.has("tasks.view") ? prisma.task.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: now }, OR: [{ assignedToId: uid }, { assignedRole: myRole }] } }) : Promise.resolve(0),
    perms.has("appointments.view") ? prisma.appointment.count({ where: { status: "SCHEDULED", scheduledAt: { gte: now, lte: new Date(now.getTime() + 2 * 60 * 60 * 1000) }, OR: [{ assignedTo: name }, { assignedTo: null }] } }) : Promise.resolve(0),
  ]);
  const unpaidCount = unpaidInvoices.length;
  const outstanding = unpaidInvoices.reduce((sum, i) => sum + (i.amount - i.paidAmount), 0);
  const myToday = name ? todayAppts.filter((a: any) => a.assignedTo && a.assignedTo === name).length : 0;
  const focus = [
    ...((perms.has("tasks.view") && myOpenTasks > 0) ? [
      { show: true, label: "مهامي المفتوحة", value: myOpenTasks as any, icon: "📌", href: HUB_LINKS.staffTasks, color: "bg-indigo-600" },
    ] : []),
    ...((perms.has("tasks.view") && overdueTasks > 0) ? [
      { show: true, label: "مهام متأخرة", value: overdueTasks as any, icon: "⏰", href: HUB_LINKS.staffTasksOverdue, color: "bg-red-600" },
    ] : []),
    ...((perms.has("appointments.view") && appointmentSoon > 0) ? [
      { show: true, label: "مواعيد قريبة", value: appointmentSoon as any, icon: "🔔", href: HUB_LINKS.appointments, color: "bg-purple-600" },
    ] : []),
    ...(wantPharm ? [
      { show: true, label: "وصفات بانتظار الصرف", value: rxPending as any, icon: "💊", href: HUB_LINKS.pharmacyDispense, color: "bg-teal-600" },
      { show: expiringSoon > 0, label: "دفعات قريبة النفاذ", value: expiringSoon as any, icon: "⏳", href: HUB_LINKS.pharmacyBatchesSoon, color: "bg-orange-600" },
    ] : []),
    ...(wantFin ? [
      { show: true, label: "فواتير غير مسددة", value: unpaidCount as any, icon: "🧾", href: HUB_LINKS.finance, color: "bg-rose-600" },
      { show: outstanding > 0, label: "مبالغ مستحقة (د.ع)", value: outstanding.toLocaleString("en-US") as any, icon: "💰", href: HUB_LINKS.finance, color: "bg-amber-600" },
    ] : []),
    ...((perms.has("appointments.view") && myToday > 0) ? [
      { show: true, label: "مواعيدي اليوم", value: myToday as any, icon: "📅", href: HUB_LINKS.appointments, color: "bg-sky-600" },
    ] : []),
    ...((perms.has("journey.view") && myStation && (myStationWaiting + myStationInProgress) > 0) ? [
      { show: true, label: `محطتي: ${myStation.name}`, value: (myStationWaiting + myStationInProgress) as any, icon: "🧭", href: HUB_LINKS.journey, color: "bg-slate-700" },
    ] : []),
  ].filter((x) => x.show);

  const stats = [
    { label: "إجمالي المراجعين", value: patients, color: "bg-brand-600", icon: "👥", href: HUB_LINKS.patients, perm: "patients.view" },
    { label: "تحت المتابعة", value: active, color: "bg-emerald-600", icon: "🟢", href: HUB_LINKS.patients, perm: "patients.view" },
    { label: "راقدون حالياً", value: admittedCount, color: "bg-amber-600", icon: "🛏", href: HUB_LINKS.therapyBeds, perm: "beds.view" },
    { label: "جلسات مسجّلة", value: sessions, color: "bg-sky-600", icon: "🩺", href: HUB_LINKS.reportsPatients, perm: "reports.view" },
  ].filter((s) => perms.has(s.perm));

  const alerts = [
    { show: appointmentSoon > 0, label: "موعد قريب", value: appointmentSoon, cls: "border-purple-200 bg-purple-50 text-purple-700", href: HUB_LINKS.appointments },
    { show: overdueTasks > 0, label: "مهام متأخرة", value: overdueTasks, cls: "border-red-200 bg-red-50 text-red-700", href: HUB_LINKS.staffTasksOverdue },
    { show: admOver > 0, label: "رقود انتهى وقته", value: admOver, cls: "border-red-200 bg-red-50 text-red-700", href: HUB_LINKS.therapyBeds },
    { show: devicesDue > 0, label: "أجهزة بحاجة صيانة", value: devicesDue, cls: "border-amber-200 bg-amber-50 text-amber-700", href: "/devices?due=1" },
    { show: lowMeds.length > 0, label: "مواد منخفضة بالمخزون", value: lowMeds.length, cls: "border-orange-200 bg-orange-50 text-orange-700", href: HUB_LINKS.pharmacyLowStock },
  ].filter((a) => a.show);

  const tToday = startToday.getTime();
  const bucketOf = (d: Date | string) => {
    const t = new Date(new Date(d).toDateString()).getTime();
    if (t === tToday) return "today";
    if (t === tToday - dayMs) return "yesterday";
    return "older";
  };
  const recentGroups = [{ key: "today", label: "اليوم" }, { key: "yesterday", label: "البارحة" }, { key: "older", label: "أقدم" }];
  const apptGroups = [{ key: "today", label: "اليوم", list: todayAppts }, { key: "tomorrow", label: "غداً", list: tomorrowAppts }];
  const receptionRole = myRole === "RECEPTION" || myRole === "DATA_ENTRY";
  const centerRole = myRole === "HEAD_THERAPIST" || myRole === "THERAPIST";
  const membershipCenterIds = centerRole && uid
    ? (await prisma.centerMembership.findMany({ where: { userId: uid, status: "ACTIVE" }, select: { centerId: true }, take: 100 })).map((item) => item.centerId)
    : [];
  const [visitsWithoutQueue, specialistPending, headUnassigned, therapistUnlogged, pendingPurchases, submittedExpenses, payableExpenses, accountIssues] = await Promise.all([
    receptionRole && perms.has("visits.view") && perms.has("queue.view")
      ? Promise.all([
        prisma.visit.findMany({ where: { visitDate: { gte: startToday, lt: startTomorrow } }, select: { patientId: true }, orderBy: { visitDate: "desc" }, take: 100 }),
        prisma.queueEntry.findMany({ where: { createdAt: { gte: startToday, lt: startTomorrow } }, select: { patientId: true }, orderBy: { createdAt: "desc" }, take: 100 }),
      ]).then(([visits, queued]) => {
        const queuePatients = new Set(queued.map((item) => item.patientId));
        return new Set(visits.filter((item) => !queuePatients.has(item.patientId)).map((item) => item.patientId)).size;
      })
      : Promise.resolve(0),
    myRole === "DOCTOR" && perms.has("referrals.view")
      ? prisma.referralRequest.count({ where: { status: { in: ["RESULT_RECEIVED", "REVIEWED"] }, OR: [{ assignedReviewerId: uid }, { assignedReviewerId: null }] } })
      : Promise.resolve(0),
    myRole === "HEAD_THERAPIST" && perms.has("therapy.plan.manage")
      ? prisma.treatmentPlan.count({ where: { status: "ACTIVE", ...(membershipCenterIds.length ? { centerId: { in: membershipCenterIds } } : { centerId: -1 }), OR: [{ therapistId: null }, { hallId: null }] } })
      : Promise.resolve(0),
    myRole === "THERAPIST" && perms.has("therapy.session.record")
      ? prisma.appointment.count({ where: { assignedToId: uid, sessionId: { not: null }, status: { in: ["SCHEDULED", "NOSHOW"] }, scheduledAt: { gte: startToday, lt: startTomorrow }, therapySessionLogs: { none: {} }, ...(membershipCenterIds.length ? { centerId: { in: membershipCenterIds } } : { centerId: -1 }) } })
      : Promise.resolve(0),
    perms.has("pharmacy.purchase.view")
      ? prisma.purchaseOrder.count({ where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] } } })
      : Promise.resolve(0),
    perms.has("expenses.approve") ? prisma.woundedExpense.count({ where: { status: "SUBMITTED" } }) : Promise.resolve(0),
    perms.has("expenses.pay") ? prisma.woundedExpense.count({ where: { status: "READY_FOR_PAYMENT" } }) : Promise.resolve(0),
    myRole === "ADMIN" && perms.has("users.view")
      ? prisma.user.count({ where: { OR: [{ isActive: false }, { lockedUntil: { gt: now } }] } })
      : Promise.resolve(0),
  ]);
  const roleCards = [
    {
      show: receptionRole,
      title: "مساحة الاستقبال",
      subtitle: "مواعيد اليوم، الطابور، وتسجيل المراجعين",
      cards: [
        { label: "مواعيد اليوم", value: todayAppts.length, href: HUB_LINKS.appointments, perm: "appointments.view" },
        { label: "حضور اليوم", value: visitsToday, href: HUB_LINKS.visits, perm: "visits.view" },
        { label: "حضروا بلا طابور", value: visitsWithoutQueue, href: HUB_LINKS.visits, perm: "visits.view" },
        { label: "بالطابور الآن", value: queueWaiting, href: HUB_LINKS.queue, perm: "queue.view" },
        { label: "تسجيل مراجع", value: "+", href: "/patients/new", perm: "patients.create" },
        { label: "قائمة عملي", value: "فتح", href: "/my-work?type=queue", perm: "dashboard.view" },
      ],
    },
    {
      show: myRole === "RESIDENT",
      title: "مساحة الطبيب المقيم",
      subtitle: "المراجعات التي تنتظر تقييم المقيم ونواقص المتابعة",
      cards: [
        { label: "ينتظرون تقييمي", value: myStationWaiting + myStationInProgress, href: HUB_LINKS.journey, perm: "journey.view" },
        { label: "تشخيصات اليوم", value: diagnosesToday, href: HUB_LINKS.patients, perm: "clinical.diagnosis" },
        { label: "تحتاج متابعة", value: followupsDue, href: HUB_LINKS.patients, perm: "patients.view" },
        { label: "قائمة عملي", value: "فتح", href: "/my-work?type=stage", perm: "dashboard.view" },
      ],
    },
    {
      show: myRole === "DOCTOR",
      title: "مساحة طبيب الاختصاص",
      subtitle: "الإحالات والنتائج والملفات التي تنتظر قراراً",
      cards: [
        { label: "إحالات تنتظر القرار", value: specialistPending, href: "/patients-care?tab=referrals", perm: "referrals.view" },
        { label: "تشخيصات اليوم", value: diagnosesToday, href: HUB_LINKS.patients, perm: "clinical.diagnosis" },
        { label: "متابعات مستحقة", value: followupsDue, href: HUB_LINKS.patients, perm: "patients.view" },
        { label: "قائمة عملي", value: "فتح", href: "/my-work?type=referral", perm: "dashboard.view" },
      ],
    },
    {
      show: myRole === "HEAD_THERAPIST",
      title: "مساحة رئيس المعالجين",
      subtitle: "الإسناد والجدولة والتقييمات وحمل الفريق ضمن العضوية",
      cards: [
        { label: "خطط ناقصة الإسناد", value: headUnassigned, href: "/therapy-centers?tab=plans", perm: "therapy.plan.manage" },
        { label: "خطط فعالة", value: activePlans, href: "/workload", perm: "workload.view" },
        { label: "حمل المعالجين", value: "فتح", href: "/workload", perm: "workload.view" },
        { label: "قائمة عملي", value: "فتح", href: "/my-work?type=plan", perm: "dashboard.view" },
      ],
    },
    {
      show: myRole === "THERAPIST",
      title: "مساحة المعالج",
      subtitle: "جلسات اليوم والنتائج التي لم تسجل بعد",
      cards: [
        { label: "جلساتي اليوم", value: therapistToday, href: HUB_LINKS.therapyToday, perm: "therapy.session.record" },
        { label: "نتائج غير مسجلة", value: therapistUnlogged, href: HUB_LINKS.therapyToday, perm: "therapy.session.record" },
        { label: "محطتي", value: myStationWaiting + myStationInProgress, href: HUB_LINKS.journey, perm: "journey.view" },
        { label: "قائمة عملي", value: "فتح", href: "/my-work?type=session", perm: "dashboard.view" },
      ],
    },
    {
      show: myRole === "PHARMACIST",
      title: "مساحة الصيدلي",
      subtitle: "وصفات قيد الانتظار ومخزون ودفعات",
      cards: [
        { label: "وصفات قيد الانتظار", value: rxPending, href: HUB_LINKS.pharmacyDispense, perm: "pharmacy.view" },
        { label: "مخزون منخفض", value: lowMeds.length, href: HUB_LINKS.pharmacyLowStock, perm: "inventory.view" },
        { label: "دفعات قرب النفاذ", value: expiringSoon, href: HUB_LINKS.pharmacyBatchesSoon, perm: "pharmacy.view" },
        { label: "شراء/استلام معلق", value: pendingPurchases, href: "/my-work?type=purchase", perm: "pharmacy.purchase.view" },
        { label: "قائمة عملي", value: "فتح", href: "/my-work?type=prescription", perm: "dashboard.view" },
      ],
    },
    {
      show: myRole === "ACCOUNTANT",
      title: "مساحة المالية",
      subtitle: "الاعتمادات والتنفيذ دون إظهار مبالغ خارج صلاحيتها",
      cards: [
        { label: "تنتظر الاعتماد", value: submittedExpenses, href: "/my-work?type=expense&status=submitted", perm: "expenses.approve" },
        { label: "جاهزة للتنفيذ", value: payableExpenses, href: "/my-work?type=expense&status=ready_for_payment", perm: "expenses.pay" },
        { label: "الموافقات", value: "فتح", href: "/reports-finance?tab=approvals", perm: "approvals.view" },
        { label: "قائمة عملي", value: "فتح", href: "/my-work?type=expense", perm: "dashboard.view" },
      ],
    },
    {
      show: myRole === "ADMIN" || myRole === "MANAGER",
      title: "مساحة الإدارة",
      subtitle: "مؤشرات عامة، تقارير، مستخدمون، وتدقيق",
      cards: [
        { label: "مراجعين نشطين", value: active, href: HUB_LINKS.reportsPatients, perm: "reports.view" },
        { label: "مستخدمون فعالون", value: activeUsers, href: "/users", perm: "users.view" },
        { label: "حسابات تحتاج متابعة", value: accountIssues, href: "/users", perm: "users.view" },
        { label: "تدقيق اليوم", value: auditToday, href: "/audit", perm: "audit.view" },
        { label: "جاهزية النظام", value: "فحص", href: HUB_LINKS.readiness, perm: "settings.view" },
        { label: "قائمة عملي", value: "فتح", href: "/my-work", perm: "dashboard.view" },
      ],
    },
    {
      show: ["LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS"].includes(myRole),
      title: `مساحة ${myStation?.name ?? "المحطة"}`,
      subtitle: "الحالات المحولة إلى دورك وروابط العمل المصرح بها",
      cards: [
        { label: "بانتظار المحطة", value: myStationWaiting, href: HUB_LINKS.journey, perm: "journey.view" },
        { label: "قيد التنفيذ", value: myStationInProgress, href: HUB_LINKS.journey, perm: "journey.view" },
        { label: "قائمة عملي", value: "فتح", href: "/my-work?type=stage", perm: "dashboard.view" },
      ],
    },
  ].filter((section) => section.show).map((section) => ({
    ...section,
    cards: section.cards.filter((card) => perms.has(card.perm)),
  })).filter((section) => section.cards.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader title={`أهلاً، ${name}`} subtitle={dateLine} icon="🏠" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-500">لوحة المتابعة</div>
        <div className="flex gap-2">
          <Link href="/my-work" className="btn-ghost">قائمة عملي</Link>
          <ShortcutsEditor candidates={CANDIDATES.map(({ href, label, icon }) => ({ href, label, icon }))} current={favs} />
          {perms.has("patients.create") && <Link href="/patients/new" className="btn-primary">+ مراجع جديد</Link>}
        </div>
      </div>

      {myShortcuts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {myShortcuts.map((c) => (
            <Link key={c.href} href={c.href} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-300 hover:text-brand-700">
              <span>{c.icon}</span><span>{c.label}</span>
            </Link>
          ))}
        </div>
      )}

      {roleCards.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {roleCards.map((section) => (
            <div key={section.title} className="card p-4">
              <div className="mb-3">
                <div className="font-semibold text-gray-800">{section.title}</div>
                <div className="text-xs text-gray-400">{section.subtitle}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {section.cards.map((card) => (
                  <Link key={card.label} href={card.href} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-center transition hover:border-brand-200 hover:bg-brand-50">
                    <div className="text-xl font-bold text-gray-800">{card.value}</div>
                    <div className="mt-1 text-xs text-gray-500">{card.label}</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {myRole === "RECEPTION" && perms.has("patients.view") && (
        <form action="/search" className="card flex flex-wrap items-end gap-2 p-4">
          <div className="min-w-[220px] flex-1">
            <label className="label">بحث استقبال سريع</label>
            <input name="q" className="input" placeholder="اسم المراجع، رقم الملف، أو الهاتف" />
          </div>
          <button className="btn-primary" type="submit">بحث وتسجيل حضور</button>
          {perms.has("visits.view") && <Link href={HUB_LINKS.visits} className="btn-ghost">زيارات اليوم</Link>}
        </form>
      )}

      {focus.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-gray-500">ركّز على عملك</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {focus.map((f) => (
              <Link key={f.label} href={f.href} className="card flex items-center gap-3 p-4 transition hover:shadow-md hover:ring-1 hover:ring-brand-200">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${f.color} text-white`}>{f.icon}</div>
                <div>
                  <div className="text-xl font-bold text-gray-800">{f.value}</div>
                  <div className="text-xs text-gray-500">{f.label}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {alerts.map((a) => (
            <Link key={a.label} href={a.href} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${a.cls} transition hover:brightness-95`}>
              <span className="text-sm font-medium">⚠ {a.label}</span>
              <span className="text-lg font-bold">{a.value}</span>
            </Link>
          ))}
        </div>
      )}

      {stats.length > 0 && (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card flex items-center gap-4 p-5 transition hover:shadow-md hover:ring-1 hover:ring-brand-200">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${s.color} text-lg text-white shadow-sm`}>{s.icon}</div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{s.value}</div>
              <div className="text-sm text-gray-500">{s.label}</div>
            </div>
          </Link>
        ))}
      </div>
      )}

      {perms.has("appointments.view") && (<>
      {/* مواعيد اليوم وغداً */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <span className="font-semibold text-gray-700">مواعيد اليوم وغداً</span>
          <Link href={HUB_LINKS.appointments} className="text-sm text-brand-700 hover:underline">كل المواعيد</Link>
        </div>
        <table className="w-full">
          <thead><tr><th className="th">الوقت</th><th className="th">المريض</th><th className="th">النوع</th><th className="th">المسؤول</th></tr></thead>
          <tbody>
            {todayAppts.length === 0 && tomorrowAppts.length === 0 && (
              <tr><td className="td text-center text-gray-400" colSpan={4}>لا مواعيد اليوم أو غداً. <Link href={HUB_LINKS.appointments} className="text-brand-700 hover:underline">إضافة موعد</Link></td></tr>
            )}
            {apptGroups.map((g) => g.list.length > 0 && (
              <Fragment key={g.key}>
                <tr className="bg-gray-50"><td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-gray-500">{g.label} <span className="text-gray-400">({g.list.length})</span></td></tr>
                {g.list.map((a: any) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="td font-medium">{fmtTime(a.scheduledAt)}</td>
                    <td className="td">{canPatients ? <Link href={`/patients/${a.patientId}`} className="text-brand-700 hover:underline">{a.patient?.fullName ?? "—"}</Link> : "محجوب"}</td>
                    <td className="td">{a.type || (a.therapyType ? THERAPY[a.therapyType as keyof typeof THERAPY] : "—")}</td>
                    <td className="td">{a.assignedTo || "—"}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      </>)}

      {perms.has("beds.view") && (<>
      {/* الرقود الحالية */}
      <div id="admissions" className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <span className="font-semibold text-gray-700">الرقود الحالية {admOver > 0 && <span className="ms-1 rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">{admOver} انتهى وقته</span>}</span>
        </div>
        <table className="w-full">
          <thead><tr><th className="th">المريض</th><th className="th">المركز</th><th className="th">تاريخ الدخول</th><th className="th">المدة (أيام)</th><th className="th">ينتهي بتاريخ</th><th className="th">الحالة</th></tr></thead>
          <tbody>
            {admittedList.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={6}>لا يوجد راقدون حالياً.</td></tr>}
            {admittedList.map((a: any) => {
              const st = admState(a); const e = admEnd(a);
              return (
                <tr key={a.id} className={`hover:bg-gray-50 ${st.over ? "bg-red-50/40" : ""}`}>
                  <td className="td"><Link href={`/patients/${a.patientId}`} className="text-brand-700 hover:underline">{a.patient.fullName}</Link></td>
                  <td className="td">{a.center?.name || "—"}</td>
                  <td className="td">{fmtDate(a.admissionDate)}</td>
                  <td className="td">{a.durationDays ?? "—"}</td>
                  <td className={`td ${st.over ? "font-bold text-red-700" : ""}`}>{e ? fmtDate(e) : "—"}{st.over ? " ⚠" : ""}</td>
                  <td className="td"><span className={`badge ${st.cls}`}>{st.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>)}

      {perms.has("patients.view") && (<>
      {/* أحدث المراجعين */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <span className="font-semibold text-gray-700">أحدث المراجعين</span>
          <Link href={HUB_LINKS.patients} className="text-sm text-brand-700 hover:underline">كل المراجعين</Link>
        </div>
        <table className="w-full">
          <thead><tr><th className="th">رقم الملف</th><th className="th">الاسم الرباعي</th><th className="th">المحافظة</th><th className="th">تاريخ التسجيل</th></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={4}>لا يوجد مراجعون بعد — ابدأ بإضافة مراجع جديد.</td></tr>}
            {recentGroups.map((g) => {
              const items = recent.filter((p) => bucketOf(p.registrationDate) === g.key);
              if (items.length === 0) return null;
              return (
                <Fragment key={g.key}>
                  <tr className="bg-gray-50"><td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-gray-500">{g.label} <span className="text-gray-400">({items.length})</span></td></tr>
                  {items.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="td">{p.fileNumber}</td>
                      <td className="td"><Link href={`/patients/${p.id}`} className="text-brand-700 hover:underline">{p.fullName}</Link></td>
                      <td className="td">{(p as any).governorate?.name ?? "—"}</td>
                      <td className="td">{fmtDate(p.registrationDate)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  );
}
