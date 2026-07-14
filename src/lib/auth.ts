import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { LOGIN_MAX_ATTEMPTS, LOGIN_LOCK_MINUTES } from "./security";
import { getAdminConfig } from "./admin-config";

export function applyUserClaims(token: Record<string, unknown>, user?: Record<string, unknown>) {
  if (!user) return token;
  return {
    ...token,
    role: user.role,
    uid: user.id,
    authVersion: user.authVersion,
  };
}

export function loginLogWriteFailure(error: unknown) {
  const candidate = error as { code?: unknown; name?: unknown; constructor?: { name?: string } } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : undefined;
  const type =
    typeof candidate?.name === "string"
      ? candidate.name
      : typeof candidate?.constructor?.name === "string"
        ? candidate.constructor.name
        : "UnknownError";
  return { type, code };
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  useSecureCookies: process.env.NEXTAUTH_ALLOW_HTTP_LOGIN === "true" ? false : undefined,
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "اسم المستخدم", type: "text" },
        password: { label: "كلمة السر", type: "password" },
      },
      async authorize(credentials, req) {
        const hdr: any = (req as any)?.headers ?? {};
        const ip = (hdr["x-forwarded-for"]?.split(",")[0] || hdr["x-real-ip"] || "").trim() || null;
        const userAgent = hdr["user-agent"] || null;
        const logLogin = async (d: { userId?: string | null; username: string; name?: string | null; success: boolean; reason?: string }) => {
          try {
            await prisma.loginLog.create({ data: { ...d, ip, userAgent } });
          } catch (error) {
            console.error("[auth] loginLog write failed", loginLogWriteFailure(error));
          }
        };
        if (!credentials?.username || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { username: credentials.username },
        });
        if (!user || !user.isActive) { await logLogin({ username: credentials.username, success: false, reason: !user ? "مستخدم غير موجود" : "حساب معطّل" }); return null; }
        // الحساب مقفول مؤقتاً بسبب محاولات فاشلة متكررة
        if (user.needsActivation) { await logLogin({ userId: user.id, username: user.username, name: user.fullName, success: false, reason: "يتطلب تفعيل" }); return null; }
        if (user.lockedUntil && user.lockedUntil > new Date()) { await logLogin({ userId: user.id, username: user.username, name: user.fullName, success: false, reason: "الحساب مقفول مؤقتاً" }); return null; }
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) {
          const security = await getAdminConfig();
          const count = (user.failedLoginCount ?? 0) + 1;
          const lock = count >= (security.loginAttempts || LOGIN_MAX_ATTEMPTS);
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: lock ? 0 : count,
              lockedUntil: lock ? new Date(Date.now() + (security.lockMinutes || LOGIN_LOCK_MINUTES) * 60 * 1000) : user.lockedUntil ?? null,
            },
          });
          await logLogin({ userId: user.id, username: user.username, name: user.fullName, success: false, reason: "كلمة سر خاطئة" });
          return null;
        }
        // نجاح: صفّر العدّاد وأزل القفل وسجّل آخر دخول
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        });
        await logLogin({ userId: user.id, username: user.username, name: user.fullName, success: true });
        return { id: user.id, name: user.fullName, role: user.role, authVersion: user.authVersion } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      return applyUserClaims(token, user as any) as any;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.uid;
        (session.user as any).authVersion = token.authVersion;
      }
      return session;
    },
  },
};
