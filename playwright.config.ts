import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    // شغّل التطبيق محلياً (npm run dev أو docker compose) قبل الاختبار،
    // أو غيّر هذا للسيرفر التجريبي عندك (مو الإنتاج مباشرة!)
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
