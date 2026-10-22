import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode, getToken } from "next-auth/jwt";
import { downstreamCookieHeaderForLocalSession, serializedCookieHeader, SECURE_SESSION_COOKIE } from "@/lib/environment-access";
import { proxy } from "@/proxy";

vi.mock("@/lib/observability", () => ({ logEvent: vi.fn(), normalizeRoute: (route: string) => route }));
const secret = "synthetic-cookie-regression-secret-not-a-real-credential";
const name = "next-auth.session-token-38091-local";
const origin = "http://localhost:38091";
function environment() {
  for (const [key, value] of Object.entries({ TAHILI_LOCAL_ACCESS: "true", TAHILI_LOCAL_PORT: "38091", NEXTAUTH_URL: origin, NEXTAUTH_URL_INTERNAL: origin, NEXTAUTH_ALLOW_HTTP_LOGIN: "true", AUTH_TRUST_HOST: "true", NEXTAUTH_SECRET: secret, TAHILI_LAN_IP: "" })) vi.stubEnv(key, value);
}
function request(cookie: string, host = "localhost:38091") {
  return new NextRequest(`${origin}/patients`, { headers: { host, cookie } });
}
afterEach(() => vi.unstubAllEnvs());

describe("cookie header boundary", () => {
  it("preserves raw ASCII, percent escapes, quotes, equals and multiple cookies without double encoding", () => {
    const raw = 'plain=rtl; escaped=%2525%25%2f; padded=abc==; quoted="ok"; unicode=%E7%9A%84';
    expect(downstreamCookieHeaderForLocalSession(raw, name)).toBe(raw);
    expect(() => new Headers({ cookie: downstreamCookieHeaderForLocalSession(raw, name) })).not.toThrow();
    const parsed = request(downstreamCookieHeaderForLocalSession(raw, name)).cookies;
    expect(parsed.get("unicode")?.value).toBe("的");
    expect(parsed.get("escaped")?.value).toBe("%25%/");
  });
  it("safely encodes decoded Unicode, delimiters and CRLF as values, never new cookies or headers", () => {
    const value = "عربي; forged=yes\r\nX-Injected: yes%";
    const header = serializedCookieHeader([{ name: "preference", value }, { name: "other", value: "ascii" }]);
    expect(() => new Headers({ cookie: header })).not.toThrow();
    const parsed = request(header).cookies;
    expect(parsed.get("preference")?.value).toBe(value);
    expect(parsed.get("forged")).toBeUndefined();
    expect(parsed.getAll()).toHaveLength(2);
  });
  it.each(["bad\r\nInjected", "bad;name", "bad=name", "bad name", "عربي"])("rejects invalid decoded cookie names", (invalid) => {
    expect(() => serializedCookieHeader([{ name: invalid, value: "synthetic" }])).toThrow(TypeError);
  });
  it.each(["a=1\r\nX-Injected: yes", "a=1\0", "a=1\n"])("rejects raw header injection", (raw) => {
    expect(() => downstreamCookieHeaderForLocalSession(raw, name)).toThrow(TypeError);
  });
  it("skips malformed URI values safely and keeps the last valid duplicate, matching NextRequest", () => {
    const raw = "good=one; bad=%E0%A4%A; good=two; good=%ZZ; bad2=%; tail=ok";
    const expected = request(raw).cookies.get("good")?.value;
    const forwarded = downstreamCookieHeaderForLocalSession(raw, name);
    expect(request(forwarded).cookies.get("good")?.value).toBe(expected);
    expect(forwarded).toBe("good=two; tail=ok");
    expect(downstreamCookieHeaderForLocalSession(null, name)).toBe("");
  });
  it("rejects unrepresentable selected values instead of silently dropping them", () => {
    expect(() => downstreamCookieHeaderForLocalSession("control=\u0001; tail=ok", name)).toThrow(TypeError);
  });
  it("removes forged canonical aliases and aliases only this port's exact numeric session chunks", () => {
    const raw = `${SECURE_SESSION_COOKIE}=forged; ${SECURE_SESSION_COOKIE}.0=forged; next-auth.session-token-3809-local=other; ${name}-extra=other; ${name}.bad=other; ${name}.0=one%2E; ${name}.1=two`;
    const forwarded = downstreamCookieHeaderForLocalSession(raw, name);
    expect(forwarded).not.toContain("forged");
    expect(forwarded).toContain(`${SECURE_SESSION_COOKIE}.0=one%2E`);
    expect(forwarded).toContain(`${SECURE_SESSION_COOKIE}.1=two`);
    expect(request(forwarded).cookies.get(SECURE_SESSION_COOKIE)).toBeUndefined();
    expect(forwarded).not.toContain(`${SECURE_SESSION_COOKIE}.bad`);
  });
});

describe("middleware Unicode regression with synthetic JWTs only", () => {
  it("reproduces the original decoded-header failure and preserves a valid authenticated session", async () => {
    environment();
    const token = await encode({ secret, token: { uid: "synthetic-viewer", role: "VIEWER", authVersion: 1 } });
    const incoming = request(`${name}=${token}; preference=%E7%9A%84; arabic=%D8%B9%D8%B1%D8%A8%D9%8A; literal=%2525; malformed=%ZZ`);
    const original = incoming.cookies.getAll().map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    expect(() => new Headers().set("cookie", original)).toThrow(TypeError);
    const response = await proxy(incoming);
    expect(response.status).toBe(200);
    expect(response.headers.has("set-cookie")).toBe(false);
    const forwarded = response.headers.get("x-middleware-request-cookie")!;
    expect(forwarded).toContain("preference=%E7%9A%84");
    expect(forwarded).toContain("literal=%2525");
    const downstream = request(forwarded);
    expect(downstream.cookies.get("preference")?.value).toBe("的");
    expect(await getToken({ req: downstream, secret, cookieName: SECURE_SESSION_COOKIE })).toMatchObject({ uid: "synthetic-viewer", role: "VIEWER", authVersion: 1 });
  });
  it("keeps duplicate session selection aligned with the token actually validated upstream", async () => {
    environment();
    const first = await encode({ secret, token: { uid: "synthetic-first" } });
    const last = await encode({ secret, token: { uid: "synthetic-last" } });
    const incoming = request(`${name}=${first}; ${name}=${last}; ${name}=%ZZ; preference=%E7%9A%84`);
    expect(await getToken({ req: incoming, secret, cookieName: name })).toMatchObject({ uid: "synthetic-last" });
    const response = await proxy(incoming);
    expect(response.status).toBe(200);
    expect(await getToken({ req: request(response.headers.get("x-middleware-request-cookie")!), secret, cookieName: SECURE_SESSION_COOKIE })).toMatchObject({ uid: "synthetic-last" });
  });
  it.each(["", `${name}=invalid`, `${SECURE_SESSION_COOKIE}=forged`, "next-auth.session-token-3809-local=foreign"])("still redirects missing, invalid and foreign sessions", async (cookie) => {
    environment();
    const response = await proxy(request(`${cookie}; preference=%E7%9A%84`));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });
  it("still rejects an unrecognized host", async () => {
    environment();
    expect((await proxy(request("preference=%E7%9A%84", "foreign.invalid"))).status).toBe(421);
  });
});
