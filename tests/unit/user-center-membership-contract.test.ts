import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("staff centre membership management", () => {
  const actions = readFileSync(resolve(process.cwd(), "src/app/(app)/users/actions.ts"), "utf8");
  const tabs = readFileSync(resolve(process.cwd(), "src/components/UserTabs.tsx"), "utf8");

  it("uses the employee profile as the single write path for placement, transfer, and ending", () => {
    expect(actions).toContain("export async function placeUserInCenter");
    expect(actions).toContain("export async function updateUserCenterMembership");
    expect(actions).toContain("export async function endUserCenterMembership");
    expect(tabs).toContain("مراكز العمل");
    expect(tabs).toContain("إضافة أو نقل إلى مركز");
    expect(tabs).toContain("سجل المراكز السابق");
  });

  it("closes a prior effective placement for one-centre roles without deleting history", () => {
    expect(actions).toContain("allowsMultipleActiveCenters(role)");
    expect(actions).toContain("status: CenterMembershipStatus.INACTIVE, endDate: now");
    expect(actions).toContain("centerId_userId_role");
  });

  it("does not expose a free centre-role selector and verifies the account role on the server", () => {
    expect(actions).toContain("centerRoleForUserRole(account.role)");
    expect(actions).toContain("role !== expectedRole");
    expect(tabs).toContain("الصفة مثبتة من دور الحساب");
    expect(tabs).toContain("هذا الدور يعمل على مستوى الفرع ولا يحتاج ارتباطاً بمركز علاجي");
  });
});
