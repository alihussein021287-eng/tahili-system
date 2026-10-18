import type { ReactNode } from "react";

/** Secondary page actions folded under one button; the main action stays a visible button beside it. */
export function ToolsMenu({ children, label = "أدوات" }: { children: ReactNode; label?: string }) {
  return (
    <details className="relative">
      <summary className="btn-ghost cursor-pointer list-none [&::-webkit-details-marker]:hidden">{label} <span aria-hidden="true">▾</span></summary>
      <div className="absolute left-0 z-20 mt-2 flex min-w-52 flex-col gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900 [&>a]:rounded-lg [&>a]:px-3 [&>a]:py-2 [&>a]:text-sm [&>a:hover]:bg-gray-50 dark:[&>a:hover]:bg-slate-800">
        {children}
      </div>
    </details>
  );
}
