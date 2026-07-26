import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("login loading state", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/login/LoginForm.tsx"), "utf8");

  it("always releases loading after username, login, and activation requests", () => {
    expect(source.match(/finally\s*\{\s*setLoading\(false\);\s*\}/g)).toHaveLength(3);
    expect(source).toContain('setError("تعذّر تسجيل الدخول. حاول مرة أخرى.")');
    expect(source).toContain('setError("كلمة السر غير صحيحة")');
  });

  it("preserves the login form and callback contract", () => {
    expect(source).toContain("onSubmit={handleSubmit}");
    expect(source).toContain('name="username"');
    expect(source).toContain('name="password"');
    expect(source).toContain('name="temporaryPassword"');
    expect(source).toContain('name="newPassword"');
    expect(source).toContain('name="confirmPassword"');
    expect(source).toContain('autoComplete="username"');
    expect(source).toContain('autoComplete="current-password"');
    expect(source).toContain('autoComplete="new-password"');
    expect(source.match(/callbackUrl/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain("router.push(callbackUrl)");
  });
});
