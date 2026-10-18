"use client";

import { useState, type ReactNode } from "react";

/**
 * One search line, with the other filters folded under "فلاتر". The panel starts open when a
 * filter is already applied, and the button says how many are, so a filtered list never looks
 * like the full one.
 */
export function FilterBar({
  action, query, queryName = "q", placeholder, activeCount, clearHref, hidden, children, search = true,
}: {
  action: string;
  query?: string;
  queryName?: string;
  placeholder: string;
  /** false when the list has no free-text search, only the folded filters. */
  search?: boolean;
  activeCount: number;
  clearHref: string;
  hidden?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(activeCount > 0);
  return (
    <form action={action} className="card space-y-3 p-3" autoComplete="off" role="search">
      {hidden}
      <div className="flex flex-wrap items-center gap-2">
        {search ? <input name={queryName} defaultValue={query ?? ""} placeholder={placeholder} aria-label={placeholder} className="input min-w-[200px] flex-1" /> : <span className="flex-1 text-sm text-gray-500">{placeholder}</span>}
        {children ? (
          <button type="button" className="btn-ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            فلاتر{activeCount ? ` (${activeCount})` : ""} <span aria-hidden="true">{open ? "▴" : "▾"}</span>
          </button>
        ) : null}
        <button type="submit" className="btn-primary">{search ? "بحث" : "تطبيق"}</button>
        {activeCount || query ? <a href={clearHref} className="btn-ghost">مسح</a> : null}
      </div>
      {children ? (
        <div hidden={!open} className="grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          {children}
        </div>
      ) : null}
    </form>
  );
}
