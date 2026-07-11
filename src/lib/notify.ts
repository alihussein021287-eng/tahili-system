import { prisma } from "./db";

const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

async function createNotification(data: { targetRole?: any; targetUserId?: string; title: string; body?: string | null; link?: string | null }) {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const existing = await prisma.notification.findFirst({
    where: {
      read: false,
      title: data.title,
      body: data.body ?? null,
      link: data.link ?? null,
      createdAt: { gte: since },
      ...(data.targetUserId ? { targetUserId: data.targetUserId } : { targetRole: data.targetRole }),
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.notification.create({ data });
}

// إنشاء إشعار موجّه لدور معيّن (يُستخدم بين المحطات)
export async function notifyRole(role: string | null | undefined, title: string, opts: { body?: string; link?: string } = {}) {
  if (!role) return;
  try { await createNotification({ targetRole: role as any, title, body: opts.body ?? null, link: opts.link ?? null }); } catch {}
}
export async function notifyUser(userId: string | null | undefined, title: string, opts: { body?: string; link?: string } = {}) {
  if (!userId) return;
  try { await createNotification({ targetUserId: userId, title, body: opts.body ?? null, link: opts.link ?? null }); } catch {}
}
