import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";

export type UiTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<UiTone, string> = {
  neutral: "badge-neutral",
  brand: "badge-brand",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
};

export function PageTabs({
  tabs,
  active,
  label = "تبويبات الصفحة",
}: {
  tabs: { key: string; href: string; label: string; count?: number }[];
  active: string;
  label?: string;
}) {
  return (
    <nav className="page-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={active === tab.key ? "page-tab page-tab-active" : "page-tab"}
        >
          <span>{tab.label}</span>
          {typeof tab.count === "number" && tab.count > 0 ? <span className="page-tab-count">{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`section-card ${className}`} {...props}>
      {title || description || action ? (
        <div className="section-card-header">
          <div className="min-w-0">
            {title ? <h2 className="section-card-title">{title}</h2> : null}
            {description ? <p className="section-card-description">{description}</p> : null}
          </div>
          {action ? <div className="section-card-action">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  description,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  description?: string;
  tone?: UiTone;
}) {
  return (
    <div className={`stat-card stat-card-${tone}`}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      {description ? <div className="stat-card-description">{description}</div> : null}
    </div>
  );
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: UiTone }) {
  return <span className={toneClasses[tone]}>{children}</span>;
}

export function EmptyState({
  title = "لا توجد بيانات",
  description = "ستظهر العناصر هنا عند إضافتها.",
  action,
  compact = false,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "empty-state empty-state-compact" : "empty-state"} role="status">
      <div className="empty-state-icon" aria-hidden="true">○</div>
      <div className="font-semibold text-gray-800">{title}</div>
      <p className="mt-1 max-w-lg text-sm text-gray-500">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "جارٍ تحميل البيانات..." }: { label?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = "تعذر تحميل البيانات",
  description = "أعد المحاولة، وإذا استمرت المشكلة تواصل مع مسؤول النظام.",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="error-state" role="alert">
      <div className="font-semibold">{title}</div>
      <p className="mt-1 text-sm">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function FilterBar({ children, results, activeFilters }: { children: ReactNode; results?: number; activeFilters?: number }) {
  return (
    <div className="filter-bar">
      <div className="filter-bar-fields">{children}</div>
      {typeof results === "number" ? (
        <div className="filter-bar-summary" aria-live="polite">
          {results} نتيجة{activeFilters ? `، ${activeFilters} فلتر نشط` : ""}
        </div>
      ) : null}
    </div>
  );
}

export function DataTable({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="data-table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function MobileList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mobile-list ${className}`}>{children}</div>;
}

export function FormField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="form-field">
      <span className="label">{label}{required ? <span className="mr-1 text-red-600">*</span> : null}</span>
      {children}
      {hint ? <span className="form-hint">{hint}</span> : null}
    </label>
  );
}

export function ActionMenu({ label = "إجراءات", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="action-menu">
      <summary className="action-menu-trigger" aria-label={label} title={label}>•••</summary>
      <div className="action-menu-content">{children}</div>
    </details>
  );
}

export function ConfirmDialog({
  summary,
  title,
  description,
  children,
}: {
  summary: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details className="confirm-dialog">
      <summary className="list-none">{summary}</summary>
      <div className="confirm-dialog-panel" role="alertdialog" aria-label={title}>
        <div className="font-semibold text-gray-900">{title}</div>
        <p className="mt-1 text-sm text-gray-600">{description}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">{children}</div>
      </div>
    </details>
  );
}
