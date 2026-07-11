import { afterEach, describe, expect, it } from "vitest";
import { assertInitialSetupAllowed, isInitialSetupAllowed } from "@/lib/setup-security";

const previous = process.env.ALLOW_INITIAL_SETUP;

afterEach(() => {
  if (previous === undefined) delete process.env.ALLOW_INITIAL_SETUP;
  else process.env.ALLOW_INITIAL_SETUP = previous;
});

describe("initial setup flag", () => {
  it("is closed when missing", () => {
    delete process.env.ALLOW_INITIAL_SETUP;
    expect(isInitialSetupAllowed()).toBe(false);
  });

  it("is closed for false and other values", () => {
    for (const value of ["false", "TRUE", "1", ""]) {
      process.env.ALLOW_INITIAL_SETUP = value;
      expect(isInitialSetupAllowed()).toBe(false);
    }
  });

  it("opens only for exact lowercase true", () => {
    process.env.ALLOW_INITIAL_SETUP = "true";
    expect(isInitialSetupAllowed()).toBe(true);
  });

  it("rejects direct guarded execution while closed", () => {
    process.env.ALLOW_INITIAL_SETUP = "false";
    expect(() => assertInitialSetupAllowed()).toThrow("التهيئة غير متاحة");
  });
});
