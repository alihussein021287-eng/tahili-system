import { describe, it, expect } from "vitest";
import { userCreateSchema, parseOrThrow } from "@/lib/validate";

describe("userCreateSchema", () => {
  it("يقبل بيانات مستخدم صحيحة", () => {
    const data = parseOrThrow(userCreateSchema, {
      username: "ali.h",
      fullName: "علي حسين",
      role: "DOCTOR",
      email: "ali@example.com",
    });
    expect(data.username).toBe("ali.h");
  });

  it("يرفض اسم مستخدم فيه فراغ أو حروف عربية", () => {
    expect(() =>
      parseOrThrow(userCreateSchema, { username: "علي حسين", fullName: "علي" })
    ).toThrow();
  });

  it("يرفض اسم مستخدم أقل من 3 أحرف", () => {
    expect(() => parseOrThrow(userCreateSchema, { username: "al", fullName: "علي" })).toThrow();
  });

  it("يرفض بريد إلكتروني غير صحيح", () => {
    expect(() =>
      parseOrThrow(userCreateSchema, { username: "ali123", fullName: "علي", email: "not-an-email" })
    ).toThrow();
  });

  it("يقبل بريد فارغ (اختياري)", () => {
    const data = parseOrThrow(userCreateSchema, { username: "ali123", fullName: "علي", email: "" });
    expect(data.email).toBe("");
  });
});
