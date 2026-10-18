"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HandoffStatus, UserRole } from "@prisma/client";
import { acceptHandoffAction, cancelHandoffAction, finishHandoffAction, returnHandoffAction } from "@/app/(app)/handoffs/actions";
import { HandoffDialog } from "@/components/handoffs/HandoffDialog";
import { HandoffRedirectForm } from "@/components/handoffs/HandoffRedirectForm";
import { HandoffStatusBadge } from "@/components/handoffs/HandoffStatusBadge";
import { HANDOFF_TARGET_LABELS, type HandoffTargetRole } from "@/lib/handoff-rules";

export type HandoffInboxItemData = {
  id: string;
  patientId: string;
  patientName: string;
  fileNumber: number;
  senderName: string;
  fromRole: UserRole;
  toRole: UserRole;
  fromCenterId: number | null;
  toCenterId: number | null;
  toCenterName?: string | null;
  status: HandoffStatus;
  sentAt: string;
  acceptedAt?: string | null;
  note?: string | null;
  returnReason?: string | null;
  previousReturnReason?: string | null;
  isReturn?: boolean;
};

type ActionName = "accept" | "return" | "finish" | "cancel";

export function HandoffInboxItem({ item, canSend, canCancel = false, canRedirect = false, now }: { item: HandoffInboxItemData; canSend: boolean; canCancel?: boolean; canRedirect?: boolean; now: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [showReturn, setShowReturn] = useState(false);
  const [showRedirect, setShowRedirect] = useState(false);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<ActionName | null>(null);
  const [localStatus, setLocalStatus] = useState<HandoffStatus | null>(null);
  const [localAcceptedAt, setLocalAcceptedAt] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [, startTransition] = useTransition();
  // The action flag clears when the server responds; a route refresh can remain pending afterward.
  const busy = pendingAction !== null;
  const senderRole = HANDOFF_TARGET_LABELS[item.fromRole as keyof typeof HANDOFF_TARGET_LABELS] ?? item.fromRole;

  function run(action: ActionName) {
    if (action === "return" && !reason.trim()) { setError("سبب الإرجاع مطلوب"); return; }
    setError("");
    setPendingAction(action);
    startTransition(async () => {
      try {
        const result = action === "accept" ? await acceptHandoffAction(item.id)
          : action === "return" ? await returnHandoffAction(item.id, reason)
            : action === "finish" ? await finishHandoffAction(item.id)
              : await cancelHandoffAction(item.id);
        if (result.ok) {
          setShowReturn(false);
          setReason("");
          if (action === "accept") {
            setLocalStatus("ACCEPTED");
            setLocalAcceptedAt(new Date().toISOString());
          } else {
            setDismissed(true);
          }
          router.refresh();
        } else setError(result.error);
      } catch { setError("تعذر إكمال الإجراء، حاول مرة أخرى"); }
      finally { setPendingAction(null); }
    });
  }

  if (dismissed) return null;
  const currentItem = localStatus ? { ...item, status: localStatus, acceptedAt: localAcceptedAt ?? item.acceptedAt } : item;
  const currentStatus = currentItem.status;

  return (
    <article className="card min-w-0 space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100"><Link href={`/patients/${currentItem.patientId}`} className="rounded text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:text-brand-300"><bdi>{currentItem.patientName}</bdi></Link> <span className="text-sm font-normal text-gray-600 dark:text-slate-300">· رقم الملف <bdi>{currentItem.fileNumber}</bdi></span></h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">من <bdi>{currentItem.senderName}</bdi> · {senderRole}</p>
          {currentItem.toCenterName ? <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">إلى مركز <bdi>{currentItem.toCenterName}</bdi></p> : null}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <HandoffStatusBadge status={currentStatus} sentAt={currentItem.sentAt} acceptedAt={currentItem.acceptedAt} toRole={currentItem.toRole} fromCenterId={currentItem.fromCenterId} toCenterId={currentItem.toCenterId} now={now} />
          {currentItem.isReturn ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">مُرجَع</span> : null}
        </div>
      </div>
      {currentItem.note ? <p className="break-words text-sm text-gray-700 dark:text-slate-200">ملاحظة: {currentItem.note}</p> : null}
      {currentItem.returnReason || currentItem.previousReturnReason ? <p className="break-words text-sm text-amber-800 dark:text-amber-200">سبب الإرجاع: {currentItem.returnReason ?? currentItem.previousReturnReason}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {currentStatus === "SENT" ? <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => run("accept")}>{pendingAction === "accept" ? "جارٍ الاستلام..." : "استلمت"}</button> : null}
        {currentStatus === "SENT" && canCancel ? <button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={() => run("cancel")}>{pendingAction === "cancel" ? "جارٍ الإلغاء..." : "إلغاء التحويلة"}</button> : null}
        {currentStatus === "SENT" && canRedirect && currentItem.toCenterId != null && !showRedirect ? <button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={() => { setError(""); setShowRedirect(true); }}>إعادة توجيه</button> : null}
        {currentStatus === "ACCEPTED" ? <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => run("finish")}>{pendingAction === "finish" ? "جارٍ الإنهاء..." : "إنهاء"}</button> : null}
        {currentStatus === "ACCEPTED" && canSend ? <HandoffDialog patientId={currentItem.patientId} patientName={currentItem.patientName} fileNumber={String(currentItem.fileNumber)} defaultCenterId={currentItem.toCenterId ?? undefined} onSent={() => setDismissed(true)} /> : null}
        {currentStatus === "ACCEPTED" && canSend && !showReturn ? <button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={() => { setError(""); setShowReturn(true); }}>إرجاع</button> : null}
      </div>
      {currentStatus === "SENT" && canRedirect && currentItem.toCenterId != null && showRedirect ? (
        <HandoffRedirectForm handoffId={currentItem.id} centerId={currentItem.toCenterId} defaultRole={currentItem.toRole as HandoffTargetRole} onDone={(completed) => { setShowRedirect(false); if (completed) setDismissed(true); }} />
      ) : null}
      {currentStatus === "ACCEPTED" && canSend && showReturn ? (
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); run("return"); }}>
            <label className="label block" htmlFor={`return-reason-${currentItem.id}`}>سبب الإرجاع</label>
            <textarea id={`return-reason-${currentItem.id}`} name="reason" className="input w-full" rows={3} maxLength={4000} required value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary min-h-11" disabled={busy}>{pendingAction === "return" ? "جارٍ الإرجاع..." : "تأكيد الإرجاع"}</button>
              <button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={() => { setShowReturn(false); setError(""); }}>إلغاء</button>
            </div>
          </form>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </article>
  );
}
