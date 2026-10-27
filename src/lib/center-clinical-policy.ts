/** Referral-only reviewer selection remains insufficient authority.
 * New V1 authorization uses clinical-review-service: scoped individual secretary
 * grant + active membership + persisted nomination + explicit physician acceptance.
 * This legacy boolean deliberately cannot unlock that workflow.
 */
export function hasApprovedCenterReviewerDesignationPolicy(): boolean { return false; }
export const CENTER_DESIGNATION_PENDING = "إكمال العمل محفوظ؛ يلزم إثبات جهة تعيين المراجع الطبي وقبول الطبيب للمسؤولية";
