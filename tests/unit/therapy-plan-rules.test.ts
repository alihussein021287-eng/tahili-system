import { describe, expect, it } from "vitest";
import { boundedSessionDates, evaluationDue, expectedTreatmentEnd, positiveInt, recoveryPercent } from "@/lib/therapy-plan-rules";

describe("therapy plan rules", () => {
  it("calculates the inclusive expected end date", () => {
    expect(expectedTreatmentEnd(new Date("2026-07-14T00:00:00Z"), 10).toISOString().slice(0, 10)).toBe("2026-07-23");
  });

  it("keeps generated appointments inside treatment duration", () => {
    const start = new Date("2026-07-14T00:00:00Z");
    const end = expectedTreatmentEnd(start, 14);
    const dates = boundedSessionDates(start, end, [2, 4], 4, "10:00");
    expect(dates).toHaveLength(4);
    expect(dates.every((date) => date <= end)).toBe(true);
    expect(() => boundedSessionDates(start, expectedTreatmentEnd(start, 2), [1], 4, "10:00")).toThrow(/ضمن مدة الخطة/);
  });

  it("validates positive integers and recovery percentage on the server", () => {
    expect(positiveInt("5", "عدد الجلسات")).toBe(5);
    expect(() => positiveInt("0", "عدد الجلسات")).toThrow(/موجباً/);
    expect(recoveryPercent("0")).toBe(0);
    expect(recoveryPercent("100")).toBe(100);
    expect(() => recoveryPercent("101")).toThrow(/بين 0 و100/);
  });

  it("detects due evaluations by sessions or elapsed days without replacing history", () => {
    const startDate = new Date("2026-07-01T00:00:00Z");
    expect(evaluationDue({ startDate, reviewEverySessions: 5, reviewEveryDays: null, periodicEvaluations: [], sessions: [{ actualSessions: 5 }] })).toBe(true);
    expect(evaluationDue({ startDate, reviewEverySessions: null, reviewEveryDays: 7, periodicEvaluations: [{ evaluatedAt: new Date("2026-07-08T00:00:00Z") }], sessions: [{ actualSessions: 1 }] }, new Date("2026-07-15T00:00:00Z"))).toBe(true);
  });
});
