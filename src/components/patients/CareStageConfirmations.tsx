import { ROLE_LABELS } from "@/lib/permissions";
import { confirmStage, reassignStageAction, completeStageWorkAction } from "@/app/(app)/patients/actions";
import { HandoffDialog } from "@/components/handoffs/HandoffDialog";
import { hasApprovedCenterReviewerDesignationPolicy, CENTER_DESIGNATION_PENDING } from "@/lib/center-clinical-policy";

type Stage = {
  id: string; station: string; responsibleRole: string | null; status: string; responsibilityScope: string | null;
  assignedUserId: string | null; assignedName: string | null; specialistBound: boolean;
  /** Present only when the viewer is a manager whose scope covers this CENTER stage. */
  reassignCandidates: { id: string; name: string }[] | null;
  requiresPhysicianConfirmation?: boolean | null;
  operationalCompletedAt?: string | null;
  operationalCompletionId?: string | null;
  updatedAt?: string;
  canCompleteWork?: boolean;
  canPhysicianConfirm?: boolean;
};

/**
 * Open clinical stages of the patient. These hints mirror the server rules in care-stage-service
 * (the server re-checks everything): SERVICE and specialist stages need the recorded assignee,
 * CENTER stages use the center work pool unless an exclusive assignee is recorded.
 */
export function CareStageConfirmations({ patientId, patientName, fileNumber, stages, userRole, userId, canConfirm, canSend, canAssign }: {
  patientId: string;
  patientName: string;
  fileNumber: string;
  stages: Stage[];
  userRole: string;
  userId: string;
  canConfirm: boolean;
  canSend: boolean;
  /** journey.manage: the modification permission required for first assignment of a CENTER stage. */
  canAssign: boolean;
}) {
  // Only stages with an actionable path are listed: CENTER stages and specialist reviews.
  // SERVICE and unclassified stages stay a destination marker elsewhere (visits page), not an assignment queue.
  const visible = stages.filter((stage) =>
    stage.responsibilityScope === "CENTER" || stage.responsibilityScope === "SPECIALIST_REVIEW"
    || (stage.responsibilityScope === "SERVICE" && stage.assignedUserId === userId));
  if (!visible.length) return null;
  return (
    <section className="card space-y-3 p-4" aria-labelledby="care-stages-title" data-testid="care-stage-confirmations">
      <h2 id="care-stages-title" className="text-base font-semibold">المحطات السريرية المفتوحة</h2>
      <ul className="space-y-2">
        {visible.map((stage) => {
          const scope = stage.responsibilityScope;
          const roleMatches = stage.responsibleRole === userRole;
          const iAmAssignee = stage.assignedUserId === userId;
          const owned = scope === "CENTER" || scope === "SERVICE" || scope === "SPECIALIST_REVIEW";
          let eligible = false;
          let reason = "";
          if (!owned) reason = "ملكية المحطة غير مصنّفة — تتطلب تسوية";
          else if (scope === "CENTER") {
            eligible = canConfirm && roleMatches && (!stage.assignedUserId || iAmAssignee);
            if (!eligible) reason = stage.assignedUserId && !iAmAssignee ? "المحطة مسندة لشخص آخر" : "بانتظار تأكيد صاحب الدور";
          } else {
            eligible = canConfirm && roleMatches && iAmAssignee && (scope === "SERVICE" || stage.specialistBound);
            if (!eligible) reason = !stage.assignedUserId ? "بانتظار الإسناد — جهة الإسناد لهذه المحطة غير محددة بعد" : "المحطة مسندة لشخص آخر";
          }
          const clinicalCenter = scope === "CENTER" && stage.requiresPhysicianConfirmation === true;
          const centerWork = scope === "CENTER" && stage.requiresPhysicianConfirmation !== false;
          if (centerWork) {
            eligible = clinicalCenter && hasApprovedCenterReviewerDesignationPolicy() && !!stage.canPhysicianConfirm && !!stage.operationalCompletedAt;
            reason = stage.operationalCompletedAt ? CENTER_DESIGNATION_PENDING : "بانتظار إكمال العمل التشغيلي";
            if (stage.requiresPhysicianConfirmation == null) reason += " — تصنيف التأكيد غير موثق؛ لا اعتماد طبي رجعي";
            if (!stage.canCompleteWork && !stage.operationalCompletedAt) reason += " — يلزم التحقق من المسؤولية والعضوية والإسناد قبل تسوية موثقة";
          } else if (scope !== "SPECIALIST_REVIEW" && stage.requiresPhysicianConfirmation !== false) {
            eligible = false; reason = "تصنيف التأكيد غير موثق — يلزم تحديده دون افتراض اعتماد طبي";
          }
          // Mirrors the server: only the current assignee hands over; first assignment is possible for CENTER stages only.
          const canHandOff = canSend && (stage.assignedUserId
            ? iAmAssignee && (scope === "CENTER" || scope === "SERVICE")
            : scope === "CENTER" && canAssign);
          const roleLabel = stage.responsibleRole ? ROLE_LABELS[stage.responsibleRole as keyof typeof ROLE_LABELS] ?? stage.responsibleRole : "غير محدد";
          return (
            <li key={stage.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
              <div>
                <div className="font-medium">{stage.station}</div>
                <div className="text-xs text-gray-500">المسؤول: {roleLabel}</div>
                <div className="text-xs text-gray-500" data-testid="stage-assignee">
                  {stage.assignedUserId ? `المُسنَد إليه: ${stage.assignedName ?? "—"}` : "بانتظار الإسناد"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {centerWork && stage.canCompleteWork && !stage.operationalCompletedAt ? (
                  <form action={completeStageWorkAction.bind(null, patientId, stage.id, stage.updatedAt!)}>
                    <button type="submit" className="btn-primary min-h-11">توثيق إكمال العمل</button>
                  </form>
                ) : null}
                {eligible ? (
                  <form action={confirmStage.bind(null, patientId, stage.id, stage.operationalCompletionId ?? undefined)}>
                    <button type="submit" className="btn-primary min-h-11">{clinicalCenter || scope === "SPECIALIST_REVIEW" ? "تأكيد الطبيب" : "تأكيد إكمال المحطة التشغيلية"}</button>
                  </form>
                ) : (
                  <span className="text-xs text-gray-400">{reason}</span>
                )}
                {canHandOff ? (
                  <HandoffDialog
                    patientId={patientId} patientName={patientName} fileNumber={fileNumber}
                    careStageId={stage.id} triggerLabel={stage.assignedUserId ? "إعادة إسناد المحطة" : "إسناد المحطة"}
                  />
                ) : null}
              </div>
              {stage.reassignCandidates?.length ? (
                <form action={reassignStageAction.bind(null, patientId, stage.id)} className="flex w-full flex-wrap items-end gap-2 border-t border-gray-100 pt-2 dark:border-slate-700">
                  <input type="hidden" name="expectedAssigneeId" value={stage.assignedUserId ?? ""} />
                  <label className="text-xs">المُسنَد إليه الجديد
                    <select name="newAssigneeId" required className="input mt-1 min-h-11" defaultValue="">
                      <option value="" disabled>اختر</option>
                      {stage.reassignCandidates.filter((c) => c.id !== stage.assignedUserId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className="min-w-[180px] flex-1 text-xs">السبب (مطلوب)
                    <input name="reason" required maxLength={500} className="input mt-1 min-h-11 w-full" />
                  </label>
                  <button type="submit" className="btn-ghost min-h-11">إعادة الإسناد</button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
