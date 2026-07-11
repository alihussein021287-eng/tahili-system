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

export default async function Dashboard() {
  const now = new Date();
  const session = await getSession();
  const uid = (session?.user as any)?.id;
  const name = session?.user?.name ?? "مستخدم";
  const dateLine = new Intl.DateTimeFormat("ar-IQ-u-ca-gregory", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Baghdad" }).format(new Date());
  const perms = await currentPerms();
  const CANDIDATES = [
    { href: "/patients/new", label: "مراجع جديد", icon: "➕", perm: "patients.create" },
    { href: "/visits", label: "تسجيل حضور", icon: "📋", perm: "visits.view" },
    { href: "/queue", label: "الطابور", icon: "⏳", perm: "queue.view" },
    { href: "/appointments", label: "المواعيد", icon: "📅", perm: "appointments.view" },
    { href: "/beds", label: "الأسرّة", icon: "🛏", perm: "beds.view" },
    { href: "/meds", label: "أدوية الراقدين", icon: "💊", perm: "meds.view" },
    { href: "/finance", label: "المالية", icon: "💰", perm: "finance.view" },
    { href: "/analytics", label: "التحليلات", icon: "📊", perm: "analytics.view" },
    { href: "/reports/official", label: "التقرير الرسمي", icon: "📄", perm: "reports.official" },
    { href: "/inventory", label: "المخزون", icon: "📦", perm: "inventory.view" },
    { href: "/attendance", label: "الحضور", icon: "🕒", perm: "attendance.view" },
    { href: "/workload", label: "حمل المعالجين", icon: "👷", perm: "workload.view" },
    { href: "/station-kpis", label: "مؤشرات المحطات", icon: "📈", perm: "reports.view" },
    { href: "/search", label: "بحث", icon: "🔍", perm: "dashboard.view" },
  ].filter((c) => perms.has(c.perm));
  const pref = uid ? await prisma.userPreference.findUnique({ where: { userId: uid } }) : null;
  let favs: string[] = [];
  try { favs = pref ? JSON.parse(pref.favorites) : []; } catch { favs = []; }
  if (favs.length === 0) favs = CANDIDATES.slice(0, 4).map((c) => c.href);
  const myShortcuts = CANDIDATES.filter((c) => favs.includes(c.href));
  const startToday = new Date(now.toDateString());
  const startTomorrow = new Date(startToday.getTime() + dayMs);
  const startDayAfter = new Date(startToday.getTime() + 2 * dayMs);

  const [patients, active, admittedCount, sessions, recent, todayAppts, tomorrowAppts, admittedList, meds, devicesDue, queueWaiting, visitsToday, diagnosesToday, followupsDue, therapistToday, activePlans, activeUsers, auditToday] =
    await Promise.all([
      prisma.patient.count(),
      prisma.patient.count({ where: { status: "ACTIVE" } }),
      prisma.admission.count({ where: { status: "ADMITTED" } }),
      prisma.therapySession.count(),
      prisma.patient.findMany({ take: 15, include: { governorate: true }, orderBy: { registrationDate: "desc" } }),
      prisma.appointment.findMany({ where: { status: "SCHEDULED", scheduledAt: { gte: startToday, lt: startTomorrow } }, include: { patient: true }, orderBy: { scheduledAt: "asc" } }),
      prisma.appointment.findMany({ where: { status: "SCHEDULED", scheduledAt: { gte: startTomorrow, lt: startDayAfter } }, include: { patient: true }, orderBy: { scheduledAt: "asc" } }),
      prisma.admission.findMany({ where: { status: "ADMITTED" }, include: { patient: true, center: true }, orderBy: { admissionDate: "asc" } }),
      prisma.medication.findMany({ select: { id: true, name: true, quantity: true, minQuantity: true } }),
      prisma.device.count({ where: { nextMaintenanceAt: { lte: now }, status: { not: "REPLACED" } } }),
      prisma.queueEntry.count({ where: { status: { in: ["WAITING", "CALLED", "IN_SESSION"] }, createdAt: { gte: startToday, lt: startTomorrow } } }),
      prisma.visit.count({ where: { visitDate: { gte: startToday, lt: startTomorrow } } }),
      prisma.diagnosis.count({ where: { createdAt: { gte: startToday, lt: startTomorrow } } }),
      prisma.patient.count({ where: { nextCheckupAt: { lte: startDayAfter }, archivedAt: null } }),
      prisma.appointment.count({ where: { status: "SCHEDULED", assignedTo: name, scheduledAt: { gte: startToday, lt: startTomorrow }, type: { contains: "جلسة" } } }),
      prisma.treatmentPlan.count({ where: { status: "ACTIVE" } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.auditLog.count({ where: { createdAt: { gte: startToday, lt: startTomorrow } } }),
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
    wantPharm ? prisma.prescription.count({ where: { isDispensed: false, status: { not: "REJECTED" } } }) : Promise.resolve(0),
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
      { show: true, label: "مهامي المفتوحة", value: myOpenTasks as any, icon: "📌", href: "/tasks", color: "bg-indigo-600" },
    ] : []),
    ...((perms.has("tasks.view") && overdueTasks > 0) ? [
      { show: true, label: "مهام متأخرة", value: overdueTasks as any, icon: "⏰", href: "/tasks", color: "bg-red-600" },
    ] : []),
    ...((perms.has("appointments.view") && appointmentSoon > 0) ? [
      { show: true, label: "مواعيد قريبة", value: appointmentSoon as any, icon: "🔔", href: "/appointments", color: "bg-purple-600" },
    ] : []),
    ...(wantPharm ? [
      { show: true, label: "وصفات بانتظار الصرف", value: rxPending as any, icon: "💊", href: "/pharmacy", color: "bg-teal-600" },
      { show: expiringSoon > 0, label: "دفعات قريبة النفاذ", value: expiringSoon as any, icon: "⏳", href: "/pharmacy/stock", color: "bg-orange-600" },
    ] : []),
    ...(wantFin ? [
      { show: true, label: "فواتير غير مسددة", value: unpaidCount as any, icon: "🧾", href: "/finance", color: "bg-rose-600" },
      { show: outstanding > 0, label: "مبالغ مستحقة (د.ع)", value: outstanding.toLocaleString("en-US") as any, icon: "💰", href: "/finance", color: "bg-amber-600" },
    ] : []),
    ...((perms.has("appointments.view") && myToday > 0) ? [
      { show: true, label: "مواعيدي اليوم", value: myToday as any, icon: "📅", href: "/appointments", color: "bg-sky-600" },
    ] : []),
    ...((perms.has("journey.view") && myStation && (myStationWaiting + myStationInProgress) > 0) ? [
      { show: true, label: `محطتي: ${myStation.name}`, value: (myStationWaiting + myStationInProgress) as any, icon: "🧭", href: "/care-board", color: "bg-slate-700" },
    ] : []),
  ].filter((x) => x.show);

  const stats = [
    { label: "إجمالي المراجعين", value: patients, color: "bg-brand-600", icon: "👥", href: "/patients", perm: "patients.view" },
    { label: "تحت المتابعة", value: active, color: "bg-emerald-600", icon: "🟢", href: "/patients", perm: "patients.view" },
    { label: "راقدون حالياً", value: admittedCount, color: "bg-amber-600", icon: "🛏", href: "#admissions", perm: "beds.view" },
    { label: "جلسات مسجّلة", value: sessions, color: "bg-sky-600", icon: "🩺", href: "/reports", perm: "reports.view" },
  ].filter((s) => perms.has(s.perm));

  const alerts = [
    { show: appointmentSoon > 0, label: "موعد قريب", value: appointmentSoon, cls: "border-purple-200 bg-purple-50 text-purple-700", href: "/appointments" },
    { show: overdueTasks > 0, label: "مهام متأخرة", value: overdueTasks, cls: "border-red-200 bg-red-50 text-red-700", href: "/tasks" },
    { show: admOver > 0, label: "رقود انتهى وقته", value: admOver, cls: "border-red-200 bg-red-50 text-red-700", href: "#admissions" },
    { show: devicesDue > 0, label: "أجهزة بحاجة صيانة", value: devicesDue, cls: "border-amber-200 bg-amber-50 text-amber-700", href: "/devices?due=1" },
    { show: lowMeds.length > 0, label: "مواد منخفضة بالمخزون", value: lowMeds.length, cls: "border-orange-200 bg-orange-50 text-orange-700", href: "/inventory" },
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
  const roleCards = [
    {
      show: myRole === "RECEPTION",
      title: "مساحة الاستقبال",
      subtitle: "مواعيد اليوم، الطابور، وتسجيل المراجعين",
      cards: [
        { label: "مواعيد اليوم", value: todayAppts.length, href: "/appointments", perm: "appointments.view" },
        { label: "حضور اليوم", value: visitsToday, href: "/visits", perm: "visits.view" },
        { label: "بالطابور الآن", value: queueWaiting, href: "/queue", perm: "queue.view" },
        { label: "محطات المركز", value: "فتح", href: "/station-kpis", perm: "reports.view" },
        { label: "تسجيل مراجع", value: "+", href: "/patients/new", perm: "patients.create" },
      ],
    },
    {
      show: myRole === "DOCTOR" || myRole === "RESIDENT",
      title: "مساحة الطبيب",
      subtitle: "مراجعين وتشخيصات ومتابعات قريبة",
      cards: [
        { label: "مراجعون نشطون", value: active, href: "/patients", perm: "patients.view" },
        { label: "تشخيصات اليوم", value: diagnosesToday, href: "/patients", perm: "clinical.diagnosis" },
        { label: "تحتاج متابعة", value: followupsDue, href: "/patients", perm: "patients.view" },
        { label: "محطتي", value: myStationWaiting + myStationInProgress, href: "/care-board", perm: "journey.view" },
      ],
    },
    {
      show: myRole === "THERAPIST" || myRole === "HEAD_THERAPIST",
      title: "مساحة المعالج",
      subtitle: "جلسات اليوم، خطط العلاج، وحمل العمل",
      cards: [
        { label: "جلساتي اليوم", value: therapistToday, href: "/appointments", perm: "appointments.view" },
        { label: "خطط فعالة", value: activePlans, href: "/workload", perm: "workload.view" },
        { label: "عبء العمل", value: "فتح", href: "/workload", perm: "workload.view" },
        { label: "محطتي", value: myStationWaiting + myStationInProgress, href: "/care-board", perm: "journey.view" },
      ],
    },
    {
      show: myRole === "PHARMACIST",
      title: "مساحة الصيدلي",
      subtitle: "وصفات قيد الانتظار ومخزون ودفعات",
      cards: [
        { label: "وصفات قيد الانتظار", value: rxPending, href: "/pharmacy", perm: "pharmacy.view" },
        { label: "مخزون منخفض", value: lowMeds.length, href: "/inventory", perm: "inventory.view" },
        { label: "دفعات قرب النفاذ", value: expiringSoon, href: "/pharmacy/stock", perm: "pharmacy.view" },
        { label: "محطة الصيدلية", value: myStationWaiting + myStationInProgress, href: "/care-board", perm: "journey.view" },
      ],
    },
    {
      show: myRole === "ADMIN" || myRole === "MANAGER",
      title: "مساحة الإدارة",
      subtitle: "مؤشرات عامة، تقارير، مستخدمون، وتدقيق",
      cards: [
        { label: "مراجعين نشطين", value: active, href: "/reports", perm: "reports.view" },
        { label: "مستخدمون فعالون", value: activeUsers, href: "/users", perm: "users.view" },
        { label: "تدقيق اليوم", value: auditToday, href: "/audit", perm: "audit.view" },
        { label: "التقارير", value: "فتح", href: "/reports/official", perm: "reports.official" },
        { label: "المحطات", value: "فتح", href: "/station-kpis", perm: "reports.view" },
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
          {perms.has("visits.view") && <Link href="/visits" className="btn-ghost">زيارات اليوم</Link>}
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
          <Link href="/appointments" className="text-sm text-brand-700 hover:underline">كل المواعيد</Link>
        </div>
        <table className="w-full">
          <thead><tr><th className="th">الوقت</th><th className="th">المريض</th><th className="th">النوع</th><th className="th">المسؤول</th></tr></thead>
          <tbody>
            {todayAppts.length === 0 && tomorrowAppts.length === 0 && (
              <tr><td className="td text-center text-gray-400" colSpan={4}>لا مواعيد اليوم أو غداً. <Link href="/appointments" className="text-brand-700 hover:underline">إضافة موعد</Link></td></tr>
            )}
            {apptGroups.map((g) => g.list.length > 0 && (
              <Fragment key={g.key}>
                <tr className="bg-gray-50"><td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-gray-500">{g.label} <span className="text-gray-400">({g.list.length})</span></td></tr>
                {g.list.map((a: any) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="td font-medium">{fmtTime(a.scheduledAt)}</td>
                    <td className="td"><Link href={`/patients/${a.patientId}`} className="text-brand-700 hover:underline">{a.patient.fullName}</Link></td>
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
          <Link href="/patients" className="text-sm text-brand-700 hover:underline">كل المراجعين</Link>
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
