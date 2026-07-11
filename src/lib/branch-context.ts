import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";

export async function currentUserBranch() {
  const session = await requireSession();
  const id = (session?.user as any)?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id },
    select: { branchId: true, branch: { select: { id: true, name: true, isActive: true } } },
  });
}

export function effectiveBranchId(param: string | undefined, userBranchId?: number | null) {
  if (param === "all") return null;
  if (param) {
    const n = Number(param);
    return Number.isNaN(n) ? null : n;
  }
  return userBranchId ?? null;
}

export function branchBadge(branch?: { name?: string | null } | null) {
  return branch?.name ? `الفرع الافتراضي: ${branch.name}` : "كل الفروع";
}
