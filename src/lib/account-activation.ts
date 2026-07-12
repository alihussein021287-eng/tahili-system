import { LOGIN_LOCK_MINUTES, LOGIN_MAX_ATTEMPTS, passwordError } from "@/lib/security";

export const GENERIC_ACTIVATION_ERROR = "تعذر التفعيل. تحقق من بيانات الحساب وحاول لاحقاً";

export function initialCredentialError(password: string) {
  const error = passwordError(password);
  return error ? `كلمة المرور المؤقتة مطلوبة: ${error}` : null;
}

export type ActivationCandidate = {
  id: string;
  username: string;
  passwordHash: string;
  isActive: boolean;
  needsActivation: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  authVersion: number;
};

export type ActivationDependencies = {
  findCandidate(username: string): Promise<ActivationCandidate | null>;
  comparePassword(password: string, hash: string): Promise<boolean>;
  hashPassword(password: string): Promise<string>;
  recordFailedProof(user: ActivationCandidate, lockUntil: Date | null): Promise<void>;
  activate(user: ActivationCandidate, passwordHash: string): Promise<number>;
  logAttempt(details: { userId?: string; username: string; success: boolean; reason: string }): Promise<void>;
  now?: () => Date;
};

export type ActivationResult = { ok: true } | { ok: false; error: string };

export async function activateWithTemporaryCredential(
  input: {
    username: string;
    temporaryPassword: string;
    newPassword: string;
    confirmPassword: string;
  },
  deps: ActivationDependencies,
): Promise<ActivationResult> {
  const username = input.username.trim();
  if (!username || !input.temporaryPassword) return { ok: false, error: GENERIC_ACTIVATION_ERROR };
  if (input.newPassword !== input.confirmPassword) return { ok: false, error: "كلمتا السر غير متطابقتين" };
  const policyError = passwordError(input.newPassword);
  if (policyError) return { ok: false, error: policyError };
  if (input.temporaryPassword === input.newPassword) {
    return { ok: false, error: "يجب أن تختلف كلمة السر الجديدة عن المؤقتة" };
  }

  const user = await deps.findCandidate(username);
  const now = (deps.now ?? (() => new Date()))();
  if (!user || !user.isActive || !user.needsActivation || (user.lockedUntil && user.lockedUntil > now)) {
    await deps.logAttempt({ userId: user?.id, username, success: false, reason: "فشل التحقق من بيانات التفعيل" });
    return { ok: false, error: GENERIC_ACTIVATION_ERROR };
  }

  const temporaryPasswordMatches = await deps.comparePassword(input.temporaryPassword, user.passwordHash);
  if (!temporaryPasswordMatches) {
    const shouldLock = user.failedLoginCount + 1 >= LOGIN_MAX_ATTEMPTS;
    const lockUntil = shouldLock ? new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000) : null;
    await deps.recordFailedProof(user, lockUntil);
    await deps.logAttempt({ userId: user.id, username, success: false, reason: "فشل التحقق من بيانات التفعيل" });
    return { ok: false, error: GENERIC_ACTIVATION_ERROR };
  }

  const passwordHash = await deps.hashPassword(input.newPassword);
  const updated = await deps.activate(user, passwordHash);
  if (updated !== 1) {
    await deps.logAttempt({ userId: user.id, username, success: false, reason: "تعارض في تفعيل الحساب" });
    return { ok: false, error: GENERIC_ACTIVATION_ERROR };
  }

  await deps.logAttempt({ userId: user.id, username, success: true, reason: "تم تفعيل الحساب" });
  return { ok: true };
}
