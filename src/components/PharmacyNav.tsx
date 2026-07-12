"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/pharmacy", label: "قائمة التجهيز", exact: true },
  { href: "/pharmacy/stock", label: "المخزون والدفعات" },
  { href: "/pharmacy/purchases", label: "أوامر الشراء" },
  { href: "/pharmacy/log", label: "سجل الحركة" },
  { href: "/pharmacy/reports", label: "التقارير" },
];

export function PharmacyNav() {
  const path = usePathname();
  return (
    <div className="no-print flex flex-wrap gap-1.5">
      {TABS.map((t) => {
        const active = t.exact ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${active ? "bg-brand-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
