import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { LOGIN_MAX_ATTEMPTS, LOGIN_LOCK_MINUTES } from "./security";
import { getAdminConfig } from "./admin-config";
import { type EnvironmentAccess, safeAuthRedirect } from "./environment-access";

export function applyUserClaims(token: Record<string, unknown>, user?: Record<string, unknown>) {
  if (!user) return token;
  return {
    ...token,
    role: user.role,
    uid: user.id,
    authVersion: user.authVersion,
  };
}

function isDynamicSessionExpired(token: Record<string, unknown>) {
  const startedAt = typeof token.sessionStartedAt === "number" ? token.sessionStartedAt : 0;
  const maxAgeSeconds = typeof token.sessionMaxAgeSeconds === "number" ? token.sessionMaxAgeSeconds : 0;
  return Boolean(startedAt && maxAgeSeconds && Date.now() > startedAt + maxAgeSeconds * 1000);
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
  // Server Components read the canonical secure name. LAN requests receive a
  // request-only alias from proxy.ts; browsers never receive the secure alias.
  useSecureCookies: true,
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
      if (user) {
        const security = await getAdminConfig();
        const maxAgeSeconds = Math.max(15, Math.min(10080, security.sessionMinutes || 480)) * 60;
        return {
          ...applyUserClaims(token, user as any),
          sessionStartedAt: Date.now(),
          sessionMaxAgeSeconds: maxAgeSeconds,
        } as any;
      }
      if (isDynamicSessionExpired(token as Record<string, unknown>)) {
        return { sessionExpired: true } as any;
      }
      return token as any;
    },
    async session({ session, token }) {
      if ((token as any).sessionExpired) {
        return { ...session, user: undefined as any };
      }
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.uid;
        (session.user as any).authVersion = token.authVersion;
      }
      return session;
    },
  },
};

export function authOptionsForAccess(access: EnvironmentAccess): NextAuthOptions {
  return {
    ...authOptions,
    useSecureCookies: access.secure,
    callbacks: {
      ...authOptions.callbacks,
      redirect: ({ url }) => safeAuthRedirect(url, access.origin),
    },
  };
}
