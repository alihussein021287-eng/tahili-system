"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveShortcuts } from "@/app/(app)/shortcuts-actions";

type Cand = { href: string; label: string; icon: string };

export function ShortcutsEditor({ candidates, current }: { candidates: Cand[]; current: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(current);
  const [pending, start] = useTransition();

  const toggle = (href: string) =>
    setSel((s) => (s.includes(href) ? s.filter((x) => x !== href) : [...s, href]));

  const save = () => start(async () => { await saveShortcuts(sel); setOpen(false); router.refresh(); });

  return (
    <>
      <button onClick={() => { setSel(current); setOpen(true); }} className="btn-ghost text-sm">⚙ تخصيص الاختصارات</button>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-bold text-gray-800">اختصاراتي السريعة</h3>
            <p className="mb-3 text-xs text-gray-400">اختر ما يظهر لك في الرئيسية (حتى 12).</p>
            <div className="flex flex-wrap gap-2">
              {candidates.map((c) => (
                <button key={c.href} onClick={() => toggle(c.href)}
                  className={`rounded-full px-3 py-1.5 text-sm ${sel.includes(c.href) ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn-ghost text-sm">إلغاء</button>
              <button onClick={save} disabled={pending} className="btn-primary text-sm">{pending ? "يحفظ..." : "حفظ"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
