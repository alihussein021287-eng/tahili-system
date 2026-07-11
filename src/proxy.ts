import authMiddleware from "next-auth/middleware";

export function proxy(...args: Parameters<typeof authMiddleware>) {
  return authMiddleware(...args);
}

export const config = {
  // حماية كل الصفحات ما عدا: الدخول، بوابة المريض، auth، راوت التذكيرات (محمي بمفتاح)،
  // وملفات الـ PWA الثابتة (manifest/sw/الأيقونات) حتى يعمل التثبيت والعمل دون اتصال قبل الدخول
  matcher: [
    "/((?!setup|login|portal|api/auth|api/reminders|_next|favicon.ico|manifest.json|sw.js|icon-192.png|icon-512.png).*)",
  ],
};
