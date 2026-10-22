import { defineConfig } from "@playwright/test";
import legacyConfig from "./playwright.config";

// Share fail-closed target validation, but never include legacy suites in the nine-case runner.
export default defineConfig({
  ...legacyConfig,
  testMatch: "critical-registration.spec.ts",
});
