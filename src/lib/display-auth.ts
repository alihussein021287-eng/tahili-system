import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export const DISPLAY_COOKIE = "tahili-display-credential";

function secret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("NEXTAUTH_SECRET is required for display credentials");
  return value;
}

function digest(kind: "pair" | "credential", value: string) {
  return createHmac("sha256", secret()).update(`${kind}:${value}`).digest("hex");
}

export const hashPairingCode = (code: string) => digest("pair", code.trim().toUpperCase());
export const hashDisplayCredential = (token: string) => digest("credential", token);

export function generatePairingCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function generateDisplayCredential() {
  return randomBytes(32).toString("base64url");
}

function equalHash(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function setDisplayCookie(deviceId: string, token: string) {
  const jar = await cookies();
  jar.set(DISPLAY_COOKIE, `${deviceId}.${token}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NEXTAUTH_ALLOW_HTTP_LOGIN !== "true",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearDisplayCookie() {
  const jar = await cookies();
  jar.set(DISPLAY_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NEXTAUTH_ALLOW_HTTP_LOGIN !== "true", path: "/", maxAge: 0 });
}

export async function getDisplayDevice() {
  const raw = (await cookies()).get(DISPLAY_COOKIE)?.value;
  if (!raw) return null;
  const separator = raw.indexOf(".");
  if (separator < 1) return null;
  const id = raw.slice(0, separator);
  const token = raw.slice(separator + 1);
  if (!token) return null;
  const device = await prisma.displayDevice.findUnique({ where: { id }, include: { center: true } });
  if (!device?.credentialHash || device.status !== "ACTIVE") return null;
  return equalHash(device.credentialHash, hashDisplayCredential(token)) ? device : null;
}
