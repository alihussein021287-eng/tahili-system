"use server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { incrementAuthVersion } from "@/lib/auth-version";
import { activateWithTemporaryCredential } from "@/lib/account-activation";

// فحص اسم المستخدم: يحدّد إذا يحتاج تفعيل أو دخول عادي
export async function checkUsername(username: string): Promise<{ state: "activate" | "password" | "invalid" }> {
  const u = (username || "").trim();
  if (!u) return { state: "invalid" };
  const user = await prisma.user.findUnique({ where: { username: u }, select: { isActive: true, needsActivation: true } });
  if (!user || !user.isActive) return { state: "invalid" };
  return { state: user.needsActivation ? "activate" : "password" };
}

// تفعيل الحساب: إثبات كلمة المرور المؤقتة ثم compare-and-set ذري.
export async function activateAccount(
  username: string,
  temporaryPassword: string,
  newPassword: string,
  confirm: string,
): Promise<{ ok: boolean; error?: string }> {
  return activateWithTemporaryCredential({
    username,
    temporaryPassword,
    newPassword,
    confirmPassword: confirm,
  }, {
    findCandidate: (candidateUsername) => prisma.user.findUnique({ where: { username: candidateUsername } }),
    comparePassword: bcrypt.compare,
    hashPassword: (password) => bcrypt.hash(password, 10),
    recordFailedProof: async (user, lockUntil) => {
      await prisma.user.updateMany({
        where: { id: user.id, isActive: true, needsActivation: true, passwordHash: user.passwordHash },
        data: lockUntil
          ? { failedLoginCount: 0, lockedUntil: lockUntil }
          : { failedLoginCount: { increment: 1 } },
      });
    },
    activate: async (user, passwordHash) => {
      const result = await prisma.user.updateMany({
        where: { id: user.id, isActive: true, needsActivation: true, passwordHash: user.passwordHash },
        data: {
          passwordHash,
          needsActivation: false,
          failedLoginCount: 0,
          lockedUntil: null,
          ...incrementAuthVersion(),
        },
      });
      return result.count;
    },
    logAttempt: async ({ userId, username: attemptedUsername, success, reason }) => {
      try {
        await prisma.loginLog.create({
          data: { userId, username: attemptedUsername, success, reason },
        });
      } catch {
        // فشل سجل المحاولة لا يغير نتيجة التفعيل ولا يكشف تفاصيل القاعدة.
      }
    },
  });
}
