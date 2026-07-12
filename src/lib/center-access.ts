import { prisma } from "@/lib/db";
import { currentPerms, requireSession } from "@/lib/access";

export async function centerActor(centerId: number, requiredPermission = "centers.view") {
  const [session, permissions] = await Promise.all([requireSession(), currentPerms()]);
  if (!permissions.has(requiredPermission)) throw new Error("لا تملك صلاحية هذا الإجراء");
  const userId = (session.user as any).id as string;
  const central = permissions.has("centers.central.view");
  const membership = await prisma.centerMembership.findFirst({ where: { centerId, userId, status: "ACTIVE", startDate: { lte: new Date() }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] } });
  if (!central && !membership) throw new Error("لا تملك عضوية فعالة في هذا المركز");
  return { userId, name: session.user?.name || "", permissions, membership, central };
}

export async function accessibleCenterIds() {
  const [session, permissions] = await Promise.all([requireSession(), currentPerms()]);
  if (permissions.has("centers.central.view")) return null;
  const rows = await prisma.centerMembership.findMany({ where: { userId: (session.user as any).id, status: "ACTIVE", startDate: { lte: new Date() }, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] }, select: { centerId: true } });
  return rows.map((row) => row.centerId);
}
