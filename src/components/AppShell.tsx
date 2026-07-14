"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { markAllNotificationsRead } from "@/lib/notif-actions";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { ROLE_LABELS } from "@/lib/permissions";
import { IdleTimeout } from "./IdleTimeout";
import { CommandPalette } from "./CommandPalette";
import { canOpenNotification, notificationTone } from "@/lib/notifications";

type Item = { href: string; label: string; icon: string; perm: string };
type AlertCounts = {
  admOver: number;
  devicesDue: number;
  lowStock: number;
  rxPending: number;
  expiringSoon: number;
  myTasks: number;
  collaborationUnread?: number;
  overdueTasks?: number;
  appointmentSoon?: number;
  backupStale?: number;
  backupStopped?: number;
};

const ALL_ITEMS: Item[] = [
  { href: "/", label: "الرئيسية", icon: "▤", perm: "dashboard.view" },
  { href: "/notifications", label: "مركز التنبيهات", icon: "🔔", perm: "dashboard.view" },
  { href: "/collaboration", label: "مركز التعاون", icon: "💬", perm: "collaboration.view" },
  { href: "/patients", label: "المراجعون", icon: "☺", perm: "patients.view" },
  { href: "/referrals", label: "الفحوص والإحالات", icon: "↗", perm: "referrals.view" },
  { href: "/appointments", label: "المواعيد", icon: "▦", perm: "appointments.view" },
  { href: "/therapy", label: "العلاج الطبيعي", icon: "🏃", perm: "therapy.view" },
  { href: "/therapy/today", label: "جلساتي اليوم", icon: "🗓", perm: "therapy.session.record" },
  { href: "/centers", label: "مساحات المراكز", icon: "🏥", perm: "centers.view" },
  { href: "/centers/reports", label: "تقارير المراكز", icon: "📊", perm: "centers.view" },
  { href: "/queue", label: "الطابور", icon: "⏳", perm: "queue.view" },
  { href: "/visits", label: "استعلامات وحضور المراجعين", icon: "📋", perm: "visits.view" },
  { href: "/approvals", label: "سير الموافقات", icon: "✅", perm: "approvals.view" },
  { href: "/care-board", label: "المرضى حسب المحطة", icon: "🗺", perm: "journey.view" },
  { href: "/station-kpis", label: "مؤشرات المحطات", icon: "📈", perm: "reports.view" },
  { href: "/reports", label: "التقارير", icon: "▤", perm: "reports.view" },
  { href: "/inventory", label: "المخزون", icon: "▣", perm: "inventory.view" },
  { href: "/pharmacy", label: "الصيدلية", icon: "⚕️", perm: "pharmacy.view" },
  { href: "/pharmacy/stock", label: "دفعات الصيدلية", icon: "📦", perm: "pharmacy.view" },
  { href: "/pharmacy/reports", label: "تقارير الصيدلية", icon: "📊", perm: "pharmacy.view" },
  { href: "/pharmacy/purchases", label: "أوامر الشراء", icon: "🧾", perm: "pharmacy.purchase.view" },
  { href: "/beds", label: "الرقود والفندقة", icon: "🛏", perm: "beds.view" },
  { href: "/meds", label: "أدوية الراقدين", icon: "💊", perm: "meds.view" },
  { href: "/devices", label: "التسليم والصيانة", icon: "🔧", perm: "devices.view" },
  { href: "/workload", label: "حمل المعالجين", icon: "👷", perm: "workload.view" },
  { href: "/attendance", label: "حضور الموظفين", icon: "🕒", perm: "attendance.view" },
  { href: "/tasks", label: "المهام", icon: "📌", perm: "tasks.view" },
  { href: "/shifts", label: "المناوبات والإجازات", icon: "🗓", perm: "shifts.view" },
  { href: "/analytics", label: "التحليلات", icon: "📊", perm: "analytics.view" },
  { href: "/reports/statistical", label: "التقرير الإحصائي الرسمي", icon: "📑", perm: "reports.view" },
  { href: "/reports/official", label: "التقرير الرسمي", icon: "📄", perm: "reports.official" },
  { href: "/official-docs", label: "أرشيف الوثائق الرسمية", icon: "📄", perm: "officialdocs.view" },
  { href: "/finance", label: "المالية", icon: "₪", perm: "finance.view" },
  { href: "/finance/expenses", label: "صرفيات الجرحى", icon: "💳", perm: "expenses.view" },
  { href: "/login-log", label: "سجل الدخول", icon: "🔐", perm: "settings.view" },
  { href: "/audit", label: "سجل التدقيق", icon: "▣", perm: "audit.view" },
  { href: "/permissions", label: "الصلاحيات", icon: "🔐", perm: "users.permissions" },
  { href: "/users", label: "المستخدمون", icon: "⚙", perm: "users.view" },
  { href: "/settings", label: "الإعدادات", icon: "▥", perm: "settings.view" },
  { href: "/readiness", label: "جاهزية النظام", icon: "✅", perm: "settings.view" },
  { href: "/backup", label: "النسخ الاحتياطي", icon: "💾", perm: "settings.backup" },
];

