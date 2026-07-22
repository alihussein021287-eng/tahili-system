import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("login loading state", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/login/page.tsx"), "utf8");

  it("always releases loading after username, login, and activation requests", () => {
    expect(source.match(/finally\s*\{\s*setLoading\(false\);\s*\}/g)).toHaveLength(3);
    expect(source).toContain('setError("تعذّر تسجيل الدخول. حاول مرة أخرى.")');
    expect(source).toContain('setError("كلمة السر غير صحيحة")');
  });
});
