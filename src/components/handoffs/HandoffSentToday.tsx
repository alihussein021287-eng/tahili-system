"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelHandoffAction } from "@/app/(app)/handoffs/actions";

export type SentTodayItem = {
  id: string;
  patientName: string;
  status: "SENT" | "ACCEPTED" | "RETURNED" | "CANCELLED" | "DONE";
  acceptorName: string | null;
};

function sentStatus(item: SentTodayItem) {
  if (item.status === "SENT") return "ينتظر";
  if (item.status === "ACCEPTED") return item.acceptorName ? `استُلم عند ${item.acceptorName}` : "استُلم";
  return { RETURNED: "أُرجع", CANCELLED: "أُلغي", DONE: "انتهى" }[item.status];
}

export function HandoffSentToday({ items }: { items: SentTodayItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const visibleItems = items.filter((item) => !completedIds.has(item.id));

  function cancel(id: string) {
    setError("");
    setCancellingId(id);
    startTransition(async () => {
      try {
        const result = await cancelHandoffAction(id);
        if (!result.ok) setError(result.error);
        else { setCompletedIds((current) => new Set(current).add(id)); router.refresh(); }
      } catch {
        setError("تعذر إلغاء التحويلة، حاول مرة أخرى");
      } finally {
        setCancellingId(null);
      }
    });
  }

  return <section className="min-w-0 space-y-3" aria-labelledby="sent-today-title">
    <h2 id="sent-today-title" className="font-semibold text-gray-900 dark:text-slate-100">أرسلتها اليوم</h2>
    {visibleItems.length ? <div className="grid gap-3">{visibleItems.map((item) => <article key={item.id} className="card flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0 break-words"><p className="font-medium text-gray-900 dark:text-slate-100"><bdi>{item.patientName}</bdi></p><p className="mt-1 text-sm text-gray-600 dark:text-slate-300"><bdi>{sentStatus(item)}</bdi></p></div>
      {item.status === "SENT" ? <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => cancel(item.id)}>{cancellingId === item.id ? "جارٍ الإلغاء..." : "إلغاء التحويلة"}</button> : null}
    </article>)}</div> : <p className="card p-4 text-sm text-gray-600 dark:text-slate-300">لم ترسل تحويلات اليوم.</p>}
    {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
  </section>;
}
