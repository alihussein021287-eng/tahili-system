import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CenterMembershipRole, CenterMembershipStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { activeMembershipWhere, activeSecretaryWhere, allowsMultipleActiveCenters, centerRoleForUserRole, countActiveSecretaries, parseCenterMembership } from "@/lib/center-membership";

function membershipForm(role: string, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("userId", "test-user");
  fd.set("role", role);
  for (const [key, value] of Object.entries(extra)) fd.set(key, value);
  return fd;
}

describe("center membership capacities", () => {
  it.each(["SECRETARY", "RESIDENT", "SPECIALIST"])("accepts %s", (role) => {
    expect(parseCenterMembership(membershipForm(role, { specialty: "أعصاب" })).role).toBe(role);
  });

  it("rejects unknown roles, fields and missing users", () => {
    expect(() => parseCenterMembership(membershipForm("ADMIN"))).toThrow();
    expect(() => parseCenterMembership(membershipForm("SECRETARY", { centerId: "999" }))).toThrow();
    const fd = new FormData(); fd.set("role", "SECRETARY");
    expect(() => parseCenterMembership(fd)).toThrow();
  });

  it("counts only effective, active secretaries with active user accounts", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const member = { role: CenterMembershipRole.SECRETARY, status: CenterMembershipStatus.ACTIVE, startDate: new Date("2026-10-01"), endDate: null, user: { isActive: true } };
    expect(countActiveSecretaries([member, { ...member, status: CenterMembershipStatus.SUSPENDED }, { ...member, role: CenterMembershipRole.RESIDENT }, { ...member, endDate: new Date("2026-10-08") }, { ...member, user: { isActive: false } }], now)).toBe(1);
    expect(countActiveSecretaries([{ ...member, startDate: new Date("2026-10-10") }], now)).toBe(0);
    expect(activeSecretaryWhere(now)).toMatchObject({ role: "SECRETARY", status: "ACTIVE", user: { is: { isActive: true } } });
  });

  it("shares inclusive date conditions across any membership role and secretary queries", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const common = {
      status: "ACTIVE", startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }], user: { is: { isActive: true } },
    };
    expect(activeMembershipWhere(undefined, now)).toEqual(common);
    expect(activeMembershipWhere("SPECIALIST", now)).toEqual({ ...common, role: "SPECIALIST" });
    expect(activeSecretaryWhere(now)).toEqual({ ...common, role: "SECRETARY" });
    expect(countActiveSecretaries([{
      role: "SECRETARY", status: "ACTIVE", startDate: now, endDate: now, user: { isActive: true },
    }], now)).toBe(1);
  });

  it("keeps therapists and device operators eligible for multiple centres only", () => {
    expect(allowsMultipleActiveCenters(CenterMembershipRole.THERAPIST)).toBe(true);
    expect(allowsMultipleActiveCenters(CenterMembershipRole.DEVICE_OPERATOR)).toBe(true);
    expect(allowsMultipleActiveCenters(CenterMembershipRole.SECRETARY)).toBe(false);
    expect(allowsMultipleActiveCenters(CenterMembershipRole.SPECIALIST)).toBe(false);
  });

  it("derives centre placement roles from the account role instead of a free selection", () => {
    expect(centerRoleForUserRole("SECRETARY")).toBe("SECRETARY");
    expect(centerRoleForUserRole("DOCTOR")).toBe("SPECIALIST");
    expect(centerRoleForUserRole("DRESSING")).toBe("DEVICE_OPERATOR");
    expect(centerRoleForUserRole("PROSTHETICS")).toBe("DEVICE_OPERATOR");
    expect(centerRoleForUserRole("DATA_ENTRY")).toBeNull();
    expect(centerRoleForUserRole("RECEPTION")).toBeNull();
  });

  it("renders count and zero warning in center and settings surfaces", () => {
    const paths = [
      "src/components/centers/CenterWorkspace.tsx",
      "src/app/(app)/centers/page.tsx",
      "src/app/(app)/settings/page.tsx",
    ];
    for (const path of paths) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source).toContain("سكرتارية فعالة");
      expect(source).toContain("لا توجد سكرتارية لهذا المركز");
    }
    const settings = readFileSync(resolve(process.cwd(), paths[2]), "utf8");
    expect(settings).toContain("إضافة الموظف أو نقله أو إنهاء ارتباطه تتم من");
    expect(settings).not.toContain("saveCenterMembership.bind(null, selectedCenter.id)");
  });

  it("shows the names of effective center members without changing membership rules", () => {
    const settings = readFileSync(resolve(process.cwd(), "src/app/(app)/settings/page.tsx"), "utf8");
    expect(settings).toContain("where: activeMembershipWhere(undefined, now)");
    expect(settings).toContain("user: { select: { id: true, fullName: true } }");
    expect(settings).toContain("فريق المركز");
    expect(settings).toContain("الأعضاء الفعّالون فقط");
  });
});
