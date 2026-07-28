import { describe, expect, it } from "vitest";
import { normalizeRoute, redact, requestId } from "@/lib/observability";
describe("observability privacy", () => {
  it("normalizes patient routes", () => expect(normalizeRoute("/patients/abc?phone=1")).toBe("/patients/:id?phone=1"));
  it("redacts sensitive fields", () => expect(redact({ password: "x", cookie: "x", phone: "x", safe: "ok" })).toEqual({ password: "[REDACTED]", cookie: "[REDACTED]", phone: "[REDACTED]", safe: "ok" }));
  it("generates or accepts UUID request IDs", () => { const id = requestId(); expect(id).toMatch(/^[a-f0-9-]{36}$/i); expect(requestId(id)).toBe(id); });
});