// مجموعات التنقل: تبويب رئيسي (مجموعة) ← تبويبات فرعية (روابط)
const STANDALONE = ["/", "/notifications", "/collaboration"]; // روابط عامة تبقى مفردة فوق
const NAV_GROUPS: { key: string; title: string; icon: string; hrefs: string[] }[] = [
  { key: "care",    title: "المرضى والرعاية",   icon: "🧑‍⚕️", hrefs: ["/patients", "/referrals", "/appointments", "/therapy", "/therapy/today", "/centers", "/queue", "/visits", "/care-board", "/beds", "/meds"] },
  { key: "pharm",   title: "الصيدلية والمخزون", icon: "💊",   hrefs: ["/pharmacy", "/pharmacy/stock", "/pharmacy/purchases", "/pharmacy/reports", "/inventory", "/devices"] },
  { key: "reports", title: "التقارير والمالية", icon: "📊",   hrefs: ["/reports", "/reports/official", "/reports/statistical", "/centers/reports", "/official-docs", "/station-kpis", "/analytics", "/finance", "/finance/expenses"] },
  { key: "staff",   title: "الموظفون والمهام",   icon: "🗂",   hrefs: ["/tasks", "/approvals", "/workload", "/attendance", "/shifts"] },
  { key: "system",  title: "النظام",            icon: "⚙",    hrefs: ["/users", "/permissions", "/audit", "/login-log", "/settings", "/backup", "/readiness"] },
];
const MOBILE_QUICK_HREFS = ["/visits", "/queue", "/tasks", "/appointments"];

