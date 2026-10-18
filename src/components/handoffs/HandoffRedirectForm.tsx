"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { listHandoffTargetsAction, redirectHandoffAction } from "@/app/(app)/handoffs/actions";
import { BRANCH_LEVEL_ROLES, HANDOFF_LOAD_LABELS, HANDOFF_TARGET_LABELS, type HandoffLoad, type HandoffTargetRole } from "@/lib/handoff-rules";

type Target = { userId: string; name: string; specialty: string | null; load: HandoffLoad };

/** Roles a handoff can be redirected to inside the same center (branch-level roles are not center roles). */
export const REDIRECT_ROLES = (Object.keys(HANDOFF_TARGET_LABELS) as HandoffTargetRole[])
  .filter((role) => !(BRANCH_LEVEL_ROLES as readonly string[]).includes(role));

/**
 * Redirect a waiting (SENT) handoff to another person or capacity in the same center: for the
 * center's secretary when the chosen doctor is absent or busy, and for managers.
 */
export function HandoffRedirectForm({ handoffId, centerId, defaultRole, onDone }: { handoffId: string; centerId: number; defaultRole: HandoffTargetRole; onDone: (completed?: boolean) => void }) {
  const router = useRouter();
  const [role, setRole] = useState<HandoffTargetRole>(REDIRECT_ROLES.includes(defaultRole) ? defaultRole : "SECRETARY");
  const [userId, setUserId] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setTargets([]);
    setUserId("");
    setLoading(true);
    listHandoffTargetsAction(centerId, role).then((result) => {
      if (cancelled) return;
      if (result.ok) setTargets((result.data ?? []) as Target[]);
      else setError(result.error ?? "تعذر تحميل الأشخاص المتاحين");
    }).catch(() => { if (!cancelled) setError("تعذر تحميل الأشخاص المتاحين"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [centerId, role]);

  function submit() {
    setError("");
    startTransition(async () => {
      try {
        const result = await redirectHandoffAction(handoffId, { toRole: role, toUserId: userId || null });
        if (result.ok) { onDone(true); router.refresh(); }
        else setError(result.error);
      } catch { setError("تعذر إعادة التوجيه، حاول مرة أخرى"); }
    });
  }

  const empty = !loading && targets.length === 0;
  return (
    <form className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-slate-700" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">إعادة توجيه داخل نفس المركز</p>
      <label className="label block" htmlFor={`redirect-role-${handoffId}`}>إلى</label>
      <select id={`redirect-role-${handoffId}`} className="input w-full" value={role} onChange={(event) => { setRole(event.target.value as HandoffTargetRole); setError(""); }}>
        {REDIRECT_ROLES.map((item) => <option key={item} value={item}>{HANDOFF_TARGET_LABELS[item]}</option>)}
      </select>
      <label className="label block" htmlFor={`redirect-user-${handoffId}`}>الشخص</label>
      <select id={`redirect-user-${handoffId}`} className="input w-full" value={userId} disabled={loading || empty} onChange={(event) => setUserId(event.target.value)}>
        <option value="">{loading ? "جارٍ تحميل الأشخاص..." : "أي شخص متاح"}</option>
        {targets.map((target) => <option key={target.userId} value={target.userId}>{target.name}{target.specialty ? ` · ${target.specialty}` : ""} · {HANDOFF_LOAD_LABELS[target.load]}</option>)}
      </select>
      {empty ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">هذا المركز ما بيه {HANDOFF_TARGET_LABELS[role]}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary min-h-11" disabled={pending || loading || empty}>{pending ? "جارٍ إعادة التوجيه..." : "تأكيد إعادة التوجيه"}</button>
        <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => onDone(false)}>إلغاء</button>
      </div>
    </form>
  );
}
