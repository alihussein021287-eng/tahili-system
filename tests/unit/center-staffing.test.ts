import { CenterMembershipRole, CenterMembershipStatus } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CenterStaffingAlerts } from "@/components/settings/CenterStaffingAlerts";
import { centerStaffingGaps } from "@/lib/center-staffing";
import { CENTER_ROLE_FOR_TARGET } from "@/lib/handoff-rules";

const now = new Date("2026-10-10T12:00:00.000Z");
const centers = [{ id: 1, active: true }, { id: 2, active: false }];

function member(role: CenterMembershipRole, overrides: Partial<{
  centerId: number;
  status: CenterMembershipStatus;
  startDate: Date;
  endDate: Date | null;
  user: { isActive: boolean };
}> = {}) {
  return {
    centerId: 1,
    role,
    status: CenterMembershipStatus.ACTIVE,
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: null,
    user: { isActive: true },
    ...overrides,
  };
}

describe("centerStaffingGaps", () => {
  it("reports all four missing roles for an unstaffed active center and omits inactive centers", () => {
    expect(centerStaffingGaps(centers, [], now)).toEqual([{
      centerId: 1,
      missingRoles: ["SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST"],
    }]);
  });

  it("uses the handoff role mapping and counts effective membership at date boundaries", () => {
    const members = (["SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST"] as const)
      .map((role) => member(CENTER_ROLE_FOR_TARGET[role], { startDate: now, endDate: now }));
    expect(centerStaffingGaps(centers, members, now)[0].missingRoles).toEqual([]);
  });

  it("ignores expired, future, suspended, and inactive-user memberships", () => {
    const members = [
      member(CenterMembershipRole.SECRETARY, { endDate: new Date("2026-10-09T23:59:59.999Z") }),
      member(CenterMembershipRole.RESIDENT, { startDate: new Date("2026-10-11T00:00:00.000Z") }),
      member(CenterMembershipRole.SPECIALIST, { status: CenterMembershipStatus.SUSPENDED }),
      member(CenterMembershipRole.HEAD_THERAPIST, { user: { isActive: false } }),
    ];
    expect(centerStaffingGaps(centers, members, now)[0].missingRoles).toEqual([
      "SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST",
    ]);
  });

  it("keeps memberships scoped to their center", () => {
    expect(centerStaffingGaps([{ id: 1, active: true }, { id: 2, active: true }], [member(CenterMembershipRole.SECRETARY, { centerId: 2 })], now))
      .toEqual([
        { centerId: 1, missingRoles: ["SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST"] },
        { centerId: 2, missingRoles: ["RESIDENT", "DOCTOR", "HEAD_THERAPIST"] },
      ]);
  });
});

describe("CenterStaffingAlerts", () => {
  it("renders an Arabic amber alert for each incomplete center and no alert for complete centers", () => {
    const gaps = [
      { centerId: 1, centerName: "مركز بغداد", missingRoles: ["SECRETARY", "RESIDENT", "DOCTOR", "HEAD_THERAPIST"] as const },
      { centerId: 2, centerName: "مركز النجف", missingRoles: [] },
      { centerId: 3, centerName: "مركز البصرة", missingRoles: ["DOCTOR"] as const },
    ];
    const html = renderToStaticMarkup(createElement(CenterStaffingAlerts, { gaps }));
    expect(html.match(/role="alert"/g)).toHaveLength(2);
    expect(html).toContain("border-amber-300");
    for (const label of ["مركز بغداد", "مركز البصرة", "لا سكرتارية", "لا طبيب مقيم", "لا اختصاص", "لا رئيس معالجين"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("مركز النجف");
    expect(renderToStaticMarkup(createElement(CenterStaffingAlerts, { gaps: [] }))).toBe("");
  });
});
