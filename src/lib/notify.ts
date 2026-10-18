import { prisma } from "./db";
import type { Prisma, UserRole } from "@prisma/client";
import { getAdminConfig } from "@/lib/admin-config";

const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

export type NotificationClient = {
  notification: {
    findFirst(args: Prisma.NotificationFindFirstArgs): Promise<{ id: string } | null>;
    create(args: Prisma.NotificationCreateArgs): Promise<unknown>;
    updateMany?(args: Prisma.NotificationUpdateManyArgs): Promise<{ count: number }>;
  };
};

async function createNotification(
  client: NotificationClient,
  data: { targetRole?: UserRole; targetUserId?: string; title: string; body?: string | null; link?: string | null; handoffId?: string | null; careStageId?: string | null },
  options: { includeReadInDedupe?: boolean } = {},
) {
  const config = await getAdminConfig().catch(() => null);
  const dedupeMinutes = Math.max(1, Math.min(1440, config?.notificationDedupeMinutes ?? DEDUPE_WINDOW_MS / 60_000));
  const since = new Date(Date.now() - dedupeMinutes * 60_000);
  const existing = await client.notification.findFirst({
    where: {
      // A role-wide notice that someone already read must not swallow a new occurrence for the others/readers.
      ...(options.includeReadInDedupe ? {} : { read: false, ...(data.targetUserId ? {} : { readReceipts: { none: {} } }) } as any),
      title: data.title,
      body: data.body ?? null,
      link: data.link ?? null,
      handoffId: data.handoffId ?? null,
      careStageId: data.careStageId ?? null,
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
  opts: { body?: string; link?: string; handoffId?: string; careStageId?: string } = {},
) {
  return createNotification(
    client,
    { targetRole: role, title, body: opts.body ?? null, link: opts.link ?? null, handoffId: opts.handoffId ?? null, careStageId: opts.careStageId ?? null },
    { includeReadInDedupe: true },
  );
}

export async function notifyUserInTransaction(
  client: NotificationClient,
  userId: string,
  title: string,
  opts: { body?: string; link?: string; handoffId?: string; careStageId?: string } = {},
) {
  return createNotification(client, { targetUserId: userId, title, body: opts.body ?? null, link: opts.link ?? null, handoffId: opts.handoffId ?? null, careStageId: opts.careStageId ?? null }, { includeReadInDedupe: true });
}

// إنشاء إشعار موجّه لدور معيّن (يُستخدم بين المحطات)
export async function notifyRole(role: string | null | undefined, title: string, opts: { body?: string; link?: string; careStageId?: string } = {}) {
  if (!role) return;
  try { await createNotification(prisma, { targetRole: role as UserRole, title, body: opts.body ?? null, link: opts.link ?? null, careStageId: opts.careStageId ?? null }); } catch {}
}
export async function notifyUser(userId: string | null | undefined, title: string, opts: { body?: string; link?: string } = {}) {
  if (!userId) return;
  try { await createNotification(prisma, { targetUserId: userId, title, body: opts.body ?? null, link: opts.link ?? null }); } catch {}
}
