"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Item = { href: string; label: string; icon?: string };

export function CommandPalette({ items }: { items: Item[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = q.trim()
    ? items.filter((it) => it.label.includes(q.trim()))
    : items;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); setOpen((v) => !v); setQ(""); setIdx(0);
      } else if (e.key === "/" && !typing && !open) {
        const s = document.querySelector('input[placeholder*="بحث"]') as HTMLInputElement | null;
        if (s) { e.preventDefault(); s.focus(); }
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  function go(href: string) { setOpen(false); router.push(href); }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[idx]) go(filtered[idx].href); }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={onInputKey}
          placeholder="اكتب للانتقال السريع... (Ctrl+K)"
          className="w-full border-b border-gray-100 px-4 py-3 text-base outline-none"
        />
        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-gray-400">لا نتائج</div>}
          {filtered.map((it, i) => (
            <button
              key={`${it.href}:${it.label}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => go(it.href)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-right text-sm ${i === idx ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-50"}`}
            >
              <span className="w-5 text-center">{it.icon}</span>
              <span>{it.label}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">↑↓ للتنقّل • Enter للفتح • Esc للإغلاق • «/» للبحث</div>
      </div>
    </div>
  );
}
