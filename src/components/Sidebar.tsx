"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { canManageUsers } from "@/lib/permissions";

const items = [
  { href: "/", label: "الرئيسية", icon: "▤" },
  { href: "/workspaces", label: "مساحات العمل", icon: "▧" },
  { href: "/patients", label: "المراجعون", icon: "☺" },
  { href: "/reports", label: "التقارير", icon: "▦" },
];

export function Sidebar({ role }: { role?: any }) {
  const path = usePathname();
  return (
    <aside className="no-print w-60 shrink-0 bg-brand-900 text-white">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold">ت</div>
        <div className="text-sm font-bold leading-tight">المجمع التأهيلي<br/><span className="text-xs font-normal text-brand-100/70">نظام المراجعين</span></div>
      </div>
      <nav className="p-3 space-y-1">
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link key={it.href} href={it.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition
                ${active ? "bg-white/15 font-medium" : "text-brand-100/80 hover:bg-white/10"}`}>
              <span className="text-base">{it.icon}</span>{it.label}
            </Link>
          );
        })}
        {canManageUsers(role) && (
          <Link href="/users"
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition
              ${path.startsWith("/users") ? "bg-white/15 font-medium" : "text-brand-100/80 hover:bg-white/10"}`}>
            <span className="text-base">⚙</span>المستخدمون
          </Link>
        )}
        {canManageUsers(role) && (
          <Link href="/settings"
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition
              ${path.startsWith("/settings") ? "bg-white/15 font-medium" : "text-brand-100/80 hover:bg-white/10"}`}>
            <span className="text-base">▥</span>الإعدادات
          </Link>
        )}
      </nav>
    </aside>
  );
}
