"use client";
import { useState, useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { markAllNotificationsRead } from "@/lib/notif-actions";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { ROLE_LABELS } from "@/lib/permissions";
import { IdleTimeout } from "./IdleTimeout";
import { CommandPalette } from "./CommandPalette";
import { PresencePing } from "./PresencePing";
import { canOpenNotification, notificationTone } from "@/lib/notifications";
import type { PresenceConfig } from "@/lib/presence";
import { isThemePreference, resolveTheme, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import {
  ALL_ITEMS as REGISTRY_ITEMS,
  MOBILE_QUICK_HREFS as REGISTRY_MOBILE_QUICK_HREFS,
  NAV_GROUPS as REGISTRY_NAV_GROUPS,
  ROLE_SIDEBAR_RULES as REGISTRY_ROLE_SIDEBAR_RULES,
  STANDALONE as REGISTRY_STANDALONE,
  navigationGroupChildren,
  type NavigationGroup,
  type NavigationItem,
} from "@/lib/work-registry";

type Item = NavigationItem;
type NavGroup = NavigationGroup;
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

export function AppShell({
  role,
  name,
  alerts,
  perms = [],
  notifs = [],
  presenceConfig,
  children,
}: {
  role?: any;
  name: string;
  alerts?: AlertCounts;
  perms?: string[];
  notifs?: any[];
  presenceConfig?: PresenceConfig;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  const searchParams = useSearchParams();

  const permSet = new Set(perms);
  const hasAccess = (it: Item) => (it.perm ? permSet.has(it.perm) : false) || (it.perms?.some((perm) => permSet.has(perm)) ?? false);
  const allItems = REGISTRY_ITEMS.filter(hasAccess);
  const sidebarRule = role === "ADMIN" ? undefined : REGISTRY_ROLE_SIDEBAR_RULES[role as keyof typeof REGISTRY_ROLE_SIDEBAR_RULES];
  const roleAllowsStandalone = (href: string) => !sidebarRule || sidebarRule.standalone.includes(href);
  const roleAllowsGroup = (key: string) => !sidebarRule || sidebarRule.groups.includes(key);
  const roleAllowsHref = (href: string) => !sidebarRule?.hrefs || sidebarRule.hrefs.includes(href);
  const byHref: Record<string, Item> = {};
  for (const it of REGISTRY_ITEMS) byHref[it.href] = it;
  // ربط كل نوع إشعار بصفحته — تظهر كشارة على القائمة (نفس فكرة شارة الصيدلية)
  const a = alerts ?? { admOver: 0, devicesDue: 0, lowStock: 0, rxPending: 0, expiringSoon: 0, myTasks: 0, overdueTasks: 0, appointmentSoon: 0 };
  const ALERT_BY_HREF: Record<string, { count: number; title: string }> = {
    "/patients-care?tab=overview": { count: a.appointmentSoon ?? 0, title: "مواعيد قريبة ضمن المرضى والرعاية" },
    "/patients-care?tab=appointments": { count: a.appointmentSoon ?? 0, title: "مواعيد قريبة خلال ساعتين" },
    "/therapy-centers?tab=overview": { count: a.admOver ?? 0, title: "رقود أو مسارات علاجية تحتاج متابعة" },
    "/therapy-centers?tab=beds": { count: a.admOver ?? 0, title: "رقود انتهت مدته" },
    "/pharmacy-inventory?tab=overview": { count: (a.rxPending ?? 0) + (a.expiringSoon ?? 0) + (a.lowStock ?? 0), title: "وصفات ونواقص ودفعات تحتاج متابعة" },
    "/pharmacy-inventory?tab=dispense": { count: a.rxPending ?? 0, title: "وصفات قيد الانتظار" },
    "/pharmacy-inventory?tab=batches": { count: a.expiringSoon ?? 0, title: "دفعات قريبة أو منتهية النفاذ" },
    "/pharmacy-inventory?tab=stock": { count: a.lowStock ?? 0, title: "مواد منخفضة بالمخزون" },
    "/devices": { count: a.devicesDue ?? 0, title: "أجهزة تحتاج صيانة" },
    "/staff?tab=overview": { count: (a.myTasks ?? 0) + (a.overdueTasks ?? 0), title: `مهام مفتوحة${(a.overdueTasks ?? 0) > 0 ? `، منها ${a.overdueTasks} متأخرة` : ""}` },
    "/staff?tab=tasks": { count: (a.myTasks ?? 0) + (a.overdueTasks ?? 0), title: `مهام مفتوحة${(a.overdueTasks ?? 0) > 0 ? `، منها ${a.overdueTasks} متأخرة` : ""}` },
    "/collaboration": { count: a.collaborationUnread ?? 0, title: "رسائل تعاون غير مقروءة" },
  };
  const badgeFor = (it: Item) => {
    const raw = ALERT_BY_HREF[it.href] ?? 0;
    return typeof raw === "number" ? { count: raw, title: "" } : raw;
  };

  const queryMatches = (hrefQuery: string) => {
    const expected = new URLSearchParams(hrefQuery);
    for (const [key, value] of expected.entries()) {
      if (searchParams.get(key) !== value) return false;
    }
    return true;
  };
  const itemMatches = (it: Item) => {
    if (it.href === "/") return path === "/";
    const [hrefPath, hrefQuery = ""] = it.href.split("?");
    if (path !== hrefPath && !path.startsWith(`${hrefPath}/`)) return false;
    return hrefQuery ? path === hrefPath && queryMatches(hrefQuery) : true;
  };
  const matches = REGISTRY_ITEMS.filter(itemMatches);
  const matchedHref = matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? "";
  const legacyActiveHref =
    path === "/patients-care" ? "/patients-care?tab=overview" :
    path === "/queue" ? "/patients-care?tab=queue" :
    path === "/appointments" || path.startsWith("/appointments/") ? "/patients-care?tab=appointments" :
    path === "/visits" ? "/patients-care?tab=visits" :
    path === "/search" ? "/patients-care?tab=visits" :
    path === "/referrals" || path.startsWith("/referrals/") ? "/patients-care?tab=referrals" :
    path === "/patients" || path.startsWith("/patients/") ? "/patients-care?tab=patients" :
    path === "/care-board" || path === "/station-kpis" ? "/patients-care?tab=journey" :
    path === "/therapy-centers" ? "/therapy-centers?tab=overview" :
    path === "/therapy/today" ? "/therapy-centers?tab=today" :
    path === "/therapy" || path.startsWith("/therapy/") ? "/therapy-centers?tab=plans" :
    path === "/centers" || path.startsWith("/centers/") ? "/therapy-centers?tab=centers" :
    path === "/beds" ? "/therapy-centers?tab=beds" :
    path === "/meds" ? "/therapy-centers?tab=meds" :
    path === "/reports-finance" ? "/reports-finance?tab=overview" :
    path === "/reports" || path.startsWith("/reports/") || path === "/official-docs" || path.startsWith("/official-docs/") ? "/reports-finance?tab=official" :
    path === "/finance" || path.startsWith("/finance/") ? "/reports-finance?tab=finance" :
    path === "/approvals" ? "/reports-finance?tab=approvals" :
    path === "/pharmacy-inventory" ? "/pharmacy-inventory?tab=overview" :
    path === "/pharmacy" || path.startsWith("/pharmacy/") ? "/pharmacy-inventory?tab=dispense" :
    path === "/inventory" ? "/pharmacy-inventory?tab=stock" :
    path === "/staff" ? "/staff?tab=overview" :
    path === "/tasks" ? "/staff?tab=tasks" :
    path === "/attendance" ? "/staff?tab=attendance" :
    path === "/shifts" ? "/staff?tab=shifts" :
    "";
  const activeHref = matchedHref || legacyActiveHref;
  const activeGroupKey = REGISTRY_NAV_GROUPS.find((g) => g.hrefs.includes(activeHref))?.key ?? "";

  // حالة الطي لكل مجموعة — تبدأ مفتوحة على المجموعة الفعّالة
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of REGISTRY_NAV_GROUPS) init[g.key] = g.key === activeGroupKey;
    return init;
  });
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("tahili-sidebar-collapsed") === "1");
      const saved = localStorage.getItem("tahili-sidebar-groups");
      if (saved) setOpenGroups((current) => ({ ...current, ...JSON.parse(saved) }));
    } catch {}
  }, []);
  // افتح مجموعة الصفحة الحالية تلقائياً عند التنقل (دون طيّ ما فتحه المستخدم)
  useEffect(() => {
    if (activeGroupKey) setOpenGroups((p) => (p[activeGroupKey] ? p : { ...p, [activeGroupKey]: true }));
  }, [activeGroupKey]);

  useEffect(() => {
    try { localStorage.setItem("tahili-sidebar-groups", JSON.stringify(openGroups)); } catch {}
  }, [openGroups]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      mobileMenuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("tahili-sidebar-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const toggleGroup = (k: string) => setOpenGroups((p) => ({ ...p, [k]: !p[k] }));

  const renderItem = (it: Item, nested = false, compact = false) => {
    const active = it.href === activeHref;
    const badge = badgeFor(it);
    const label = nested ? it.navLabel ?? it.label : it.label;
    return (
      <Link key={it.href} href={it.href} onClick={() => setOpen(false)}
        title={compact ? label : undefined}
        aria-label={compact ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-lg py-2 text-sm transition ${compact ? "justify-center px-2" : "px-3"}
          ${active ? "bg-white/15 font-medium" : "text-brand-100/80 hover:bg-white/10"}`}>
        <span className="shrink-0 text-base">{it.icon}</span>
        {!compact && <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>}
        {badge.count > 0 && <span title={badge.title} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{badge.count}</span>}
      </Link>
    );
  };
  const renderGroupLink = (group: NavGroup, it: Item, compact = false) => {
    const active = it.href === activeHref;
    const badge = badgeFor(it);
    const label = it.navLabel === "نظرة عامة" ? group.title : it.label;
    return (
      <Link key={group.key} href={it.href} onClick={() => setOpen(false)} title={compact ? label : undefined} aria-label={compact ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-lg py-2 text-sm transition ${compact ? "justify-center px-2" : "px-3"} ${active ? "bg-white/15 font-medium" : "text-brand-100/80 hover:bg-white/10"}`}>
        <span className="shrink-0 text-base">{group.icon}</span>
        {!compact && <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>}
        {badge.count > 0 && <span title={badge.title} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{badge.count}</span>}
      </Link>
    );
  };

  const NavLinks = ({ compact = false }: { compact?: boolean }) => (
    <nav className="space-y-1 p-3">
      {/* عناصر مفردة (الرئيسية) */}
      {REGISTRY_STANDALONE.map((h) => byHref[h]).filter((it) => it && hasAccess(it) && roleAllowsStandalone(it.href)).map((it) => renderItem(it, false, compact))}

      {/* المجموعات */}
      {REGISTRY_NAV_GROUPS.map((g) => {
        if (!roleAllowsGroup(g.key)) return null;
        const groupItem = byHref[g.href];
        const groupLink = groupItem && hasAccess(groupItem) ? groupItem : undefined;
        const items = navigationGroupChildren(g).map((h) => byHref[h]).filter((it) => it && hasAccess(it) && roleAllowsHref(it.href));
        if (items.length === 0) return groupLink ? renderGroupLink(g, groupLink, compact) : null;
        const isOpen = !compact && !!openGroups[g.key];
        const hasActive = groupLink?.href === activeHref || items.some((it) => it.href === activeHref);
        const groupBadge = items.reduce((n, it) => n + badgeFor(it).count, 0);
        const headerLink = groupLink ?? items[0];
        const headerActive = hasActive;
        return (
          <div key={g.key}>
            <div className="flex items-center gap-1">
              <Link href={headerLink.href} onClick={() => setOpen(false)}
                title={compact ? g.title : undefined}
                aria-label={compact ? g.title : undefined}
                aria-current={headerLink.href === activeHref ? "page" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg py-2 text-sm transition ${compact ? "justify-center px-2" : "px-3"}
                  ${headerActive ? "bg-white/15 font-medium text-white" : "text-brand-100/90 hover:bg-white/10"}`}>
                <span className="shrink-0 text-base">{g.icon}</span>
                {!compact && <span className="min-w-0 flex-1 truncate text-right" title={g.title}>{g.title}</span>}
                {!isOpen && groupBadge > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{groupBadge}</span>}
              </Link>
              {!compact && <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                aria-controls={`sidebar-group-${g.key}`}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "إغلاق" : "فتح"} روابط ${g.title}`}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] text-brand-100/70 transition hover:bg-white/10 ${hasActive && !isOpen ? "bg-white/10 text-white" : ""}`}
              >
                <span className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>◀</span>
              </button>}
            </div>
            {isOpen && (
              <div id={`sidebar-group-${g.key}`} className="mt-1 mr-3 space-y-1 border-r border-white/10 pr-2">
                {items.map((it) => renderItem(it, true))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
  const MobileQuickNav = () => {
    const items = REGISTRY_MOBILE_QUICK_HREFS.map((h) => byHref[h]).filter((it) => it && hasAccess(it) && roleAllowsHref(it.href));
    if (items.length === 0) return null;
    return (
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          {items.map((it) => {
            const active = it.href === activeHref;
            const badge = badgeFor(it);
            return (
              <Link key={it.href} href={it.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center rounded-xl px-1 text-[11px] font-medium ${active ? "bg-brand-50 text-brand-700" : "text-gray-600"}`}>
                <span className="text-lg leading-none">{it.icon}</span>
                <span className="mt-1 max-w-full truncate">{it.label}</span>
                {badge.count > 0 && <span title={badge.title} className="absolute left-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{badge.count}</span>}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  };

  const Brand = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex items-center border-b border-white/10 py-4 ${compact ? "justify-center px-2" : "gap-2 px-5"}`}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold">ت</div>
      {!compact && <div className="text-sm font-bold leading-tight text-white">المجمع التأهيلي
        <br /><span className="text-xs font-normal text-brand-100/70">نظام المراجعين</span></div>
      }
    </div>
  );

  const activeItem = byHref[activeHref];
  const activeGroup = REGISTRY_NAV_GROUPS.find((group) => group.key === activeGroupKey);
  const breadcrumbLabel = activeItem?.navLabel ?? activeItem?.label;

  return (
    <div className="flex min-h-screen">
      <a href="#main-content" className="skip-link">تخطي إلى المحتوى</a>
      <CommandPalette items={allItems} />
      <IdleTimeout minutes={20} />
      <PresencePing config={presenceConfig} />
      {/* القائمة الجانبية — ثابتة على الشاشات الكبيرة */}
      <aside className={`no-print hidden bg-brand-900 text-white transition-[width] md:flex md:shrink-0 md:flex-col md:overflow-y-auto ${collapsed ? "md:w-[4.5rem]" : "md:w-60"}`}>
        <Brand compact={collapsed} />
        <NavLinks compact={collapsed} />
        <button type="button" onClick={toggleCollapsed} className="mt-auto flex min-h-11 items-center justify-center border-t border-white/10 px-3 text-sm text-brand-100/80 hover:bg-white/10 focus-visible:outline-white" aria-label={collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"} title={collapsed ? "توسيع القائمة" : "طي القائمة"}>
          <span aria-hidden="true">{collapsed ? "◀" : "▶"}</span>{!collapsed && <span className="mr-2">طي القائمة</span>}
        </button>
      </aside>

      {/* درج القائمة — للموبايل */}
      {open && (
        <button type="button" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => {
          setOpen(false);
          mobileMenuButtonRef.current?.focus();
        }} aria-label="إغلاق القائمة الرئيسية" />
      )}
      <aside id="mobile-sidebar" aria-label="القائمة الرئيسية" aria-hidden={!open} inert={!open ? true : undefined} className={`no-print fixed inset-y-0 right-0 z-50 w-72 max-w-[86vw] overflow-y-auto overscroll-contain bg-brand-900 text-white transform transition-transform duration-200 md:hidden
        ${open ? "translate-x-0" : "translate-x-full"}`}>
        <Brand />
        <NavLinks />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* الشريط العلوي */}
        <header className="no-print sticky top-0 z-30 border-b border-gray-200 bg-white/95 px-3 py-2 backdrop-blur md:px-6 md:py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <button ref={mobileMenuButtonRef} className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-xl leading-none text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 md:hidden" onClick={() => setOpen(true)} aria-label="فتح القائمة الرئيسية" aria-expanded={open} aria-controls="mobile-sidebar">☰</button>
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
              <details className="action-menu hidden sm:block">
                <summary className="flex h-10 min-w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700" aria-label="قائمة الحساب">{name.split(" ")[0]}</summary>
                <div className="action-menu-content">
                  <Link href="/account">إعدادات الحساب</Link>
                  <button type="button" onClick={() => signOut({ callbackUrl: "/login" })}>تسجيل الخروج</button>
                </div>
              </details>
            </div>
          </div>
          <form action="/search" className="mt-2 sm:hidden">
            <input name="q" placeholder="بحث شامل عن مراجع أو ملف..." className="input !h-10" aria-label="بحث شامل" autoComplete="off" />
          </form>
        </header>

        {breadcrumbLabel && path !== "/" ? (
          <nav className="no-print flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2 text-xs text-gray-500 md:px-6" aria-label="مسار الصفحة">
            <Link href="/" className="hover:text-brand-700">الرئيسية</Link>
            <span aria-hidden="true">/</span>
            {activeGroup && activeGroup.title !== breadcrumbLabel ? <><Link href={activeGroup.href} className="hover:text-brand-700">{activeGroup.title}</Link><span aria-hidden="true">/</span></> : null}
            <span aria-current="page" className="font-medium text-gray-700">{breadcrumbLabel}</span>
          </nav>
        ) : null}

        <main id="main-content" tabIndex={-1} className="flex-1 p-3 pb-24 sm:p-4 md:p-6 md:pb-6">{children}</main>
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
    { show: (a.myTasks ?? 0) > 0, label: "مهام مسندة لك", value: a.myTasks, href: "/staff?tab=tasks", kind: "tasks" },
    { show: (a.overdueTasks ?? 0) > 0, label: "مهام متأخرة", value: a.overdueTasks, href: "/staff?tab=tasks&taskStatus=overdue", kind: "tasks" },
    { show: (a.appointmentSoon ?? 0) > 0, label: "مواعيد قريبة خلال ساعتين", value: a.appointmentSoon, href: "/patients-care?tab=appointments", kind: "appointments" },
    { show: a.rxPending > 0, label: "وصفات بانتظار التجهيز", value: a.rxPending, href: "/pharmacy-inventory?tab=dispense", kind: "inventory" },
    { show: a.expiringSoon > 0, label: "دفعات قريبة/منتهية النفاذية", value: a.expiringSoon, href: "/pharmacy-inventory?tab=batches&batchState=soon", kind: "inventory" },
    { show: a.lowStock > 0, label: "مواد منخفضة بالمخزون", value: a.lowStock, href: "/pharmacy-inventory?tab=stock&stockState=low", kind: "inventory" },
    { show: a.devicesDue > 0, label: "أجهزة بحاجة صيانة", value: a.devicesDue, href: "/devices?due=1", kind: "devices" },
    { show: a.admOver > 0, label: "رقود انتهى وقته", value: a.admOver, href: "/therapy-centers?tab=beds", kind: "system" },
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
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let stored: string | null = null;
    try { stored = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem("theme"); } catch {}
    const initial = isThemePreference(stored) ? stored : "system";
    const apply = (value: ThemePreference) => {
      const next = resolveTheme(value, media.matches);
      document.documentElement.classList.toggle("dark", next === "dark");
      document.documentElement.dataset.theme = value;
      document.documentElement.style.colorScheme = next;
      setResolved(next);
    };
    setPreference(initial);
    try { localStorage.setItem(THEME_STORAGE_KEY, initial); } catch {}
    apply(initial);
    const onSystemChange = () => {
      const current = document.documentElement.dataset.theme;
      if (current === "system") apply("system");
    };
    media.addEventListener("change", onSystemChange);
    return () => media.removeEventListener("change", onSystemChange);
  }, []);

  const selectTheme = (value: ThemePreference, event: MouseEvent<HTMLButtonElement>) => {
    const mediaDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = resolveTheme(value, mediaDark);
    try { localStorage.setItem(THEME_STORAGE_KEY, value); } catch {}
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = next;
    setPreference(value);
    setResolved(next);
    const details = event.currentTarget.closest("details");
    if (details) details.open = false;
  };

  const icon = preference === "system" ? "◐" : resolved === "dark" ? "☾" : "☀";
  const labels: Record<ThemePreference, string> = { light: "فاتح", dark: "داكن", system: "حسب النظام" };
  return (
    <details className="action-menu">
      <summary title={`المظهر: ${labels[preference]}`} aria-label={`اختيار المظهر، الحالي ${labels[preference]}`} className="action-menu-trigger text-lg leading-none">{icon}</summary>
      <div className="action-menu-content" role="menu" aria-label="المظهر">
        {(["light", "dark", "system"] as ThemePreference[]).map((value) => (
          <button key={value} type="button" role="menuitemradio" aria-checked={preference === value} onClick={(event) => selectTheme(value, event)}>
            <span className="w-5" aria-hidden="true">{value === "light" ? "☀" : value === "dark" ? "☾" : "◐"}</span>
            <span>{labels[value]}</span>
            {preference === value ? <span className="mr-auto text-brand-600" aria-hidden="true">✓</span> : null}
          </button>
        ))}
      </div>
    </details>
  );
}
