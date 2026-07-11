"use server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function saveShortcuts(favorites: string[]) {
  const s = await requireSession();
  const uid = (s?.user as any)?.id;
  if (!uid) throw new Error("غير مصرّح");
  const clean = JSON.stringify((favorites || []).filter((x) => typeof x === "string").slice(0, 12));
  await prisma.userPreference.upsert({
    where: { userId: uid }, update: { favorites: clean }, create: { userId: uid, favorites: clean },
  });
  revalidatePath("/");
}
