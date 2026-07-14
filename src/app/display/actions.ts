"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { generateDisplayCredential, hashDisplayCredential, hashPairingCode, setDisplayCookie } from "@/lib/display-auth";

export type PairState = { error?: string };

export async function pairDisplay(_: PairState, formData: FormData): Promise<PairState> {
  const code = formData.get("code")?.toString().trim().toUpperCase() || "";
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code)) return { error: "رمز الاقتران غير صالح" };
  const now = new Date();
  const device = await prisma.displayDevice.findUnique({ where: { pairingCodeHash: hashPairingCode(code) } });
  if (!device || device.status !== "PAIRING" || !device.pairingExpiresAt || device.pairingExpiresAt <= now) return { error: "انتهت صلاحية الرمز أو تم استخدامه" };

  const token = generateDisplayCredential();
  const updated = await prisma.displayDevice.updateMany({
    where: { id: device.id, status: "PAIRING", pairingCodeHash: device.pairingCodeHash, pairingExpiresAt: { gt: now } },
    data: {
      status: "ACTIVE", credentialHash: hashDisplayCredential(token), pairedAt: now,
      pairingCodeHash: null, pairingExpiresAt: null, revokedAt: null, lastSeenAt: now,
    },
  });
  if (updated.count !== 1) return { error: "تم استخدام الرمز، أنشئ رمزاً جديداً" };
  await setDisplayCookie(device.id, token);
  redirect("/display");
}