export function AppShell({ role, name, alerts, perms = [], notifs = [], children }: { role?: any; name: string; alerts?: AlertCounts; perms?: string[]; notifs?: any[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  const permSet = new Set(perms);
  const allItems = ALL_ITEMS.filter((it) => permSet.has(it.perm));
  const byHref: Record<string, Item> = {};
  for (const it of ALL_ITEMS) byHref[it.href] = it;
  // ربط كل نوع إشعار بصفحته — تظهر كشارة على القائمة (نفس فكرة شارة الصيدلية)
  const a = alerts ?? { admOver: 0, devicesDue: 0, lowStock: 0, rxPending: 0, expiringSoon: 0, myTasks: 0, overdueTasks: 0, appointmentSoon: 0 };
  const ALERT_BY_HREF: Record<string, { count: number; title: string }> = {
    "/appointments": { count: a.appointmentSoon ?? 0, title: "مواعيد قريبة خلال ساعتين" },
    "/pharmacy": { count: a.rxPending ?? 0, title: "وصفات قيد الانتظار" },
    "/pharmacy/stock": { count: a.expiringSoon ?? 0, title: "دفعات قريبة أو منتهية النفاذ" },
    "/inventory": { count: a.lowStock ?? 0, title: "مواد منخفضة بالمخزون" },
    "/devices": { count: a.devicesDue ?? 0, title: "أجهزة تحتاج صيانة" },
    "/beds": { count: a.admOver ?? 0, title: "رقود انتهت مدته" },
    "/tasks": { count: (a.myTasks ?? 0) + (a.overdueTasks ?? 0), title: `مهام مفتوحة${(a.overdueTasks ?? 0) > 0 ? `، منها ${a.overdueTasks} متأخرة` : ""}` },
    "/collaboration": { count: a.collaborationUnread ?? 0, title: "رسائل تعاون غير مقروءة" },
  };
  const badgeFor = (it: Item) => {
    const raw = ALERT_BY_HREF[it.href] ?? 0;
    return typeof raw === "number" ? { count: raw, title: "" } : raw;
  };

  // تحديد العنصر الفعّال = أطول رابط يطابق المسار الحالي (يميّز /reports عن /reports/official)
  const matches = ALL_ITEMS.filter((it) => (it.href === "/" ? path === "/" : path === it.href || path.startsWith(it.href + "/")));
  const activeHref = matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? "";
  const activeGroupKey = NAV_GROUPS.find((g) => g.hrefs.includes(activeHref))?.key ?? "";

  // حالة الطي لكل مجموعة — تبدأ مفتوحة على المجموعة الفعّالة
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of NAV_GROUPS) init[g.key] = g.key === activeGroupKey;
    return init;
  });
  // افتح مجموعة الصفحة الحالية تلقائياً عند التنقل (دون طيّ ما فتحه المستخدم)
  useEffect(() => {
    if (activeGroupKey) setOpenGroups((p) => (p[activeGroupKey] ? p : { ...p, [activeGroupKey]: true }));
  }, [activeGroupKey]);

  const toggleGroup = (k: string) => setOpenGroups((p) => ({ ...p, [k]: !p[k] }));

  const renderItem = (it: Item, nested = false) => {
    const active = it.href === activeHref;
    const badge = badgeFor(it);
    return (
      <Link key={it.href} href={it.href} onClick={() => setOpen(false)}
        className={`flex items-center gap-3 rounded-lg py-2 text-sm transition ${nested ? "px-3" : "px-3"}
          ${active ? "bg-white/15 font-medium" : "text-brand-100/80 hover:bg-white/10"}`}>
        <span className="text-base">{it.icon}</span>
        <span className="flex-1">{it.label}</span>
        {badge.count > 0 && <span title={badge.title} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{badge.count}</span>}
      </Link>
    );
  };

  const NavLinks = () => (
    <nav className="space-y-1 p-3">
      {/* عناصر مفردة (الرئيسية) */}
      {STANDALONE.map((h) => byHref[h]).filter((it) => it && permSet.has(it.perm)).map((it) => renderItem(it))}

      {/* المجموعات */}
      {NAV_GROUPS.map((g) => {
        const items = g.hrefs.map((h) => byHref[h]).filter((it) => it && permSet.has(it.perm));
        if (items.length === 0) return null;
        const isOpen = !!openGroups[g.key];
        const hasActive = items.some((it) => it.href === activeHref);
        const groupBadge = items.reduce((n, it) => n + badgeFor(it).count, 0);
        return (
          <div key={g.key}>
            <button onClick={() => toggleGroup(g.key)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition
                ${hasActive && !isOpen ? "bg-white/10 font-medium text-white" : "text-brand-100/90 hover:bg-white/10"}`}>
              <span className="text-base">{g.icon}</span>
              <span className="flex-1 text-right">{g.title}</span>
              {!isOpen && groupBadge > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{groupBadge}</span>}
              <span className={`text-[10px] text-brand-100/60 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>◀</span>
            </button>
            {isOpen && (
              <div className="mt-1 mr-3 space-y-1 border-r border-white/10 pr-2">
                {items.map((it) => renderItem(it, true))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
  const MobileQuickNav = () => {
    const items = MOBILE_QUICK_HREFS.map((h) => byHref[h]).filter((it) => it && permSet.has(it.perm));
    if (items.length === 0) return null;
    return (
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          {items.map((it) => {
            const active = it.href === activeHref;
            const badge = badgeFor(it);
            return (
              <Link key={it.href} href={it.href}
                className={`relative flex min-h-14 flex-col items-center justify-center rounded-xl px-1 text-[11px] font-medium ${active ? "bg-brand-50 text-brand-700" : "text-gray-600"}`}>
                <span className="text-lg leading-none">{it.icon}</span>
                <span className="mt-1 max-w-full truncate">{it.label.replace("استعلامات وحضور المراجعين", "الحضور")}</span>
                {badge.count > 0 && <span title={badge.title} className="absolute left-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{badge.count}</span>}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  };

  const Brand = () => (
    <div className="flex items-center gap-2 border-b border-white/10 px-5 py-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold">ت</div>
      <div className="text-sm font-bold leading-tight text-white">المجمع التأهيلي
        <br /><span className="text-xs font-normal text-brand-100/70">نظام المراجعين</span></div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <CommandPalette items={allItems} />
      <IdleTimeout minutes={20} />
      {/* القائمة الجانبية — ثابتة على الشاشات الكبيرة */}
      <aside className="no-print hidden bg-brand-900 text-white md:flex md:w-60 md:shrink-0 md:flex-col md:overflow-y-auto">
        <Brand />
        <NavLinks />
      </aside>

      {/* درج القائمة — للموبايل */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />
      )}
      <aside className={`no-print fixed inset-y-0 right-0 z-50 w-72 max-w-[86vw] overflow-y-auto bg-brand-900 text-white transform transition-transform duration-200 md:hidden
        ${open ? "translate-x-0" : "translate-x-full"}`}>
        <Brand />
        <NavLinks />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* الشريط العلوي */}
        <header className="no-print sticky top-0 z-30 border-b border-gray-200 bg-white/95 px-3 py-2 backdrop-blur md:px-6 md:py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <button className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-xl leading-none text-gray-700 md:hidden" onClick={() => setOpen(true)} aria-label="القائمة">☰</button>
              <div className="min-w-0 text-sm text-gray-500">
                أهلاً، <span className="font-medium text-gray-800">{name}</span>
                <span className="badge-brand mr-2 hidden sm:inline">{ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? ""}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <form action="/search" className="hidden items-center sm:flex">
                <input name="q" placeholder="بحث شامل..." className="input !w-40 !py-1 text-sm" aria-label="بحث شامل" autoComplete="off" />
              </form>
              <NotificationBell alerts={alerts} notifs={notifs} perms={perms} />
              <ThemeToggle />
              <Link href="/account" className="hidden text-xs text-gray-500 hover:text-brand-700 hover:underline sm:inline md:text-sm">حسابي</Link>
              <button className="btn-ghost btn-sm hidden sm:inline-flex" onClick={() => signOut({ callbackUrl: "/login" })}>تسجيل الخروج</button>
            </div>
          </div>
          <form action="/search" className="mt-2 sm:hidden">
            <input name="q" placeholder="بحث شامل عن مراجع أو ملف..." className="input !h-10" aria-label="بحث شامل" autoComplete="off" />
          </form>
        </header>

        <main className="flex-1 p-3 pb-24 sm:p-4 md:p-6 md:pb-6">{children}</main>
      </div>
      <MobileQuickNav />
    </div>
  );
}

function NotificationBell({ alerts, notifs = [], perms = [] }: { alerts?: AlertCounts; notifs?: any[]; perms?: string[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const permSet = new Set(perms);
  const a = alerts ?? { admOver: 0, devicesDue: 0, lowStock: 0, rxPending: 0, expiringSoon: 0, myTasks: 0, overdueTasks: 0, appointmentSoon: 0, backupStale: 0, backupStopped: 0 };
  const visibleNotifs = (notifs ?? []).filter((n: any) => canOpenNotification(n.link, permSet));
  const items = [
    { show: (a.myTasks ?? 0) > 0, label: "مهام مسندة لك", value: a.myTasks, href: "/tasks", kind: "tasks" },
    { show: (a.overdueTasks ?? 0) > 0, label: "مهام متأخرة", value: a.overdueTasks, href: "/tasks?status=overdue", kind: "tasks" },
    { show: (a.appointmentSoon ?? 0) > 0, label: "مواعيد قريبة خلال ساعتين", value: a.appointmentSoon, href: "/appointments", kind: "appointments" },
    { show: a.rxPending > 0, label: "وصفات بانتظار التجهيز", value: a.rxPending, href: "/pharmacy", kind: "inventory" },
    { show: a.expiringSoon > 0, label: "دفعات قريبة/منتهية النفاذية", value: a.expiringSoon, href: "/pharmacy/stock", kind: "inventory" },
    { show: a.lowStock > 0, label: "مواد منخفضة بالمخزون", value: a.lowStock, href: "/inventory", kind: "inventory" },
    { show: a.devicesDue > 0, label: "أجهزة بحاجة صيانة", value: a.devicesDue, href: "/devices?due=1", kind: "devices" },
    { show: a.admOver > 0, label: "رقود انتهى وقته", value: a.admOver, href: "/#admissions", kind: "system" },
    { show: (a.backupStale ?? 0) > 0, label: "لا توجد نسخة احتياطية حديثة", value: a.backupStale, href: "/backup", kind: "system" },
    { show: (a.backupStopped ?? 0) > 0, label: "النسخ التلقائي متوقف", value: a.backupStopped, href: "/backup", kind: "system" },
  ].filter((i) => i.show && canOpenNotification(i.href, permSet));
  const total = items.reduce((sum, i) => sum + Number(i.value || 0), 0) + visibleNotifs.length;

  useEffect(() => {
    if (total <= 0) return;
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.05;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.18);
    } catch {}
  }, [total]);

  // تذكير سطح المكتب: إشعار نظام مرّة باليوم عند وجود بنود معلّقة (إن مُنح الإذن)
  useEffect(() => {
    if (!mounted || total <= 0) return;
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const key = "tahili-notified-" + new Date().toDateString();
      if (sessionStorage.getItem(key)) return;
      const body = [...visibleNotifs.slice(0, 3).map((n: any) => n.title), ...items.map((i) => `${i.label}: ${i.value}`)].join("، ");
      new Notification("تنبيهات المجمع التأهيلي", { body: body || `${total} بند بحاجة متابعة`, icon: "/icon-192.png", tag: "tahili-alerts" });
      sessionStorage.setItem(key, "1");
    } catch {}
  }, [mounted, total]);

  const enableNotifications = () => { try { if (typeof Notification !== "undefined") Notification.requestPermission(); } catch {} };
  const needsPermission = mounted && typeof Notification !== "undefined" && Notification.permission === "default";

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-lg leading-none" title="الإشعارات" aria-label="الإشعارات">
        🔔
        {total > 0 && <span className="absolute -top-1 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{total}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed left-3 right-3 top-20 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-lg sm:absolute sm:left-0 sm:right-auto sm:top-auto sm:mt-2 sm:max-h-96 sm:w-72">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs font-semibold text-gray-500">الإشعارات</span>
              <Link href="/notifications" onClick={() => setOpen(false)} className="text-[11px] text-gray-500 hover:text-brand-700 hover:underline">مركز التنبيهات</Link>
              {visibleNotifs.length > 0 && <form action={markAllNotificationsRead}><button className="text-[11px] text-brand-600 hover:underline">تعليم الكل كمقروء</button></form>}
            </div>
            {visibleNotifs.map((n: any) => {
              const tone = notificationTone(n);
              return (
              <Link key={n.id} href={n.link || "/notifications"} onClick={() => setOpen(false)}
                className="mb-1 block rounded-lg border border-gray-100 bg-white px-2 py-2 text-sm hover:bg-gray-50">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone.className}`}>{tone.icon} {tone.label}</span>
                  <span className="font-medium text-gray-800">{n.title}</span>
                </div>
                {n.body && <div className="text-xs text-gray-500">{n.body}</div>}
              </Link>
            );})}
            {items.length === 0 && visibleNotifs.length === 0 && <div className="px-2 py-3 text-center text-sm text-gray-400">لا توجد تنبيهات.</div>}
            {items.map((i) => (
              <Link key={i.label} href={i.href} onClick={() => setOpen(false)}
                className="mb-1 flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-gray-50">
                <span className="text-gray-700">{notificationTone({ link: i.href }).icon} {i.label}</span>
                <span className="rounded bg-red-50 px-1.5 text-xs font-bold text-red-700">{i.value}</span>
              </Link>
            ))}
            {needsPermission && (
              <button onClick={enableNotifications} className="mt-1 w-full rounded-lg bg-brand-50 px-2 py-2 text-xs font-medium text-brand-700 hover:bg-brand-100">🔔 تفعيل تنبيهات سطح المكتب</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}


function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.theme = next ? "dark" : "light"; } catch {}
    setDark(next);
  };
  return (
    <button onClick={toggle} title="الوضع الداكن" className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-lg leading-none">{dark ? "☀️" : "🌙"}</button>
  );
}
