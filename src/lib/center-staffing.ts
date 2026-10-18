import { CenterMembershipRole, CenterMembershipStatus } from "@prisma/client";
import { CENTER_ROLE_FOR_TARGET } from "@/lib/handoff-rules";

export const REQUIRED_STAFFING_ROLES = ["SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST"] as const;
export type RequiredStaffingRole = (typeof REQUIRED_STAFFING_ROLES)[number];

type Center = { id: number; active: boolean };
type Membership = {
  centerId: number;
  role: CenterMembershipRole;
  status: CenterMembershipStatus;
  startDate: Date;
  endDate: Date | null;
  user: { isActive: boolean };
};

export function centerStaffingGaps(centers: readonly Center[], memberships: readonly Membership[], now: Date) {
  const activeRoles = new Map<number, Set<CenterMembershipRole>>();
  for (const member of memberships) {
    if (member.status !== CenterMembershipStatus.ACTIVE || !member.user.isActive || member.startDate > now || (member.endDate && member.endDate < now)) continue;
    const roles = activeRoles.get(member.centerId) ?? new Set<CenterMembershipRole>();
    roles.add(member.role);
    activeRoles.set(member.centerId, roles);
  }

  return centers.filter((center) => center.active).map((center) => ({
    centerId: center.id,
    missingRoles: REQUIRED_STAFFING_ROLES.filter((role) => !activeRoles.get(center.id)?.has(CENTER_ROLE_FOR_TARGET[role])),
  }));
}
