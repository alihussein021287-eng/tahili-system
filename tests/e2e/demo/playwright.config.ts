// Full demo check against the LOCAL working copy only (http://localhost:3001).
// Run: npx playwright test -c tests/e2e/demo/playwright.config.ts
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Paths are taken from where the command runs (the project root), not from this folder.
const results = path.resolve(process.env.DEMO_RESULTS || "test-results/demo");

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.demo\.ts$/,
  globalSetup: "./global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  outputDir: `${results}/artifacts`,
  reporter: [["list"], ["json", { outputFile: `${results}/${process.env.DEMO_JSON || "results.json"}` }]],
  use: {
    baseURL: "http://localhost:3001",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.DEMO_CHROMIUM ? { executablePath: process.env.DEMO_CHROMIUM } : {},
  },
});
