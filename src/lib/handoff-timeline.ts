import { handoffElapsed, handoffParty, handoffStatusLabel, type PatientHandoffHistoryRow } from "@/lib/patient-handoff-presentation";

export type HandoffTimelineRow = {
  id: string;
  fromText: string;
  toText: string;
  centerName: string | null;
  status: PatientHandoffHistoryRow["status"];
  statusLabel: string;
  note: string | null;
  returnReason: string | null;
  actorText: string;
  timeText: string;
  acceptedByText: string | null;
  acceptedTimeText: string | null;
};

const baghdadTime = new Intl.DateTimeFormat("ar-IQ", {
  timeZone: "Asia/Baghdad", calendar: "gregory", year: "numeric", month: "short",
  day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
});

export function buildHandoffTimeline(handoffs: readonly PatientHandoffHistoryRow[]): HandoffTimelineRow[] {
  return [...handoffs]
    .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime() || a.id.localeCompare(b.id))
    .map((handoff) => ({
      id: handoff.id,
      fromText: handoffParty(handoff.fromUser?.fullName, handoff.fromRole, handoff.fromCenter?.name),
      toText: handoffParty(handoff.toUser?.fullName, handoff.toRole, handoff.toCenter?.name),
      centerName: handoff.toCenter?.name ?? null,
      status: handoff.status,
      statusLabel: handoffStatusLabel(handoff.status),
      note: handoff.note,
      returnReason: handoff.status === "RETURNED" ? handoff.returnReason : null,
      actorText: handoff.fromUser?.fullName ?? "موظف",
      timeText: baghdadTime.format(new Date(handoff.sentAt)),
      acceptedByText: handoff.acceptedBy?.fullName ?? null,
      acceptedTimeText: handoff.acceptedAt ? baghdadTime.format(new Date(handoff.acceptedAt)) : null,
    }));
}

type HandoffStepSource = Pick<PatientHandoffHistoryRow, "id" | "status" | "sentAt" | "acceptedAt" | "acceptedBy" | "toUser" | "toRole" | "toCenter">;

export function currentHandoffStep(handoffs: readonly HandoffStepSource[], now: Date = new Date()) {
  const open = [...handoffs]
    .filter((handoff) => handoff.status === "SENT" || handoff.status === "ACCEPTED")
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime() || b.id.localeCompare(a.id))[0];
  if (!open) return null;
  const accepted = open.status === "ACCEPTED";
  return {
    holderText: accepted
      ? handoffParty(open.acceptedBy?.fullName ?? open.toUser?.fullName, open.toRole)
      : handoffParty(open.toUser?.fullName, open.toRole),
    centerName: open.toCenter?.name ?? null,
    sinceText: `${accepted ? "مستلم منذ" : "ينتظر منذ"} ${handoffElapsed(accepted ? open.acceptedAt ?? open.sentAt : open.sentAt, now)}`,
    status: accepted ? "ACCEPTED" as const : "SENT" as const,
  };
}
