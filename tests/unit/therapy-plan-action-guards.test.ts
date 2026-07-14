import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(app)/therapy/actions.ts", "utf8");

describe("therapy plan server action guards", () => {
  it("enforces center manager membership in plan mutations", () => {
    expect(source).toContain('role: "HEAD_THERAPIST", status: "ACTIVE"');
    expect(source.match(/assertCenterManager\(tx, who/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("restricts therapist assignment and recording to active center membership", () => {
    expect(source).toContain('role: "THERAPIST", status: "ACTIVE"');
    expect(source).toContain("المعالج المسند فقط يستطيع تسجيل الجلسة");
    expect(source).toContain("لا يمكنك تسجيل جلسة خارج مركز عضويتك");
  });

  it("selects an active doctor by identifier and validates recovery server-side", () => {
    expect(source).toContain('id: specialistDoctorId, isActive: true, role: "DOCTOR"');
    expect(source.match(/recoveryPercent\(fd.get/g)?.length).toBe(2);
  });

  it("preserves conflict and duration checks", () => {
    expect(source).toContain("boundedSessionDates");
    expect(source).toContain("تعارض في الموعد");
    expect(source).toContain("توجد مواعيد بعد نهاية المدة الجديدة");
  });
});
