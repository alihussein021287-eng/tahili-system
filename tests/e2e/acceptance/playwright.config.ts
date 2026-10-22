import { defineConfig } from "@playwright/test";
import path from "node:path";
import { BASE_URL, ROOT } from "./helpers";


export default defineConfig({
  testDir: ".",
  // Preserve the original legacy discovery path; helpers still require disposable identity.
  testMatch: /(acceptance-.*|resilient-probes)\.spec\.ts/,
  globalSetup: "./auth.setup.ts",
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(ROOT, "artifacts"),
  reporter: [["list"], ["json", { outputFile: path.join(ROOT, "acceptance-results.json") }]],
  use: {
    baseURL: BASE_URL,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--disable-gpu", "--disable-software-rasterizer", "--mute-audio"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
});
