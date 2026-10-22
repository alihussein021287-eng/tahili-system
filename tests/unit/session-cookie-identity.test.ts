import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode, getToken } from "next-auth/jwt";
import { getServerSession, type NextAuthOptions } from "next-auth";
import { proxy } from "@/proxy";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { SECURE_SESSION_COOKIE } from "@/lib/environment-access";

vi.mock("@/lib/observability", () => ({ logEvent: vi.fn(), normalizeRoute: (route: string) => route }));
const secret = "synthetic-identity-invariant-secret-not-real-credentials";
const name = "next-auth.session-token-38091-local";
const origin = "http://localhost:38091";
function environment() {
  for (const [key, value] of Object.entries({ TAHILI_LOCAL_ACCESS: "true", TAHILI_LOCAL_PORT: "38091", NEXTAUTH_URL: origin, NEXTAUTH_URL_INTERNAL: origin, NEXTAUTH_ALLOW_HTTP_LOGIN: "true", AUTH_TRUST_HOST: "true", NEXTAUTH_SECRET: secret, TAHILI_LAN_IP: "" })) vi.stubEnv(key, value);
}
const request = (cookie: string) => new NextRequest(`${origin}/patients`, { headers: { host: "localhost:38091", cookie } });
const tokenFor = (uid: string) => encode({ secret, token: { uid, role: "VIEWER", authVersion: 1, name: uid } });
afterEach(() => vi.unstubAllEnvs());

async function acceptedIdentity(incoming: NextRequest, cookieName = name) {
  const upstream = await getToken({ req: incoming, secret, cookieName });
  const response = await proxy(incoming);
  expect(response.status).toBe(200);
  expect(response.headers.has("set-cookie")).toBe(false);
  const downstream = request(response.headers.get("x-middleware-request-cookie")!);
  const verified = await getToken({ req: downstream, secret, cookieName: SECURE_SESSION_COOKIE });
  expect(verified?.uid).toBe(upstream?.uid);
  // Real NextAuth session handler. Same decoded cookie-object adaptation used by
  // getServerSession's RSC path; fake response captures no cookie/token output.
  const options: NextAuthOptions = {
    providers: [], secret, session: { strategy: "jwt" },
    cookies: { sessionToken: { name: SECURE_SESSION_COOKIE, options: { httpOnly: true, sameSite: "lax", path: "/", secure: false } } },
    callbacks: { session: async ({ session, token }) => ({ ...session, user: { ...session.user, name: String(token.uid) } }) },
    logger: { error: () => {}, warn: () => {}, debug: () => {} },
  };
  const socket = new Socket(); // Never connected; no HTTP listener or network request.
  const sessionRequest = Object.assign(new IncomingMessage(socket), {
    cookies: Object.fromEntries(downstream.cookies.getAll().map(c => [c.name, c.value])),
  });
  sessionRequest.headers = Object.fromEntries(downstream.headers);
  const sessionResponse = new ServerResponse(sessionRequest);
  try {
    const session = await getServerSession(sessionRequest, sessionResponse, options);
    expect(session?.user?.name).toBe(upstream?.uid);
  } finally { sessionResponse.destroy(); socket.destroy(); }
  return upstream?.uid;
}

