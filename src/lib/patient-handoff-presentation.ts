import { HANDOFF_STATUS_LABELS, HANDOFF_TARGET_LABELS, handoffDelayColor, handoffLimitMinutes } from "@/lib/handoff-rules";
import { ROLE_LABELS } from "@/lib/permissions";
import type { HandoffStatus, UserRole } from "@prisma/client";

export type PatientHandoffHistoryRow = {
  id: string;
  sentAt: Date | string;
  acceptedAt?: Date | string | null;
  fromUserId?: string;
  toUserId?: string | null;
  acceptedById?: string | null;
  fromRole: UserRole;
  fromUser: { fullName: string } | null;
  fromCenter: { name: string } | null;
  toRole: UserRole;
  toUser: { fullName: string } | null;
  acceptedBy?: { fullName: string } | null;
  toCenter: { name: string } | null;
  status: HandoffStatus;
  note: string | null;
  returnReason: string | null;
};

export function handoffRoleLabel(role: UserRole): string {
  return HANDOFF_TARGET_LABELS[role as keyof typeof HANDOFF_TARGET_LABELS]
    ?? ROLE_LABELS[role as keyof typeof ROLE_LABELS]
    ?? role;
}

export function handoffParty(name: string | null | undefined, role: UserRole, center?: string | null): string {
  return `${name || handoffRoleLabel(role)}${center ? ` – ${center}` : ""}`;
}

export function handoffElapsed(since: Date | string | null, now: Date = new Date()): string {
  if (!since) return "أقل من دقيقة";
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  if (minutes < 1) return "أقل من دقيقة";
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعة${minutes % 60 ? ` و${minutes % 60} دقيقة` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} يوم${hours % 24 ? ` و${hours % 24} ساعة` : ""}`;
}

export function handoffStatusLabel(status: HandoffStatus): string {
  return HANDOFF_STATUS_LABELS[status];
}

export type HandoffBadgeTone = "success" | "warning" | "danger" | "neutral";

export function handoffBadge(handoff: {
  status: HandoffStatus;
  sentAt: Date | string;
  acceptedAt?: Date | string | null;
  toRole: UserRole;
  fromCenterId?: number | null;
  toCenterId?: number | null;
}, now: Date | string): { text: string; tone: HandoffBadgeTone } {
  const currentTime = new Date(now);
  if (handoff.status === "SENT") {
    const color = handoffDelayColor(handoff.sentAt, currentTime, handoffLimitMinutes(handoff));
    const tone = color === "green" ? "success" : color === "yellow" ? "warning" : "danger";
    return { text: `ينتظر منذ ${handoffElapsed(handoff.sentAt, currentTime)}`, tone };
  }
  if (handoff.status === "ACCEPTED") {
    return {
      text: handoff.acceptedAt ? `مستلم منذ ${handoffElapsed(handoff.acceptedAt, currentTime)}` : "مستلم",
      tone: "neutral",
    };
  }
  return { text: HANDOFF_STATUS_LABELS[handoff.status], tone: "neutral" };
}
