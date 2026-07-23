import { describe, expect, it } from "vitest";
import { roleDefaultSet } from "@/lib/perms";
import {
  ALL_ITEMS,
  NAV_GROUPS,
  ROLE_SIDEBAR_RULES,
  WORK_REGISTRY,
  canOpenRegistryItem,
  requiredPermissionsForHref,
} from "@/lib/work-registry";

describe("work and navigation registry", () => {
  it("declares a permission for every visible route and uses canonical hubs", () => {
    expect(ALL_ITEMS.every((item) => Boolean(item.perm || item.perms?.length))).toBe(true);
    expect(ALL_ITEMS.some((item) => ["/tasks", "/appointments", "/queue", "/visits", "/pharmacy", "/inventory", "/finance"].includes(item.href))).toBe(false);
    expect(requiredPermissionsForHref("/my-work")).toEqual(["dashboard.view"]);
  });

  it("does not produce an empty configured sidebar group for any actual role", () => {
    for (const [role, rule] of Object.entries(ROLE_SIDEBAR_RULES)) {
      const permissions = roleDefaultSet(role as keyof typeof ROLE_SIDEBAR_RULES);
      for (const groupKey of rule.groups) {
        const group = NAV_GROUPS.find((candidate) => candidate.key === groupKey);
        expect(group, `${role}/${groupKey}`).toBeDefined();
        const visible = group!.hrefs
          .map((href) => ALL_ITEMS.find((item) => item.href === href))
          .filter((item) => item && canOpenRegistryItem(item, permissions));
        expect(visible.length, `${role}/${groupKey}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps registry metadata unique and links work surfaces to openable routes", () => {
    expect(new Set(WORK_REGISTRY.map((entry) => entry.key)).size).toBe(WORK_REGISTRY.length);
    expect(new Set(WORK_REGISTRY.map((entry) => entry.deepLink)).size).toBe(WORK_REGISTRY.length);
    for (const entry of WORK_REGISTRY.filter((candidate) => candidate.surfaces.includes("my-work"))) {
      expect(entry.requiredPermissions.length).toBeGreaterThan(0);
    }
  });
});