describe("effective session identity invariant", () => {
  it("accepts a single valid session through real token and session handlers", async () => {
    environment();
    expect(await acceptedIdentity(request(`${name}=${await tokenFor("synthetic-single")}`))).toBe("synthetic-single");
  });
  it("selects the last valid duplicate through both authentication paths", async () => {
    environment();
    const first = await tokenFor("synthetic-first"), last = await tokenFor("synthetic-last");
    expect(await acceptedIdentity(request(`${name}=${first}; ${name}=${last}`))).toBe("synthetic-last");
  });
  it.each([" ", "\t", '"', "\\"])("rejects an unrepresentable last-selected duplicate (character %j)", async (suffix) => {
    environment();
    const first = await tokenFor("synthetic-first"), last = await tokenFor("synthetic-last");
    const incoming = request(`${name}=${first}; ${name}=${last}${suffix}; tail=ok`);
    // These values really do decrypt in installed NextAuth; the old filter instead
    // substituted synthetic-first. The response must never forward either identity.
    expect((await getToken({ req: incoming, secret, cookieName: name }))?.uid).toBe("synthetic-last");
    const response = await proxy(incoming);
    expect(response.status).toBe(400);
    expect(response.headers.has("x-middleware-request-cookie")).toBe(false);
  });
  it("does not fall back when the last selected JWT is invalid", async () => {
    environment();
    const incoming = request(`${name}=${await tokenFor("synthetic-first")}; ${name}=invalid; tail=ok`);
    expect(await getToken({ req: incoming, secret, cookieName: name })).toBeNull();
    expect((await proxy(incoming)).status).toBe(307);
  });
  it("matches NextRequest's skipped malformed URI duplicate without inventing a fallback policy", async () => {
    environment();
    expect(await acceptedIdentity(request(`${name}=${await tokenFor("synthetic-valid")}; ${name}=%ZZ; preference=%E0%A4%A`))).toBe("synthetic-valid");
  });
  it("preserves percent-encoded Unicode and delimiters without ByteString or boundary corruption", async () => {
    environment();
    const incoming = request(`${name}=${await tokenFor("synthetic-unicode")}; preference=%E7%9A%84; boundary=%3B%20forged%3Dyes%0D%0AX%3Ayes; percent=%2525`);
    expect(() => new Headers({ cookie: incoming.cookies.getAll().map(c => `${c.name}=${c.value}`).join("; ") })).toThrow(TypeError);
    expect(await acceptedIdentity(incoming)).toBe("synthetic-unicode");
  });
  it("preserves duplicate/chunk selection and numeric ordering", async () => {
    environment();
    const token = await tokenFor("synthetic-chunked"), midpoint = Math.floor(token.length / 2);
    const incoming = request(`${name}.1=invalid; ${name}.0=${token.slice(0, midpoint)}; ${name}.1=${token.slice(midpoint)}; ${SECURE_SESSION_COOKIE}.0=forged`);
    expect(await acceptedIdentity(incoming)).toBe("synthetic-chunked");
  });
  it("rejects a valid upstream prefix combination that exact downstream aliases cannot represent", async () => {
    environment();
    const token = await tokenFor("synthetic-prefix"), midpoint = Math.floor(token.length / 2);
    const incoming = request(`${name}.0=${token.slice(0, midpoint)}; ${name}.bad=${token.slice(midpoint)}`);
    expect((await getToken({ req: incoming, secret, cookieName: name }))?.uid).toBe("synthetic-prefix");
    expect((await proxy(incoming)).status).toBe(400);
  });
  it("rejects Bearer-only authentication that cannot establish a downstream cookie session", async () => {
    environment();
    const incoming = request("preference=rtl"); incoming.headers.set("authorization", `Bearer ${await tokenFor("synthetic-bearer")}`);
    expect((await getToken({ req: incoming, secret, cookieName: name }))?.uid).toBe("synthetic-bearer");
    expect((await proxy(incoming)).status).toBe(400);
  });
  it("also preserves identity on the unchanged secure canonical-cookie path", async () => {
    environment();
    vi.stubEnv("TAHILI_LOCAL_ACCESS", "false");
    vi.stubEnv("NEXTAUTH_URL", "https://tahili.elaqat.site");
    vi.stubEnv("NEXTAUTH_URL_INTERNAL", "http://192.168.17.20:3000");
    const token = await tokenFor("synthetic-secure");
    const incoming = new NextRequest("https://tahili.elaqat.site/patients", { headers: { host: "tahili.elaqat.site", "x-forwarded-proto": "https", cookie: `${SECURE_SESSION_COOKIE}=${token}` } });
    expect(await acceptedIdentity(incoming, SECURE_SESSION_COOKIE)).toBe("synthetic-secure");
  });
  it("does not accept a Bearer-only token as a secure cookie session either", async () => {
    environment();
    vi.stubEnv("TAHILI_LOCAL_ACCESS", "false");
    vi.stubEnv("NEXTAUTH_URL", "https://tahili.elaqat.site");
    vi.stubEnv("NEXTAUTH_URL_INTERNAL", "http://192.168.17.20:3000");
    const incoming = new NextRequest("https://tahili.elaqat.site/patients", { headers: { host: "tahili.elaqat.site", "x-forwarded-proto": "https", authorization: `Bearer ${await tokenFor("synthetic-secure-bearer")}` } });
    expect((await proxy(incoming)).status).toBe(400);
  });
  it.each(["", `${name}=invalid`, `${SECURE_SESSION_COOKIE}=forged`, "next-auth.session-token-3809-local=foreign"])("still rejects absent, invalid and isolated authentication", async (cookie) => {
    environment();
    expect((await proxy(request(cookie))).status).toBe(307);
  });
});
