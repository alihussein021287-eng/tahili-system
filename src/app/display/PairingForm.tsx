"use client";
import { useActionState } from "react";
import { pairDisplay, type PairState } from "./actions";

export default function PairingForm() {
  const [state, action, pending] = useActionState<PairState, FormData>(pairDisplay, {});
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white" dir="rtl">
      <form action={action} className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
        <div className="mb-3 text-5xl">📺</div>
        <h1 className="text-3xl font-extrabold">ربط شاشة الانتظار</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">أنشئ رمز اقتران مؤقتاً من الإعدادات، ثم أدخله هنا. لا تحتاج الشاشة إلى جلسة موظف.</p>
        <label className="mt-7 block text-right text-sm font-semibold text-slate-200">رمز الاقتران</label>
        <input name="code" required maxLength={8} autoComplete="one-time-code" dir="ltr" className="mt-2 w-full rounded-2xl border border-white/15 bg-slate-900 px-4 py-4 text-center font-mono text-3xl uppercase tracking-[.35em] outline-none focus:border-teal-400" />
        {state.error && <div className="mt-3 rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{state.error}</div>}
        <button disabled={pending} className="mt-6 w-full rounded-2xl bg-teal-500 px-5 py-3 text-lg font-bold text-slate-950 hover:bg-teal-400 disabled:opacity-60">{pending ? "جارٍ الربط…" : "اقتران الشاشة"}</button>
      </form>
    </main>
  );
}
