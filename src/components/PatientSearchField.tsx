"use client";
import { useEffect, useRef, useState } from "react";

type Opt = { value: string; label: string };

/**
 * Patient selector backed by the server-side search endpoint (/api/patients/picker). Same markup contract as Combobox
 * (hidden input named `name`, then a combobox input and option buttons) so forms, validation and tests keep working.
 * Results are bounded pages; "المزيد" loads the next stable page. Nothing outside the caller's scope can appear.
 */
export function PatientSearchField({
  name, label, required = false, placeholder, defaultValue = "", scope = "record", onValueChange,
}: {
  name: string; label?: string; required?: boolean; placeholder?: string; defaultValue?: string;
  scope?: "record" | "administrative" | "pharmacy" | "admitted"; onValueChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [text, setText] = useState("");
  const [items, setItems] = useState<Opt[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const justPicked = useRef(false);
  const seq = useRef(0);

  async function load(q: string, cursor: string | null, append: boolean) {
    const mine = ++seq.current;
    setBusy(true);
    setFailed(false);
    try {
      const url = `/api/patients/picker?scope=${scope}&q=${encodeURIComponent(q)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (mine !== seq.current) return; // a newer request superseded this one
      setItems((cur) => (append ? [...cur, ...data.items] : data.items));
      setNext(data.nextCursor ?? null);
    } catch {
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  // Default selection: resolve its label (inside the scope) once.
  useEffect(() => {
    if (!defaultValue) return;
    fetch(`/api/patients/picker?scope=${scope}&id=${encodeURIComponent(defaultValue)}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.items?.[0]) setText(d.items[0].label); else setValue(""); })
      .catch(() => undefined);
  }, [defaultValue, scope]);

  // Debounced search while the list is open.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { setHi(0); void load(text.trim(), null, false); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (o: Opt) => { justPicked.current = true; setValue(o.value); setText(o.label); setOpen(false); onValueChange?.(o.value); };
  const clear = () => { justPicked.current = false; setValue(""); setText(""); setOpen(true); onValueChange?.(""); };
  const onType = (v: string) => { justPicked.current = false; setText(v); setOpen(true); if (value) { setValue(""); onValueChange?.(""); } };

  return (
    <div ref={boxRef} className="relative">
      {label && <label className="label">{label}{required && <span className="text-red-600"> *</span>}</label>}
      <input type="hidden" name={name} value={value} />
      <div className="relative">
        <input
          className="input pl-8"
          value={text}
          placeholder={placeholder ?? "ابحث بالاسم أو رقم الملف"}
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          data-lpignore="true"
          data-form-type="other"
          required={required && !value ? true : undefined}
          onFocus={() => { if (justPicked.current) { justPicked.current = false; return; } setOpen(true); }}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, items.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" && open && items[hi]) { e.preventDefault(); pick(items[hi]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        <div className="absolute inset-y-0 left-0 flex items-center">
          {text && <button type="button" tabIndex={-1} onClick={clear} title="مسح" className="flex items-center px-1.5 text-gray-400 hover:text-red-600">×</button>}
        </div>
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {busy && items.length === 0 && <div className="px-3 py-2 text-sm text-gray-400" role="status">جارٍ البحث…</div>}
          {failed && <div className="px-3 py-2 text-sm text-red-700" role="alert">تعذّر البحث؛ حاول مرة أخرى.</div>}
          {!busy && !failed && items.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">لا نتائج ضمن نطاقك</div>}
          {items.map((o, i) => (
            <button key={o.value} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o)}
              className={`block w-full px-3 py-2 text-right text-sm ${i === hi ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-50"} ${o.value === value ? "font-semibold" : ""}`}>
              {o.label}
            </button>
          ))}
          {next && (
            <button type="button" className="block w-full border-t border-gray-100 px-3 py-2 text-center text-xs text-brand-700 hover:bg-gray-50"
              disabled={busy} onClick={() => void load(text.trim(), next, true)}>المزيد…</button>
          )}
        </div>
      )}
    </div>
  );
}
