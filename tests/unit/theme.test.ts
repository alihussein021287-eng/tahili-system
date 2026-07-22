import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "../../src/lib/theme";

describe("theme preference", () => {
  it("supports light, dark, and system only", () => {
    expect(["light", "dark", "system"].every(isThemePreference)).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
  });

  it("resolves system from the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("initializes before hydration from the persistent key", () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_INIT_SCRIPT).toContain("classList.toggle('dark'");
  });
});
