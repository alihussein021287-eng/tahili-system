import { describe, expect, it } from "vitest";
import { templateGrants, TEMPLATE_WITHHELD } from "@/lib/role-templates";

describe("quick permission templates cannot silently grant administrative access", () => {
  it("refuses the ADMIN/MANAGER templates on accounts that do not already hold that role, and never promotes the role", () => {
    expect(() => templateGrants("RECEPTION", "ADMIN", false)).toThrow(/الدور أصلاً/);
    expect(() => templateGrants("THERAPIST", "MANAGER", false)).toThrow(/الدور أصلاً/);
    expect(() => templateGrants("MANAGER", "MANAGER", true)).toThrow(/الدور أصلاً/);
    expect(() => templateGrants("ADMIN", "ADMIN", false)).not.toThrow();
  });
  it("withholds admin-only, Data Center and personnel-edit keys from every non-admin account", () => {
    for (const role of ["RECEPTION", "DOCTOR", "ACCOUNTANT", "PHARMACIST", "DATA_ENTRY"]) {
      const grants = templateGrants("RECEPTION", role, false);
      for (const key of TEMPLATE_WITHHELD) expect(grants.has(key), `${role}:${key}`).toBe(false);
      expect([...grants].some((k) => k.startsWith("datacenter."))).toBe(false);
    }
    expect(TEMPLATE_WITHHELD.has("users.manage")).toBe(true);
    expect(TEMPLATE_WITHHELD.has("datacenter.import.apply")).toBe(true);
  });
  it("keeps the ordinary role templates usable", () => {
    expect(templateGrants("RECEPTION", "RECEPTION", false).size).toBeGreaterThan(3);
  });
});
