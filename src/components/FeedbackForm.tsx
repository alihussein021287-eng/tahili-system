"use client";
import { useActionState, type ReactNode } from "react";

export type FeedbackState = { ok: boolean; message: string } | null;

// A successful server action refreshes the route, which can remount the form and drop its state. The result is therefore
// remembered at the moment the action's response arrives (before React commits), so the user always sees the latest outcome.
const recent = new Map<string, { state: NonNullable<FeedbackState>; at: number }>();
const RECENT_MS = 20_000;

/** A form whose server action reports refusals as an inline, understandable message instead of the error page. */
export function FeedbackForm({ id, action, className, children }: { id: string; action: (prev: FeedbackState, fd: FormData) => Promise<FeedbackState>; className?: string; children: ReactNode }) {
  const [state, run, pending] = useActionState(async (prev: FeedbackState, fd: FormData) => {
    const result = await action(prev, fd);
    if (result) recent.set(id, { state: result, at: Date.now() });
    return result;
  }, null as FeedbackState);
  const kept = recent.get(id);
  const fresh = kept && Date.now() - kept.at < RECENT_MS ? kept.state : null;
  const shown = fresh ?? state;
  return (
    <form action={run} className={className} autoComplete="off" aria-busy={pending}>
      {children}
      {shown ? (
        <p role={shown.ok ? "status" : "alert"} className={`md:col-span-3 rounded-lg px-3 py-2 text-sm ${shown.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{shown.message}</p>
      ) : null}
    </form>
  );
}
