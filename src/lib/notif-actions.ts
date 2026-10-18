"use server";
import { prisma } from "./db";
import { currentPerms, requireSession } from "./access";
import { filterRoleNoticesToPatientScope } from "./patient-access";
import { canOpenNotification } from "./notifications";
import { revalidatePath } from "next/cache";

async function actor() {
  const s = await requireSession();
  const uid = (s?.user as any)?.id ?? null;
  const role = (s?.user as any)?.role ?? null;
  if (!uid || !role) throw new Error("غير مصرّح");
  return { uid: String(uid), role };
}

/**
 * Notices this viewer may act on: addressed to the user or the role, whose link the viewer may open, and (for role-wide
 * patient notices) whose patient is inside the viewer's record scope. Marking read never reaches beyond this set, so one
 * branch cannot clear another branch's role-wide notices.
 */
async function actionableNotices(uid: string, role: any, opts: { id?: string; unreadFor?: boolean }) {
  const perms = await currentPerms();
  const where: any = { OR: [{ targetUserId: uid }, { targetRole: role }] };
  if (opts.id) where.id = opts.id;
  if (opts.unreadFor) { where.read = false; where.readReceipts = { none: { userId: uid } }; }
  const rows = await prisma.notification.findMany({ where, select: { id: true, targetUserId: true, link: true } });
  const openable = rows.filter((n) => canOpenNotification(n.link, perms));
  return filterRoleNoticesToPatientScope(prisma, { userId: uid, role, permissions: perms }, openable);
}

/**
 * Marks notices read FOR THIS USER. A user-targeted notice carries its own flag; a role-wide notice gets a per-user
 * receipt, so one user reading it never changes what another user of the same role sees (visibility, read state and the
 * underlying work resolution stay separate: resolution of a handoff/stage still closes the notice for everyone).
 */
async function markRead(uid: string, rows: { id: string; targetUserId: string | null }[]) {
  const direct = rows.filter((n) => n.targetUserId === uid).map((n) => n.id);
  const shared = rows.filter((n) => n.targetUserId == null).map((n) => n.id);
  if (direct.length) await prisma.notification.updateMany({ where: { id: { in: direct }, read: false }, data: { read: true } });
  if (shared.length) await prisma.notificationReadReceipt.createMany({ data: shared.map((notificationId) => ({ notificationId, userId: uid })), skipDuplicates: true });
}

export async function markAllNotificationsRead() {
  const { uid, role } = await actor();
  const rows = await actionableNotices(uid, role, { unreadFor: true });
  await markRead(uid, rows);
  revalidatePath("/");
  revalidatePath("/notifications");
}

export async function markNotificationRead(id: string) {
  const { uid, role } = await actor();
  const rows = await actionableNotices(uid, role, { id });
  await markRead(uid, rows);
  revalidatePath("/");
  revalidatePath("/notifications");
}
