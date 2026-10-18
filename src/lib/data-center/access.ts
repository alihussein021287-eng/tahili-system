import { prisma } from "@/lib/db";
import { getSession, loadPerms } from "@/lib/access";
import type { Actor } from "./operations";

/** The signed-in actor, with permissions and branch resolved server-side (never from the request). */
export async function currentActor(): Promise<Actor | null> {
  const session = await getSession();
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || !u.role) return null;
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { isActive: true, role: true, branchId: true, branch: { select: { isActive: true } } } });
  if (!row?.isActive || row.role !== u.role) return null;
  const permissions = await loadPerms(u.id, row.role);
  return { userId: u.id, role: row.role, permissions, branchId: row.branchId != null && row.branch?.isActive ? row.branchId : null };
}
