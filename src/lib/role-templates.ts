import { ALL_PERMS, PERM_GROUPS, roleDefaultSet } from "@/lib/perms";

// Quick permission templates must never silently widen access: administrative templates only apply to an account that already holds that role,
// the role itself is never promoted from a template, and admin-only / Data Center / personnel-edit keys are never granted to a non-admin account.
export const PRIVILEGED_TEMPLATE_ROLES = ["ADMIN", "MANAGER"];
export const TEMPLATE_WITHHELD = new Set(PERM_GROUPS.flatMap((g) => g.items.filter((i) => i.adminOnly).map((i) => i.key)).concat(ALL_PERMS.filter((k) => k.startsWith("datacenter.") || k === "employees.edit")));

export function templateGrants(existingRole: string, templateRole: string, alsoSetRole: boolean): Set<string> {
  if (PRIVILEGED_TEMPLATE_ROLES.includes(templateRole) && (alsoSetRole || existingRole !== templateRole)) {
    throw new Error("قالب الصلاحيات الإداري يُطبَّق فقط على حساب يملك هذا الدور أصلاً؛ تغيير الدور إلى مدير يتم بقرار منفصل من تبويب الأمان");
  }
  return new Set([...roleDefaultSet(templateRole as never)].filter((k) => existingRole === "ADMIN" || !TEMPLATE_WITHHELD.has(k)));
}
