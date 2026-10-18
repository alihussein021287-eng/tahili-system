import { HANDOFF_TARGET_LABELS, type HandoffTargetRole } from "@/lib/handoff-rules";

export type HandoffSelectionMode = "any" | "byName";

export function defaultHandoffSelectionMode(role: HandoffTargetRole): HandoffSelectionMode {
  return role === "DOCTOR" || role === "HEAD_THERAPIST" || role === "THERAPIST" ? "byName" : "any";
}

export function handoffTargetIsAvailable(isBranchRole: boolean, loading: boolean, targetCount: number): boolean {
  return isBranchRole || (!loading && targetCount > 0);
}

export function handoffEmptyTargetMessage(role: HandoffTargetRole, hasCenter: boolean, loading: boolean, targetCount: number): string | null {
  if (role === "RECEPTION" || role === "DATA_ENTRY" || !hasCenter || loading || targetCount > 0) return null;
  return `هذا المركز ما بيه ${HANDOFF_TARGET_LABELS[role]}`;
}
