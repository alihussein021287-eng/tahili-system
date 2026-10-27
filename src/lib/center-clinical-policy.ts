/** No approved actor/scope contract exists yet for appointing a CENTER clinical reviewer.
 * This is deliberately not an environment flag, request option or general permission.
 * Enabling it requires a separately reviewed designation workflow and owner-approved policy.
 * Referral.assignedReviewerId alone documents association, not authority to appoint.
 */
export function hasApprovedCenterReviewerDesignationPolicy(): boolean {
  return false;
}

export const CENTER_DESIGNATION_PENDING = "إكمال العمل محفوظ؛ اعتماد الطبيب محجوب حتى اعتماد جهة تعيين المراجع الطبي ونطاقها";
