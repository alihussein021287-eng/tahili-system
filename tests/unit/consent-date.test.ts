import { it, expect } from "vitest";
import { consentCalendarDate, parseConsentSignedDate } from "@/lib/consent-date";
const localMidnight = new Date("2026-10-27T21:30:00Z");
it("accepts today's Baghdad signature date during the previous UTC calendar day", () => {
  expect(consentCalendarDate(localMidnight)).toBe("2026-10-28");
  expect(parseConsentSignedDate("2026-10-28", localMidnight).toISOString()).toBe("2026-10-28T00:00:00.000Z");
});
it("rejects tomorrow in Baghdad", () => expect(() => parseConsentSignedDate("2026-10-29", localMidnight)).toThrow());
it("rejects impossible calendar dates instead of normalizing them", () => expect(() => parseConsentSignedDate("2026-02-30", localMidnight)).toThrow());
it("accepts historical dates but rejects unstructured timestamps", () => {
  expect(parseConsentSignedDate("2026-01-01", localMidnight).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  expect(() => parseConsentSignedDate("2026-10-28T00:00:00Z", localMidnight)).toThrow();
});
