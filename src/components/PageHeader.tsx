import React from "react";

export function PageHeader({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: string; children?: React.ReactNode }) {
  return (
    <header className="page-header no-print">
      <div className="flex items-center gap-3">
        {icon && <div className="page-header-icon" aria-hidden="true">{icon}</div>}
        <div className="min-w-0">
          <h1 className="page-header-title">{title}</h1>
          {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  );
}

// زر فاتح يُستعمل داخل ترويسة ملوّنة
export function HeaderBtn({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`btn-ghost ${className}`}>{children}</span>;
}
