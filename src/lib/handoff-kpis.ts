// Station KPIs from the handoffs: one row per receiving role, in the order the patient moves.
// waiting = sent and not yet received; inProgress = received and still open; late = waiting past
// the role's limit; avgReceive = how long a handoff waited before someone received it.
import { HANDOFF_TARGET_LABELS, handoffDelayColor, handoffLimitMinutes } from "@/lib/handoff-rules";

export const KPI_ROLES = ["RECEPTION", "DATA_ENTRY", "SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST", "THERAPIST"] as const;
export type KpiRole = (typeof KPI_ROLES)[number];

export type KpiHandoff = {
  id: string; patientId: string; toRole: string; status: string;
  sentAt: Date | string; acceptedAt?: Date | string | null; doneAt?: Date | string | null;
  fromCenterId?: number | null; toCenterId?: number | null;
  patient?: { fullName: string; fileNumber?: number | null } | null;
};

export type KpiRow = {
  role: KpiRole; label: string; limitMinutes: number;
  thru: number; avgReceiveMs: number | null; waiting: number; inProgress: number; late: number; doneToday: number;
  samples: KpiHandoff[];
};

const time = (value: Date | string) => new Date(value).getTime();

export function handoffKpis(handoffs: readonly KpiHandoff[], now: Date, today: { start: Date; end: Date }): KpiRow[] {
  return KPI_ROLES.map((role) => {
    const mine = handoffs.filter((h) => h.toRole === role && h.status !== "CANCELLED");
    const waiting = mine.filter((h) => h.status === "SENT");
    const inProgress = mine.filter((h) => h.status === "ACCEPTED");
    const received = mine.filter((h) => h.acceptedAt && time(h.acceptedAt) >= time(h.sentAt));
    const totalWait = received.reduce((sum, h) => sum + (time(h.acceptedAt!) - time(h.sentAt)), 0);
    const late = waiting.filter((h) => handoffDelayColor(h.sentAt, now, handoffLimitMinutes(h as any)) === "red");
    const doneToday = mine.filter((h) => h.status === "DONE" && h.doneAt && time(h.doneAt) >= today.start.getTime() && time(h.doneAt) < today.end.getTime());
    const oldestFirst = [...waiting, ...inProgress].sort((a, b) => time(a.sentAt) - time(b.sentAt));
    return {
      role, label: HANDOFF_TARGET_LABELS[role], limitMinutes: handoffLimitMinutes({ toRole: role }),
      thru: mine.length, avgReceiveMs: received.length ? totalWait / received.length : null,
      waiting: waiting.length, inProgress: inProgress.length, late: late.length, doneToday: doneToday.length,
      samples: oldestFirst.slice(0, 3),
    };
  });
}
