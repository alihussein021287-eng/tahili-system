import { describe, it, expect } from "vitest";
import { roleDefaultSet, ALL_PERMS, PERM_GROUPS } from "@/lib/perms";

describe("roleDefaultSet", () => {
  it("الأدمن يملك كل الصلاحيات دائماً", () => {
    const set = roleDefaultSet("ADMIN" as any);
    expect(set.size).toBe(ALL_PERMS.length);
  });

  it("كل الأدوار المعرّفة برجّع Set صحيح بدون كراش", () => {
    const roles = ["MANAGER", "DOCTOR", "THERAPIST", "ACCOUNTANT", "VIEWER", "PHARMACIST", "RECEPTION"];
    for (const r of roles) {
      const set = roleDefaultSet(r as any);
      expect(set).toBeInstanceOf(Set);
    }
  });

  it("لا يوجد مفتاح صلاحية مكرر بكل الكتالوج", () => {
    const keys = ALL_PERMS;
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("كل مفتاح صلاحية فريد ضمن قسمه (تنبيه مبكر لغلطة نسخ-لصق)", () => {
    for (const group of PERM_GROUPS) {
      const keys = group.items.map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
