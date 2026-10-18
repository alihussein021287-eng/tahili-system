"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { acceptHandoffAction, cancelHandoffAction, finishHandoffAction } from "@/app/(app)/handoffs/actions";
import { HandoffDialog } from "@/components/handoffs/HandoffDialog";
import type { PathStage } from "@/lib/patient-path";

type Step = { holderText: string; centerName: string | null; sinceText: string; status: "SENT" | "ACCEPTED" } | null;

export function PatientHandoffJourney({ step, handoffId, patientId, patientName, fileNumber, autoOpen, canSend, canAccept, canFinish, canCancel, path, next, showPath = true }: {
  step: Step;
  handoffId: string | null;
  patientId: string;
  patientName: string;
  fileNumber: string;
  autoOpen: boolean;
  canSend: boolean;
  canAccept: boolean;
  canFinish: boolean;
  canCancel: boolean;
  /** The eight stages of the patient's path; the current one comes from the open handoff. */
  path: PathStage[];
  next: PathStage | null;
  showPath?: boolean;
}) {
  const router = useRouter();
  // The buttons submit a form so Next applies the server's refreshed page itself. If the screen
  // still shows the old step a few seconds after a successful save, the page is reloaded once so
  // nobody is left looking at «جارٍ حفظ الإجراء» or a button that was already used.
  const screenKey = `${handoffId}|${step?.status}|${step?.holderText}|${canAccept}|${canFinish}|${canCancel}`;
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [error, run, pending] = useActionState(async (_previous: string, form: FormData) => {
    const action = form.get("action");
    if (!handoffId) return "";
    try {
      const result = action === "accept" ? await acceptHandoffAction(handoffId)
        : action === "finish" ? await finishHandoffAction(handoffId) : await cancelHandoffAction(handoffId);
      if (result.ok) { setWaitingFor(screenKey); router.refresh(); }
      return result.ok ? "" : result.error;
    } catch { return "تعذر إكمال الإجراء، حاول مرة أخرى"; }
  }, "");
  useEffect(() => {
    if (!waitingFor) return;
    if (waitingFor !== screenKey) { setWaitingFor(null); return; }
    const timer = window.setTimeout(() => window.location.reload(), 3_000);
    return () => window.clearTimeout(timer);
  }, [waitingFor, screenKey]);

  const nextText = !showPath ? null : step
    ? `${step.status === "SENT" ? "بانتظار استلام" : "قيد متابعة"} ${step.holderText}${next ? ` · بعدها: ${next.label}` : ""}`
    : next ? `المرحلة التالية: ${next.label}` : "اكتمل المسار";

  return <section className="card min-w-0 space-y-4 p-4 sm:p-5" aria-labelledby="handoff-journey-title">
    <h2 id="handoff-journey-title" className="sr-only">{showPath ? "رحلة المراجع" : "تسليم المراجع"}</h2>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p role="status" className="break-words text-base font-semibold text-gray-900 dark:text-slate-100">
          {step ? <>هسه عند: <span className="text-brand-700 dark:text-brand-300"><bdi>{step.holderText}</bdi>{step.centerName ? <>{" – "}<bdi>{step.centerName}</bdi></> : null}</span></> : "لا توجد تحويلة مفتوحة"}
          {step ? <span className="mr-2 text-sm font-normal text-gray-500 dark:text-slate-400">· {step.sinceText}</span> : null}
        </p>
        {nextText ? <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">{nextText}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {canSend ? <HandoffDialog patientId={patientId} patientName={patientName} fileNumber={fileNumber} autoOpen={autoOpen} onSent={() => setWaitingFor(screenKey)} /> : null}
        <form action={run} className="contents" data-save-watch="">
          {canAccept ? <button type="submit" name="action" value="accept" className="btn-primary min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" disabled={pending}>استلمت</button> : null}
          {canFinish ? <button type="submit" name="action" value="finish" className="btn-primary min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" disabled={pending}>إنهاء</button> : null}
          {canCancel ? <button type="submit" name="action" value="cancel" className="btn-ghost min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" disabled={pending}>إلغاء التحويلة</button> : null}
        </form>
      </div>
    </div>
    {pending ? <p role="status" className="text-sm text-gray-600 dark:text-slate-300">جارٍ حفظ الإجراء...</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    {showPath ? <ol className="grid grid-cols-4 gap-x-1 gap-y-3 sm:grid-cols-8" aria-label="مراحل مسار المراجع">
      {path.map((stage) => {
        const bar = stage.status === "complete" ? "bg-emerald-500" : stage.status === "current" ? "bg-brand-600" : "bg-gray-200 dark:bg-slate-700";
        const text = stage.status === "complete" ? "text-emerald-700 dark:text-emerald-300" : stage.status === "current" ? "font-semibold text-brand-700 dark:text-brand-300" : "text-gray-400 dark:text-slate-500";
        const mark = stage.status === "complete" ? " ✓" : stage.status === "current" ? " ●" : "";
        return <li key={stage.key} aria-current={stage.status === "current" ? "step" : undefined} className="min-w-0 text-center">
          <div className={`h-1.5 rounded-full ${bar}`} />
          <div className={`mt-1.5 text-xs leading-5 ${text}`}>{stage.label}{mark}{stage.status === "skipped" ? <span className="block text-[11px] text-gray-400">ما مطلوبة</span> : null}</div>
        </li>;
      })}
    </ol> : null}
  </section>;
}
