import { describe, expect, it } from "vitest";
import {
  BRANCH_LEVEL_ROLES,
  CENTER_ROLE_FOR_TARGET,
  CROSS_CENTER_LIMIT_MINUTES,
  HANDOFF_LIMIT_MINUTES,
  HANDOFF_LOAD_LABELS,
  HANDOFF_STATUS_LABELS,
  HANDOFF_TARGET_LABELS,
  handoffDelayColor,
  handoffLoad,
  handoffLimitMinutes,
} from "@/lib/handoff-rules";

describe("handoff timing rules", () => {
  it.each([
    ["RESIDENT", 30],
    ["DOCTOR", 45],
    ["HEAD_THERAPIST", 240],
    ["THERAPIST", 4320],
    ["SECRETARY", 20],
    ["RECEPTION", 20],
    ["DATA_ENTRY", 20],
  ] as const)("uses the %s role limit of %i minutes", (toRole, minutes) => {
    expect(HANDOFF_LIMIT_MINUTES[toRole]).toBe(minutes);
    expect(handoffLimitMinutes({ toRole })).toBe(minutes);
    expect(handoffLimitMinutes({ toRole, fromCenterId: 1, toCenterId: 1 })).toBe(minutes);
  });

  it.each(["RESIDENT", "THERAPIST"] as const)("overrides %s with one day for cross-center handoffs", (toRole) => {
    expect(CROSS_CENTER_LIMIT_MINUTES).toBe(1440);
    expect(handoffLimitMinutes({ toRole, fromCenterId: 1, toCenterId: 2 })).toBe(1440);
  });

  it.each([
    { fromCenterId: null, toCenterId: 2 },
    { fromCenterId: 1, toCenterId: null },
    { fromCenterId: undefined, toCenterId: 2 },
    { fromCenterId: 1, toCenterId: undefined },
  ])("requires both centers for the override: %j", (centers) => {
    expect(handoffLimitMinutes({ toRole: "RESIDENT", ...centers })).toBe(30);
  });

  it("uses twenty minutes for a return to a sender outside the target roles", () => {
    expect(handoffLimitMinutes({ toRole: "ADMIN" })).toBe(20);
    expect(handoffLimitMinutes({ toRole: "MANAGER" })).toBe(20);
  });

  it.each([
    [19, "green"],
    [20, "yellow"],
    [21, "yellow"],
    [30, "yellow"],
    [31, "red"],
  ] as const)("colors a resident handoff at %i minutes %s", (minutes, color) => {
    const sentAt = new Date("2026-10-09T08:00:00.000Z");
    const now = new Date(sentAt.getTime() + minutes * 60_000);
    expect(handoffDelayColor(sentAt, now, handoffLimitMinutes({ toRole: "RESIDENT" }))).toBe(color);
  });

  it("colors cross-center handoffs at both exact boundaries without rounding", () => {
    const sentAt = "2026-10-09T08:00:00.000Z";
    const limit = handoffLimitMinutes({ toRole: "RESIDENT", fromCenterId: 1, toCenterId: 2 });
    const at = (minutes: number) => new Date(new Date(sentAt).getTime() + minutes * 60_000).toISOString();
    expect(handoffDelayColor(sentAt, at(959.999), limit)).toBe("green");
    expect(handoffDelayColor(sentAt, at(960), limit)).toBe("yellow");
    expect(handoffDelayColor(sentAt, at(1440), limit)).toBe("yellow");
    expect(handoffDelayColor(sentAt, at(1440.001), limit)).toBe("red");
  });
});

describe("handoff role and Arabic label mappings", () => {
  it("maps load boundaries and Arabic labels", () => {
    expect([0, 2, 3, 5, 6].map(handoffLoad)).toEqual(["light", "light", "medium", "medium", "busy"]);
    expect(HANDOFF_LOAD_LABELS).toEqual({ light: "خفيف", medium: "متوسط", busy: "مزدحم" });
  });
  it("maps center doctor recipients to specialist memberships and keeps branch roles separate", () => {
    expect(CENTER_ROLE_FOR_TARGET).toEqual({
      SECRETARY: "SECRETARY",
      RESIDENT: "RESIDENT",
      DOCTOR: "SPECIALIST",
      HEAD_THERAPIST: "HEAD_THERAPIST",
      THERAPIST: "THERAPIST",
    });
    expect(BRANCH_LEVEL_ROLES).toEqual(["RECEPTION", "DATA_ENTRY"]);
  });

  it("provides every target and status label in Arabic", () => {
    expect(HANDOFF_TARGET_LABELS).toEqual({
      SECRETARY: "سكرتارية المركز",
      RESIDENT: "طبيب مقيم",
      DOCTOR: "طبيب اختصاص",
      HEAD_THERAPIST: "رئيس المعالجين",
      THERAPIST: "معالج",
      RECEPTION: "الاستقبال",
      DATA_ENTRY: "إدخال البيانات",
    });
    expect(HANDOFF_STATUS_LABELS).toEqual({
      SENT: "مرسل",
      ACCEPTED: "مستلم",
      DONE: "مكتمل",
      RETURNED: "معاد",
      CANCELLED: "ملغى",
    });
  });
});
