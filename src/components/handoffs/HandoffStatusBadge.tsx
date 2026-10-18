import type { HandoffStatus, UserRole } from "@prisma/client";
import { StatusBadge } from "@/components/Ui";
import { handoffBadge } from "@/lib/patient-handoff-presentation";

export function HandoffStatusBadge({
  status,
  sentAt,
  acceptedAt,
  toRole,
  fromCenterId,
  toCenterId,
  now = new Date(),
}: {
  status: HandoffStatus;
  sentAt: Date | string;
  acceptedAt?: Date | string | null;
  toRole: UserRole;
  fromCenterId?: number | null;
  toCenterId?: number | null;
  now?: Date | string;
}) {
  const badge = handoffBadge({ status, sentAt, acceptedAt, toRole, fromCenterId, toCenterId }, now);
  return <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>;
}
