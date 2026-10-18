"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormField } from "@/components/Ui";
import { BRANCH_LEVEL_ROLES, HANDOFF_LOAD_LABELS, HANDOFF_TARGET_LABELS, type HandoffLoad, type HandoffTargetRole } from "@/lib/handoff-rules";
import { listActiveCentersAction, listHandoffTargetsAction, sendHandoffAction } from "@/app/(app)/handoffs/actions";
import { defaultHandoffSelectionMode, handoffEmptyTargetMessage, handoffTargetIsAvailable } from "./dialog-defaults";

type CenterOption = { id: number; name: string };
type TargetOption = { userId: string; name: string; specialty: string | null; load: HandoffLoad };
type Props = {
  patientId: string;
  patientName: string;
  fileNumber: string;
  defaultCenterId?: number;
  /** Exact care stage this handoff is about; without it the handoff gives no authority over any stage. */
  careStageId?: string;
  triggerLabel?: string;
  autoOpen?: boolean;
  /** Called after a successful send (the patient file uses it to make sure the screen updates). */
  onSent?: () => void;
};

const roles = Object.keys(HANDOFF_TARGET_LABELS) as HandoffTargetRole[];

export function HandoffDialog({ patientId, patientName, fileNumber, defaultCenterId, careStageId, triggerLabel, autoOpen = false, onSent }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [centerId, setCenterId] = useState(defaultCenterId ? String(defaultCenterId) : "");
  const [role, setRole] = useState<HandoffTargetRole>("SECRETARY");
  const [mode, setMode] = useState(defaultHandoffSelectionMode("SECRETARY"));
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [centers, setCenters] = useState<CenterOption[]>([]);
  const [targets, setTargets] = useState<TargetOption[]>([]);
  const [loadedTargetsKey, setLoadedTargetsKey] = useState("");
  const [centersLoading, setCentersLoading] = useState(false);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const centerRef = useRef<HTMLSelectElement>(null);
  const isBranchRole = (BRANCH_LEVEL_ROLES as readonly string[]).includes(role);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCentersLoading(true);
    listActiveCentersAction().then((result) => {
      if (cancelled) return;
      if (result.ok) setCenters(result.data ?? []);
      else setError(result.error ?? "تعذر تحميل المراكز");
    }).catch(() => {
      if (!cancelled) setError("تعذر تحميل المراكز");
    }).finally(() => {
      if (!cancelled) setCentersLoading(false);
    });
    centerRef.current?.focus();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || isBranchRole || !centerId) {
      setTargets([]);
      setLoadedTargetsKey("");
      setTargetsLoading(false);
      return;
    }
    let cancelled = false;
    const queryKey = `${centerId}:${role}`;
    setTargets([]);
    setLoadedTargetsKey("");
    setTargetsLoading(true);
    listHandoffTargetsAction(Number(centerId), role).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setTargets(result.data ?? []);
        setLoadedTargetsKey(queryKey);
      }
      else setError(result.error ?? "تعذر تحميل الأشخاص المتاحين");
    }).catch(() => {
      if (!cancelled) setError("تعذر تحميل الأشخاص المتاحين");
    }).finally(() => {
      if (!cancelled) setTargetsLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, isBranchRole, centerId, role]);

  function chooseRole(value: HandoffTargetRole) {
    setRole(value);
    setMode(defaultHandoffSelectionMode(value));
    setUserId("");
    setError("");
  }

  const targetsReady = loadedTargetsKey === `${centerId}:${role}` && !targetsLoading;
  const available = handoffTargetIsAvailable(isBranchRole, !targetsReady, targets.length);
  const canSubmit = !pending && !centersLoading && !error && available &&
    (isBranchRole || !!centerId) && (mode === "any" || !!userId);
  const emptyMessage = !error ? handoffEmptyTargetMessage(role, !!centerId, !targetsReady, targets.length) : null;

  return (
    <>
      <button type="button" className="btn-primary btn-sm min-h-11" onClick={() => { setError(""); setOpen(true); }}>{triggerLabel ?? "حوّل إلى"}</button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" dir="rtl" onKeyDown={(event) => { if (event.key === "Escape" && !pending) setOpen(false); }}>
          <div className="w-full max-w-lg max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="handoff-dialog-title">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="handoff-dialog-title" className="text-lg font-semibold">تحويل المراجع</h2>
                <p className="text-sm text-gray-600 dark:text-slate-300"><bdi>{patientName}</bdi> · رقم الملف <bdi>{fileNumber}</bdi></p>
              </div>
              <button type="button" className="btn-ghost btn-sm" aria-label="إغلاق" disabled={pending} onClick={() => setOpen(false)}>إغلاق</button>
            </div>
            <form onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              setError("");
              startTransition(async () => {
                try {
                  const result = await sendHandoffAction({
                    patientId,
                    toCenterId: isBranchRole ? null : Number(centerId),
                    toRole: role,
                    toUserId: mode === "byName" ? userId : null,
                    note: note.trim() || null,
                    ...(careStageId ? { careStageId } : {}),
                  });
                  if (result.ok) { setOpen(false); setNote(""); onSent?.(); router.refresh(); }
                  else setError(result.error ?? "تعذر تحويل المراجع");
                } catch {
                  setError("تعذر تحويل المراجع");
                }
              });
            }} className="space-y-4">
              <FormField label="المركز" required={!isBranchRole}>
                <select ref={centerRef} className="input mt-1 w-full" value={centerId} disabled={centersLoading || isBranchRole} onChange={(event) => { setCenterId(event.target.value); setUserId(""); setError(""); }}>
                  <option value="">{centersLoading ? "جارٍ تحميل المراكز..." : "اختر المركز"}</option>
                  {centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}
                </select>
              </FormField>
              <FormField label="الجهة المستلمة" required>
                <select className="input mt-1 w-full" value={role} onChange={(event) => chooseRole(event.target.value as HandoffTargetRole)}>
                  {roles.map((targetRole) => <option key={targetRole} value={targetRole}>{HANDOFF_TARGET_LABELS[targetRole]}</option>)}
                </select>
              </FormField>
              <fieldset className="space-y-2">
                <legend className="label">طريقة الاختيار</legend>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="selectionMode" checked={mode === "any"} onChange={() => { setMode("any"); setUserId(""); }} />أي شخص متاح</label>
                {!isBranchRole ? <label className="flex items-center gap-2 text-sm"><input type="radio" name="selectionMode" checked={mode === "byName"} onChange={() => setMode("byName")} />بالاسم</label> : null}
              </fieldset>
              {mode === "byName" && !isBranchRole ? (
                <FormField label="الشخص" required>
                  <select className="input mt-1 w-full" value={userId} disabled={!available} onChange={(event) => setUserId(event.target.value)}>
                    <option value="">{targetsLoading ? "جارٍ تحميل الأشخاص..." : "اختر الشخص"}</option>
                    {targets.map((target) => <option key={target.userId} value={target.userId}>{target.name}{target.specialty ? ` · ${target.specialty}` : ""} · {HANDOFF_LOAD_LABELS[target.load]}</option>)}
                  </select>
                </FormField>
              ) : null}
              {emptyMessage ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{emptyMessage}</p> : null}
              <FormField label="ملاحظة (اختياري)">
                <textarea className="input mt-1 w-full" rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
              </FormField>
              {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => setOpen(false)}>إلغاء</button>
                <button type="submit" className="btn-primary" disabled={!canSubmit}>{pending ? "جارٍ التحويل..." : "إرسال التحويل"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
