"use server";
import { prisma } from "./db";
import { getSession } from "./access";
import { revalidatePath } from "next/cache";

export async function markAllNotificationsRead() {
  const s = await getSession();
  const uid = (s?.user as any)?.id ?? null;
  const role = (s?.user as any)?.role ?? null;
  if (!uid || !role) throw new Error("غير مصرّح");
  await prisma.notification.updateMany({
    where: { read: false, OR: [{ targetUserId: uid }, { targetRole: role }] },
    data: { read: true },
  });
  revalidatePath("/");
  revalidatePath("/notifications");
}

export async function markNotificationRead(id: string) {
  const s = await getSession();
  const uid = (s?.user as any)?.id ?? null;
  const role = (s?.user as any)?.role ?? null;
  if (!uid || !role) throw new Error("غير مصرّح");
  await prisma.notification.updateMany({
    where: { id, OR: [{ targetUserId: uid }, { targetRole: role }] },
    data: { read: true },
  });
  revalidatePath("/");
  revalidatePath("/notifications");
}
