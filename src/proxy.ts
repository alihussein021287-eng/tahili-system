import authMiddleware from "next-auth/middleware";

const authProxy = authMiddleware({
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: {
      name: process.env.NEXTAUTH_ALLOW_HTTP_LOGIN === "true"
        ? "next-auth.session-token"
        : "__Secure-next-auth.session-token",
    },
  },
});

export function proxy(...args: Parameters<typeof authProxy>) {
  return authProxy(...args);
}

export const config = {
  // حماية كل الصفحات ما عدا: الدخول، شاشة العرض باعتمادها المحدود، بوابة المريض، auth، راوت التذكيرات (محمي بمفتاح)،
  // وملفات الـ PWA الثابتة (manifest/sw/الأيقونات) حتى يعمل التثبيت والعمل دون اتصال قبل الدخول
  matcher: [
    "/((?!setup|login|display(?:/|$)|portal|api/auth|api/display(?:/|$)|api/reminders|_next|favicon.ico|manifest.json|sw.js|icon-192.png|icon-512.png).*)",
  ],
};
