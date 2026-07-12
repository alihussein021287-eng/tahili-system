import { prisma } from "./db";
import type { UserRole } from "@prisma/client";

const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

type NotificationClient = Pick<typeof prisma, "notification">;

async function createNotification(
  client: NotificationClient,
  data: { targetRole?: UserRole; targetUserId?: string; title: string; body?: string | null; link?: string | null },
  options: { includeReadInDedupe?: boolean } = {},
) {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const existing = await client.notification.findFirst({
    where: {
      ...(options.includeReadInDedupe ? {} : { read: false }),
      title: data.title,
      body: data.body ?? null,
      link: data.link ?? null,
      createdAt: { gte: since },
      ...(data.targetUserId ? { targetUserId: data.targetUserId } : { targetRole: data.targetRole }),
    },
    select: { id: true },
  });
  if (existing) return false;
  await client.notification.create({ data });
  return true;
}

export async function notifyRoleInTransaction(
  client: NotificationClient,
  role: UserRole,
  title: string,
  opts: { body?: string; link?: string } = {},
) {
  return createNotification(
    client,
    { targetRole: role, title, body: opts.body ?? null, link: opts.link ?? null },
    { includeReadInDedupe: true },
  );
}

// إنشاء إشعار موجّه لدور معيّن (يُستخدم بين المحطات)
export async function notifyRole(role: string | null | undefined, title: string, opts: { body?: string; link?: string } = {}) {
  if (!role) return;
  try { await createNotification(prisma, { targetRole: role as UserRole, title, body: opts.body ?? null, link: opts.link ?? null }); } catch {}
}
export async function notifyUser(userId: string | null | undefined, title: string, opts: { body?: string; link?: string } = {}) {
  if (!userId) return;
  try { await createNotification(prisma, { targetUserId: userId, title, body: opts.body ?? null, link: opts.link ?? null }); } catch {}
}
