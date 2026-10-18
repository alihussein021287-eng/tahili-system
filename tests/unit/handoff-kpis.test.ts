import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handoffKpis } from "@/lib/handoff-kpis";

const now = new Date("2026-10-11T09:00:00.000Z"); // 12:00 Baghdad
const today = { start: new Date("2026-10-10T21:00:00.000Z"), end: new Date("2026-10-11T21:00:00.000Z") };
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const h = (over: Record<string, unknown>) => ({ id: Math.random().toString(36), patientId: "p", toRole: "RESIDENT", status: "SENT", sentAt: minutesAgo(5), ...over }) as any;

describe("station KPIs from handoffs", () => {
  it("counts waiting, received, late and done today per receiving role", () => {
    const rows = handoffKpis([
      h({ toRole: "RESIDENT", status: "SENT", sentAt: minutesAgo(10) }),
      h({ toRole: "RESIDENT", status: "SENT", sentAt: minutesAgo(45) }), // past the 30-minute limit
      h({ toRole: "RESIDENT", status: "ACCEPTED", sentAt: minutesAgo(60), acceptedAt: minutesAgo(40) }),
      h({ toRole: "RESIDENT", status: "DONE", sentAt: minutesAgo(200), acceptedAt: minutesAgo(190), doneAt: minutesAgo(100) }),
      h({ toRole: "RESIDENT", status: "CANCELLED", sentAt: minutesAgo(5) }),
      h({ toRole: "DOCTOR", status: "DONE", sentAt: minutesAgo(3000), acceptedAt: minutesAgo(2990), doneAt: minutesAgo(2900) }), // done yesterday
    ], now, today);
    const resident = rows.find((r) => r.role === "RESIDENT")!;
    expect(resident).toMatchObject({ waiting: 2, inProgress: 1, late: 1, doneToday: 1, thru: 4 });
    expect(resident.avgReceiveMs).toBe(15 * 60_000); // (20 + 10) / 2 minutes
    expect(resident.samples.map((s) => s.sentAt)).toEqual([minutesAgo(60), minutesAgo(45), minutesAgo(10)]);
    expect(rows.find((r) => r.role === "DOCTOR")).toMatchObject({ doneToday: 0, thru: 1 });
    expect(rows.map((r) => r.role)).toEqual(["RECEPTION", "DATA_ENTRY", "SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST", "THERAPIST"]);
  });
});

describe("old stations no longer drive what people see", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("KPIs, journey print and portal read the handoffs", () => {
    expect(read("src/app/(app)/station-kpis/page.tsx")).not.toContain("careStage");
    expect(read("src/app/(app)/station-kpis/page.tsx")).toContain("handoffKpis");
    expect(read("src/app/(app)/patients/[id]/journey-print/page.tsx")).not.toContain("careStage");
    expect(read("src/app/portal/[token]/page.tsx")).not.toContain("careStage");
    expect(read("src/app/portal/[token]/page.tsx")).not.toMatch(/fromUser|toUser|note: true/);
  });
  it("finishing a centre programme hands the patient back to the doctor, not to a station", () => {
    const centers = read("src/app/(app)/centers/actions.ts");
    expect(centers).not.toContain("careStage");
    expect(centers).toMatch(/handOverInTransaction\(tx as any, \{[^}]*toRole: "DOCTOR"/s);
  });
});
