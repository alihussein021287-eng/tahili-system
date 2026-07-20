"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { SettingsActionState } from "./actions";

type ActionFn = (state: SettingsActionState, formData: FormData) => Promise<SettingsActionState>;

export function SettingsActionForm({
  action,
  children,
  className,
}: {
  action: ActionFn;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      {state.message ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"
          }`}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </div>
      ) : null}
    </form>
  );
}

export function SubmitButton({ children = "حفظ", disabled = false }: { children?: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={disabled || pending} aria-disabled={disabled || pending}>
      {pending ? "جار الحفظ..." : children}
    </button>
  );
}

export function SmallSubmitButton({ children = "إضافة", disabled = false, ariaLabel }: { children?: ReactNode; disabled?: boolean; ariaLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary btn-sm" disabled={disabled || pending} aria-disabled={disabled || pending} aria-label={ariaLabel}>
      {pending ? "..." : children}
    </button>
  );
}

export function ConfirmSubmitButton({
  children = "حذف",
  message,
  className = "btn-danger-soft btn-sm",
  disabled = false,
  ariaLabel,
}: {
  children?: ReactNode;
  message: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {pending ? "..." : children}
    </button>
  );
}

export function SettingsTabSelect({
  tabs,
  active,
}: {
  tabs: { key: string; label: string; href: string }[];
  active: string;
}) {
  const router = useRouter();
  return (
    <label className="block md:hidden">
      <span className="sr-only">اختيار تبويب الإعدادات</span>
      <select className="input" value={active} onChange={(event) => router.push(`/settings?tab=${event.target.value}`)}>
        {tabs.map((tab) => (
          <option key={tab.key} value={tab.key}>
            {tab.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CenterFilterSelect({
  centers,
  selectedId,
}: {
  centers: { id: number; name: string }[];
  selectedId: number | null;
}) {
  const router = useRouter();
  return (
    <label className="label max-w-md">
      قائمة المراكز
      <select
        className="input mt-1"
        value={selectedId ? String(selectedId) : ""}
        onChange={(event) => {
          const value = event.target.value;
          const center = value ? `&center=${encodeURIComponent(value)}` : "";
          router.push(`/settings?tab=therapy&card=center-halls${center}`);
        }}
      >
        {centers.length === 0 ? <option value="">لا توجد مراكز</option> : null}
        {centers.map((center) => (
          <option key={center.id} value={center.id}>
            {center.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LookupSearchInput() {
  const [query, setQuery] = useState("");
  return (
    <label className="label max-w-md">
      بحث داخل القوائم
      <input
        className="input mt-1"
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          const normalized = next.trim().toLowerCase();
          document.querySelectorAll<HTMLElement>("[data-lookup-item]").forEach((node) => {
            const text = node.dataset.lookupText?.toLowerCase() ?? "";
            node.hidden = Boolean(normalized && !text.includes(normalized));
          });
        }}
        placeholder="اكتب للبحث..."
      />
    </label>
  );
}
