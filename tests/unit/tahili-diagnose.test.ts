import { describe, expect, it } from "vitest";

const diagnose = await import("../../scripts/tahili-diagnose.mjs");

describe("tahili diagnose contracts", () => {
  it("bounds flags and rejects injection-shaped input", () => {
    expect(diagnose.parseSince("24h")).toBe(86_400);
    expect(diagnose.parseSince("25h")).toBeNull();
    expect(diagnose.parseOptions(["status", "--limit", "21"]).error).toContain("limit");
    expect(diagnose.parseOptions(["service", "app;id"]).positional).toEqual(["service", "app;id"]);
    expect(diagnose.parseOptions(["status", "--url", "http://example.invalid"]).error).toBe("unsupported option");
    expect(diagnose.parseOptions(["status", "--timeout", "10001"]).error).toContain("timeout");
  });

  it("allows only bounded, sanitized structured fields", () => {
    const safe = diagnose.sanitizeLog({ timestamp: "2026-07-29T00:00:00Z", service: "tahili-app", route: "/patients/123", level: "error", requestId: "never-export", traceId: "never-export", patientName: "forbidden", message: "forbidden", headers: "forbidden", query: "forbidden" });
    expect(safe).toEqual({ timestamp: "2026-07-29T00:00:00.000Z", service: "tahili-app", route: "/patients/:id", level: "error" });
    expect(JSON.stringify(safe)).not.toMatch(/forbidden|requestId|traceId/);
  });

  it("uses stable non-zero exit codes for invalid IDs", async () => {
    const result = await diagnose.run(["request", "$(id)", "--json"]);
    expect(result.exit).toBe(diagnose.EXIT.INVALID_INPUT);
    expect(result.body).toEqual({ error: "invalid request ID" });
    const service = await diagnose.run(["service", "app;id", "--json"]);
    expect(service.exit).toBe(diagnose.EXIT.INVALID_INPUT);
    const extra = await diagnose.run(["status", "unexpected"]);
    expect(extra.exit).toBe(diagnose.EXIT.INVALID_INPUT);
  });

  it("caps displayed metadata and never forwards correlation IDs", () => {
    const output = diagnose.sanitizeLog({ timestamp: "2026-07-29T00:00:00Z", service: "x".repeat(500), route: "/login", level: "info", traceId: "a".repeat(32), requestId: "b".repeat(36) });
    expect(JSON.stringify(output).length).toBeLessThan(260);
    expect(output).not.toHaveProperty("traceId");
    expect(output).not.toHaveProperty("requestId");
  });
});
