import { describe, it, expect } from "vitest";
import { refCode } from "@/lib/refcode";

describe("refCode", () => {
  it("يبني الرقم المرجعي بصيغة TH-السنة-الرقم مع أصفار بادئة", () => {
    expect(refCode({ fileNumber: 42, createdAt: "2026-03-01" })).toBe("TH-2026-00042");
  });

  it("يستخدم السنة الحالية لو ما فيه createdAt", () => {
    const year = new Date().getFullYear();
    expect(refCode({ fileNumber: 7 })).toBe(`TH-${year}-00007`);
  });

  it("يتعامل مع fileNumber مفقود كصفر", () => {
    expect(refCode({ createdAt: "2025-01-01" })).toBe("TH-2025-00000");
  });

  it("لا يقص الرقم إذا تجاوز 5 خانات", () => {
    expect(refCode({ fileNumber: 123456, createdAt: "2026-01-01" })).toBe("TH-2026-123456");
  });
});
