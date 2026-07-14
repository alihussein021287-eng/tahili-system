"use server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/access";
import { generatePairingCode, hashPairingCode } from "@/lib/display-auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await requireSession();
  const id = (session.user as any)?.id as string | undefined;
  const user = id ? await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } }) : null;
  if (!user?.isActive || user.role !== "ADMIN") throw new Error("غير مصرّح — الأدمن فقط");
  return id!;
}

async function readConfig(formData: FormData) {
  const name = formData.get("name")?.toString().trim().slice(0, 80) || "";
  if (!name) throw new Error("اسم الشاشة مطلوب");
  const centerIdRaw = Number(formData.get("centerId"));
  const centerId = Number.isInteger(centerIdRaw) && centerIdRaw > 0 ? centerIdRaw : null;
  if (centerId && !(await prisma.center.count({ where: { id: centerId } }))) throw new Error("المركز غير صالح");
  const allowedHalls = new Set((await prisma.therapyHall.findMany({ where: { active: true }, select: { name: true } })).map((hall) => hall.name));
  const halls = Array.from(new Set(formData.getAll("halls").map(String).filter((hall) => allowedHalls.has(hall)))).slice(0, 20);
  const seconds = Number(formData.get("callDisplaySeconds"));
  const callDisplaySeconds = Number.isInteger(seconds) && seconds >= 10 && seconds <= 300 ? seconds : 45;
  const rawMode = formData.get("nameMode")?.toString();
  const nameMode = rawMode === "FULL" || rawMode === "QUEUE_NUMBER" ? rawMode : "INITIALS";
  return { name, centerId, halls, callDisplaySeconds, nameMode } as const;
}

export async function createDisplayDevice(formData: FormData) {
  const userId = await requireAdmin();
  const data = await readConfig(formData);
  const device = await prisma.displayDevice.create({ data });
  await logAudit({ userId, action: "CREATE", tableName: "display_devices", recordId: device.id, newValue: data });
  revalidatePath("/settings");
}

export async function updateDisplayDevice(id: string, formData: FormData) {
  const userId = await requireAdmin();
  const data = await readConfig(formData);
  await prisma.displayDevice.update({ where: { id }, data });
  await logAudit({ userId, action: "UPDATE", tableName: "display_devices", recordId: id, newValue: data });
  revalidatePath("/settings");
}

export type PairCodeState = { code?: string; expiresAt?: string; error?: string };

export async function generateDisplayPairingCode(id: string, _: PairCodeState): Promise<PairCodeState> {
  const userId = await requireAdmin();
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const updated = await prisma.displayDevice.updateMany({
    where: { id },
    data: {
      status: "PAIRING", pairingCodeHash: hashPairingCode(code), pairingExpiresAt: expiresAt,
      credentialHash: null, pairedAt: null, lastSeenAt: null, revokedAt: null,
    },
  });
  if (updated.count !== 1) return { error: "الشاشة غير موجودة" };
  await logAudit({ userId, action: "UPDATE", tableName: "display_devices", recordId: id, newValue: { status: "PAIRING", pairingExpiresAt: expiresAt } });
  return { code, expiresAt: expiresAt.toISOString() };
}

export async function revokeDisplayDevice(id: string) {
  const userId = await requireAdmin();
  await prisma.displayDevice.update({ where: { id }, data: {
    status: "REVOKED", credentialHash: null, pairingCodeHash: null, pairingExpiresAt: null, revokedAt: new Date(),
  } });
  await logAudit({ userId, action: "UPDATE", tableName: "display_devices", recordId: id, newValue: { status: "REVOKED" } });
  revalidatePath("/settings");
}
