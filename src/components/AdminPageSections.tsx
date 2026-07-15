import Link from "next/link";
import type { ReactNode } from "react";

type SectionLink = {
  href: string;
  label: string;
};

export function AdminSectionNav({ items, label = "أقسام الصفحة" }: { items: SectionLink[]; label?: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <nav className="flex gap-2 overflow-x-auto" aria-label={label}>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function AdminIntro({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      <p className="mt-1 text-sm text-gray-600">{description}</p>
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

export function AdminSection({
  id,
  title,
  description,
  children,
  className = "",
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`card min-w-0 space-y-4 p-5 ${className}`}>
      <div>
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminSectionHeader({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  description,
  tone = "text-gray-800",
}: {
  label: string;
  value: ReactNode;
  description?: string;
  tone?: string;
}) {
  return (
    <div className="card p-4">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
      {description ? <div className="mt-1 text-xs text-gray-400">{description}</div> : null}
    </div>
  );
}
