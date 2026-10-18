import { describe, expect, it } from "vitest";
import { handoffBadge, handoffElapsed, handoffParty, handoffStatusLabel } from "@/lib/patient-handoff-presentation";

describe("patient handoff presentation", () => {
  it("shows the named holder and elapsed time", () => {
    expect(handoffParty("نور الهدى عباس", "DOCTOR", "مركز بغداد")).toBe("نور الهدى عباس – مركز بغداد");
    expect(handoffElapsed(new Date("2026-10-09T10:00:00Z"), new Date("2026-10-09T11:35:00Z"))).toBe("1 ساعة و35 دقيقة");
  });

  it("uses the role label when a handoff has no named recipient or center", () => {
    expect(handoffParty(null, "SECRETARY")).toBe("سكرتارية المركز");
    expect(handoffElapsed(null)).toBe("أقل من دقيقة");
  });

  it("labels every handoff status including returns", () => {
    expect(["SENT", "ACCEPTED", "DONE", "RETURNED", "CANCELLED"].map((status) => handoffStatusLabel(status as Parameters<typeof handoffStatusLabel>[0])))
      .toEqual(["مرسل", "مستلم", "مكتمل", "معاد", "ملغى"]);
  });
});

describe("handoff badge", () => {
  const sentAt = "2026-10-09T10:00:00.000Z";

  it("shows elapsed waiting time and delay tone for a sent handoff", () => {
    const handoff = { status: "SENT" as const, sentAt, toRole: "RESIDENT" as const };
    expect(handoffBadge(handoff, "2026-10-09T10:30:00.000Z")).toEqual({ text: "ينتظر منذ 30 دقيقة", tone: "warning" });
    expect(handoffBadge(handoff, "2026-10-09T10:31:00.000Z")).toEqual({ text: "ينتظر منذ 31 دقيقة", tone: "danger" });
  });

  it("uses acceptedAt and a neutral tone for an accepted handoff", () => {
    const handoff = { status: "ACCEPTED" as const, sentAt, acceptedAt: "2026-10-09T10:20:00.000Z", toRole: "RESIDENT" as const };
    expect(handoffBadge(handoff, "2026-10-09T10:50:00.000Z")).toEqual({ text: "مستلم منذ 30 دقيقة", tone: "neutral" });
  });
});
