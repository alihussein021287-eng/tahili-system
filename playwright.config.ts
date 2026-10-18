import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Never write into test-results/ (Playwright wipes it); keep evidence directories separate.
  outputDir: "./release-evidence/playwright-output",
  testIgnore: ["**/acceptance/**", "**/demo/**"],
  timeout: 30_000,
  retries: 0,
  use: {
    // شغّل التطبيق محلياً (npm run dev أو docker compose) قبل الاختبار،
    // أو غيّر هذا للسيرفر التجريبي عندك (مو الإنتاج مباشرة!)
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3101",
    trace: "retain-on-failure",
  },
});
