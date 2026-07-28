import fs from "node:fs";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
  resolveEnvironmentAccess: vi.fn(() => ({ origin: "http://192.168.17.20:3000" })),
}));

vi.mock("@/lib/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability")>()),
  logEvent: mocks.logEvent,
}));
vi.mock("@/lib/environment-access", () => ({ resolveEnvironmentAccess: mocks.resolveEnvironmentAccess }));

type Post = (request: NextRequest) => Promise<Response>;
let post: Post;

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    errorId: crypto.randomUUID(),
    route: "/patients/synthetic-record?ignored=value",
    errorCode: "CLIENT_RENDER_ERROR",
    fingerprint: "boundary-test",
    ...overrides,
  };
}

function request(payload: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://192.168.17.20:3000/api/observability/client-error", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://192.168.17.20:3000", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

beforeEach(async () => {
  vi.resetModules();
  mocks.logEvent.mockReset();
  mocks.resolveEnvironmentAccess.mockReturnValue({ origin: "http://192.168.17.20:3000" });
  ({ POST: post } = await import("@/app/api/observability/client-error/route"));
});

describe.sequential("client error report endpoint", () => {
  it("accepts only a valid allowlisted report and returns no-store", async () => {
    const response = await post(request(validPayload()));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.logEvent).toHaveBeenCalledTimes(1);
  });

  it("always replaces spoofed request identifiers with a fresh report identifier", async () => {
    const spoofed = crypto.randomUUID();
    const errorId = crypto.randomUUID();
    const first = await post(request(validPayload({ errorId }), {
      "x-request-id": spoofed,
      "x-tahili-request-id": spoofed,
      "x-tahili-request-id-source": "proxy",
    }));
    const second = await post(request(validPayload({ errorId: crypto.randomUUID() }), {
      "x-request-id": spoofed,
      "x-tahili-request-id": spoofed,
      "x-tahili-request-id-source": "proxy",
    }));
    expect([first.status, second.status]).toEqual([204, 204]);
    const [one, two] = mocks.logEvent.mock.calls.map(([event]) => event);
    expect(one).toMatchObject({ errorId, eventType: "client_error_report" });
    expect(one.reportRequestId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(one.reportRequestId).not.toBe(spoofed);
    expect(two.reportRequestId).not.toBe(one.reportRequestId);
    expect(one).not.toHaveProperty("requestId");
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain(spoofed);
  });

  it("rejects content-type, origin, schema, extra-field, and oversized reports", async () => {
    const invalidContentType = new NextRequest("http://192.168.17.20:3000/api/observability/client-error", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect((await post(invalidContentType)).status).toBe(415);
    expect((await post(request(validPayload(), { origin: "http://untrusted.invalid" }))).status).toBe(403);
    const invalidId = await post(request(validPayload({ errorId: "not-a-uuid" })));
    const invalidCode = await post(request(validPayload({ errorCode: "UNSAFE" })));
    const extraField = await post(request(validPayload({ unexpected: "discard" })));
    const oversized = await post(request("x".repeat(1025)));
    expect(invalidId.status).toBe(400);
    expect(invalidCode.status).toBe(400);
    expect(extraField.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("never logs rejected sensitive fields", async () => {
    const secrets = "password cookie authorization phone patientName medicalNote stack message query";
    const response = await post(request(validPayload({ password: secrets, cookie: secrets, authorization: secrets, phone: secrets, patientName: secrets, medicalNote: secrets, stack: secrets, message: secrets, query: secrets })));
    expect(response.status).toBe(400);
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain(secrets);
  });

  it("normalizes the route and has no database dependency", async () => {
    const response = await post(request(validPayload({ route: "/patients/synthetic-record?phone=synthetic" })));
    expect(response.status).toBe(204);
    expect(mocks.logEvent.mock.calls[0][0].route).toBe("/patients/:id");
    const source = fs.readFileSync("src/app/api/observability/client-error/route.ts", "utf8");
    expect(source).not.toMatch(/prisma|database|sql/i);
  });

  it("rate limits locally without trusting client network headers", async () => {
    for (let index = 0; index < 30; index += 1) {
      const response = await post(request(validPayload(), { "x-forwarded-for": `forged-${index}` }));
      expect(response.status).toBe(204);
    }
    const limited = await post(request(validPayload(), { "x-forwarded-for": "another-forgery" }));
    expect(limited.status).toBe(429);
  });

  it("has no GET handler and the boundary reports once without raw error details", () => {
    expect("GET" in ({ POST: post })).toBe(false);
    const source = fs.readFileSync("src/app/error.tsx", "utf8");
    expect(source).toContain("if (sent.current) return");
    expect(source).toContain("sent.current = true");
    expect(source).toContain("CLIENT_RENDER_ERROR");
    expect(source).not.toMatch(/error\.message|error\.stack|document\.body|formData/i);
  });
});
