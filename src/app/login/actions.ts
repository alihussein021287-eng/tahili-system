"use server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { passwordError } from "@/lib/security";
import { incrementAuthVersion } from "@/lib/auth-version";

// فحص اسم المستخدم: يحدّد إذا يحتاج تفعيل أو دخول عادي
export async function checkUsername(username: string): Promise<{ state: "activate" | "password" | "invalid"; name?: string }> {
  const u = (username || "").trim();
  if (!u) return { state: "invalid" };
  const user = await prisma.user.findUnique({ where: { username: u }, select: { isActive: true, needsActivation: true, fullName: true } });
  if (!user || !user.isActive) return { state: "invalid" };
  return { state: user.needsActivation ? "activate" : "password", name: user.needsActivation ? user.fullName : undefined };
}

// تفعيل الحساب: المستخدم يعيّن كلمة سره الأولى
export async function activateAccount(username: string, password: string, confirm: string): Promise<{ ok: boolean; error?: string }> {
  const u = (username || "").trim();
  const user = await prisma.user.findUnique({ where: { username: u } });
  if (!user || !user.isActive) return { ok: false, error: "اسم المستخدم غير موجود" };
  if (!user.needsActivation) return { ok: false, error: "الحساب مفعّل مسبقاً — سجّل الدخول بكلمة سرك" };
  if (password !== confirm) return { ok: false, error: "كلمتا السر غير متطابقتين" };
  const err = passwordError(password);
  if (err) return { ok: false, error: err };
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      needsActivation: false,
      failedLoginCount: 0,
      lockedUntil: null,
      ...incrementAuthVersion(),
    },
  });
  return { ok: true };
}
