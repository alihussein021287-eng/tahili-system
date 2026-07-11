import React from "react";

export function PageHeader({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: string; children?: React.ReactNode }) {
  return (
    <div className="no-print flex flex-col gap-3 rounded-2xl bg-gradient-to-l from-brand-700 to-brand-600 p-5 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {icon && <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-xl">{icon}</div>}
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          {subtitle && <p className="text-sm text-brand-50/80">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

// زر فاتح يُستعمل داخل ترويسة ملوّنة
export function HeaderBtn({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-xl bg-white/15 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/25 ${className}`}>{children}</span>;
}
