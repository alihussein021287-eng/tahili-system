import "dotenv/config";
import { defineConfig } from "@playwright/test";
import path from "node:path";
import { BASE_URL, ROOT } from "./helpers";


export default defineConfig({
  testDir: ".",
  testMatch: /(acceptance-.*|resilient-probes)\.spec\.ts/,
  globalSetup: "./auth.setup.ts",
  workers: 1,
  // A crashed headless browser (OS/GPU level) is the only reason to allow a bounded retry; default is none.
  retries: Number(process.env.ACCEPTANCE_RETRIES || 0),
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(ROOT, "artifacts"),
  reporter: [["list"], ["json", { outputFile: path.join(ROOT, "acceptance-results.json") }]],
  use: {
    baseURL: BASE_URL,
    launchOptions: { args: ["--disable-gpu", "--disable-software-rasterizer", "--mute-audio"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
