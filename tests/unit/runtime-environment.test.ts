import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "@/lib/observability";
import { tahiliRuntimeEnvironment } from "@/lib/runtime-environment";

describe("Tahili runtime environment", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts only the closed development and production policy", () => {
    expect(tahiliRuntimeEnvironment({ TAHILI_ENVIRONMENT: "development" })).toBe("development");
    expect(tahiliRuntimeEnvironment({ TAHILI_ENVIRONMENT: "production" })).toBe("production");
  });

  it("defaults missing or invalid values safely to development", () => {
    expect(tahiliRuntimeEnvironment({})).toBe("development");
    expect(tahiliRuntimeEnvironment({ TAHILI_ENVIRONMENT: "staging" })).toBe("development");
    expect(tahiliRuntimeEnvironment({ TAHILI_ENVIRONMENT: "PRODUCTION" })).toBe("development");
  });

  it("uses the server runtime policy for structured logs", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logEvent({ level: "info", environment: "untrusted", service: "untrusted" }, { TAHILI_ENVIRONMENT: "production" });
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      environment: "production",
      service: "tahili-app",
      level: "info",
    });
  });

  it("keeps runtime environment selection out of the Faro client source", () => {
    const source = readFileSync("src/components/FaroInitializer.tsx", "utf8");
    expect(source).not.toContain("TAHILI_ENVIRONMENT");
    expect(source).not.toContain("NODE_ENV");
    expect(source).not.toContain("runtime-environment");
    expect(source).not.toMatch(/\benvironment\s*:/);
  });
});
