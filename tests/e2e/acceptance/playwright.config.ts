import "dotenv/config";
import { defineConfig } from "@playwright/test";

if (process.env.DATABASE_URL) process.env.DATABASE_URL = process.env.DATABASE_URL.replace("@postgres:", "@127.0.0.1:");

export default defineConfig({
  testDir: ".",
  testMatch: /(acceptance-.*|resilient-probes)\.spec\.ts/,
  globalSetup: "./auth.setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  outputDir: "/tahili-system/test-results/acceptance-20260713/artifacts",
  reporter: [["list"], ["json", { outputFile: "/tahili-system/test-results/acceptance-20260713/acceptance-results.json" }]],
  use: {
    baseURL: "http://localhost:3000",
    launchOptions: { args: ["--disable-gpu", "--disable-software-rasterizer", "--mute-audio"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
