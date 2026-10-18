import { describe, expect, it } from "vitest";
import { buildHandoffTimeline, currentHandoffStep } from "@/lib/handoff-timeline";
import type { PatientHandoffHistoryRow } from "@/lib/patient-handoff-presentation";

const sent: PatientHandoffHistoryRow = {
  id: "a", sentAt: "2026-10-09T21:30:00.000Z", acceptedAt: null,
  fromRole: "RECEPTION", fromUser: { fullName: "علي حسين" }, fromCenter: null,
  toRole: "SECRETARY", toUser: null, toCenter: { name: "مركز بغداد" },
  status: "SENT", note: "متابعة", returnReason: null,
};
const returned: PatientHandoffHistoryRow = {
  ...sent, id: "b", sentAt: "2026-10-10T01:30:00.000Z", acceptedAt: "2026-10-10T01:45:00.000Z", status: "RETURNED",
  returnReason: "إعادة للتنسيق", acceptedBy: { fullName: "زينب كاظم" },
};

describe("handoff timeline", () => {
  it("sorts oldest first and formats the sent instant in Baghdad time with parties, center, actor and return reason", () => {
    const input = [returned, sent];
    const rows = buildHandoffTimeline(input);
    expect(input[0].id).toBe("b");
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rows[0]).toEqual(expect.objectContaining({
      fromText: expect.stringContaining("علي حسين"), toText: expect.stringContaining("سكرتارية المركز"),
      centerName: "مركز بغداد", statusLabel: "مرسل", note: "متابعة", actorText: "علي حسين",
    }));
    expect(rows[0].timeText).toMatch(/١٠|10/);
    expect(rows[0].timeText).toMatch(/٣٠|30/);
    expect(rows[1]).toEqual(expect.objectContaining({ statusLabel: "معاد", returnReason: "إعادة للتنسيق", actorText: "علي حسين", acceptedByText: "زينب كاظم" }));
    expect(rows[1].acceptedTimeText).toMatch(/٤٥|45/);
  });

  it("uses the newest open handoff and its status clock", () => {
    const now = new Date("2026-10-10T02:00:00.000Z");
    const accepted = { ...sent, id: "c", sentAt: "2026-10-10T01:00:00.000Z", acceptedAt: "2026-10-10T01:40:00.000Z", status: "ACCEPTED" as const, acceptedBy: { fullName: "زينب كاظم" } };
    expect(currentHandoffStep([accepted, sent], now)).toEqual({ holderText: "زينب كاظم", centerName: "مركز بغداد", sinceText: "مستلم منذ 20 دقيقة", status: "ACCEPTED" });
    expect(currentHandoffStep([sent, returned], now)).toEqual({ holderText: "سكرتارية المركز", centerName: "مركز بغداد", sinceText: "ينتظر منذ 4 ساعة و30 دقيقة", status: "SENT" });
    expect(currentHandoffStep([returned], now)).toBeNull();
  });
});
