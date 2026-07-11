"use client";
import { useState, useRef, useEffect } from "react";

type Opt = { value: string; label: string };

// مكوّن قائمة موحّد: اكتب أو اختر + فلترة + كتابة حرة اختيارية
export function Combobox({
  name, label, options = [], defaultValue = "", allowFree = true, required = false, placeholder, onValueChange,
}: {
  name: string; label?: string; options?: (string | Opt)[]; defaultValue?: string;
  allowFree?: boolean; required?: boolean; placeholder?: string; onValueChange?: (v: string) => void;
}) {
  const opts: Opt[] = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const initLabel = opts.find((o) => o.value === defaultValue)?.label ?? (allowFree ? defaultValue : "");
  const [value, setValue] = useState(defaultValue ?? "");
  const [text, setText] = useState(initLabel);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const justPicked = useRef(false); // يمنع إعادة فتح القائمة تلقائياً بعد الاختيار

  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const q = text.trim().toLowerCase();
  const filtered = q ? opts.filter((o) => o.label.toLowerCase().includes(q)) : opts;

  const pick = (o: Opt) => { justPicked.current = true; setValue(o.value); setText(o.label); setOpen(false); onValueChange?.(o.value); };
  const clear = () => { justPicked.current = false; setValue(""); setText(""); setOpen(true); onValueChange?.(""); };
  const onType = (v: string) => {
    justPicked.current = false;
    setText(v); setOpen(true); setHi(0);
    if (allowFree) { setValue(v); onValueChange?.(v); }
    else { const m = opts.find((o) => o.label === v); const nv = m ? m.value : ""; setValue(nv); onValueChange?.(nv); }
  };

  return (
    <div ref={boxRef} className="relative">
      {label && <label className="label">{label}{required && <span className="text-red-600"> *</span>}</label>}
      <input type="hidden" name={name} value={value} />
      <div className="relative">
        <input
          className="input pl-8"
          value={text}
          placeholder={placeholder ?? "اكتب أو اختر"}
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
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" && open && filtered[hi]) { e.preventDefault(); pick(filtered[hi]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        <div className="absolute inset-y-0 left-0 flex items-center">
          {text && (
            <button type="button" tabIndex={-1} onClick={clear} title="مسح"
              className="flex items-center px-1.5 text-gray-400 hover:text-red-600">×</button>
          )}
          <button type="button" tabIndex={-1} onClick={() => setOpen((o) => !o)}
            className="flex items-center px-2 text-gray-400 hover:text-gray-600">▾</button>
        </div>
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">{allowFree ? "اكتب قيمة جديدة…" : "لا نتائج"}</div>
          )}
          {filtered.map((o, i) => (
            <button key={o.value + i} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o)}
              className={`block w-full px-3 py-2 text-right text-sm ${i === hi ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-50"} ${o.value === value ? "font-semibold" : ""}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
