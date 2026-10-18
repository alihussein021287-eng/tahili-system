import { readFileSync } from "node:fs";
import { encode, getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authOptionsForAccess } from "@/lib/auth";
import {
  downstreamCookiesForLocalSession,
  LOCAL_SESSION_COOKIE,
  resolveEnvironmentAccess,
  SECURE_SESSION_COOKIE,
  serializedCookieHeader,
} from "@/lib/environment-access";
import { proxy } from "@/proxy";

// Intentionally shared to reproduce a copied local configuration. No real users or secrets.
const sharedSecret = "fake-shared-local-test-secret-at-least-32-characters";
type Cookie = { name: string; value: string };

function localEnvironment(port: number) {
  return {
    TAHILI_LOCAL_ACCESS: "true",
    TAHILI_LOCAL_PORT: String(port),
    NEXTAUTH_URL: `http://localhost:${port}`,
    NEXTAUTH_URL_INTERNAL: `http://127.0.0.1:${port}`,
    NEXTAUTH_ALLOW_HTTP_LOGIN: "true",
    AUTH_TRUST_HOST: "true",
    NEXTAUTH_SECRET: sharedSecret,
  };
}

function accessFor(port: number, hostname = "localhost") {
  return resolveEnvironmentAccess(new Headers({ host: `${hostname}:${port}` }), localEnvironment(port))!;
}

function requestFor(port: number, cookies: Cookie[], hostname = "localhost") {
  return new NextRequest(`http://${hostname}:${port}/patients-care`, {
    headers: { host: `${hostname}:${port}`, cookie: serializedCookieHeader(cookies) },
  });
}

function useLocalEnvironment(port: number) {
  for (const [key, value] of Object.entries(localEnvironment(port))) vi.stubEnv(key, value);
  vi.stubEnv("TAHILI_LAN_IP", "");
}

function sessionCookies(name: string, token: string, chunked: boolean): Cookie[] {
  if (!chunked) return [{ name, value: token }];
  const midpoint = Math.floor(token.length / 2);
  // Reversed input verifies that NextAuth reconstructs chunks in numeric order.
  return [{ name: `${name}.1`, value: token.slice(midpoint) }, { name: `${name}.0`, value: token.slice(0, midpoint) }];
}

afterEach(() => vi.unstubAllEnvs());

describe("local copy session isolation", () => {
  it.each([3000, 3001])("issues a host-only session cookie scoped to port %i", (port) => {
    const access = accessFor(port);
    expect(access.sessionCookieName).toBe(`next-auth.session-token-${port}-local`);
    expect(authOptionsForAccess(access).cookies?.sessionToken).toEqual({
      name: access.sessionCookieName,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: false },
    });
  });

  describe.each(["localhost", "127.0.0.1"])("shared browser cookies on %s", (hostname) => {
    it.each([[3000, 3001], [3001, 3000], [3001, 30010], [30010, 3001]])("does not authenticate port %i using port %i's JWT, even with the same secret", async (port, otherPort) => {
      const source = accessFor(otherPort, hostname);
      const target = accessFor(port, hostname);
      const token = await encode({ secret: sharedSecret, token: { uid: "fake-other-copy-admin", role: "ADMIN", authVersion: 1 } });
      const cookieName = authOptionsForAccess(source).cookies?.sessionToken?.name ?? LOCAL_SESSION_COOKIE;
      const cookies = [{ name: cookieName, value: token }];

      expect(await getToken({ req: requestFor(otherPort, cookies, hostname), secret: sharedSecret, cookieName: source.sessionCookieName }))
        .toMatchObject({ uid: "fake-other-copy-admin" });
      expect(await getToken({ req: requestFor(port, cookies, hostname), secret: sharedSecret, cookieName: target.sessionCookieName })).toBeNull();

      useLocalEnvironment(port);
      const response = await proxy(requestFor(port, cookies, hostname));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    });
  });

  it.each([[3000, 3001, false], [3000, 3001, true], [3001, 30010, false], [3001, 30010, true]] as const)("preserves sessions on ports %i and %i and aliases only the current token (chunked=%s)", async (originalPort, devPort, chunked) => {
    const original = accessFor(originalPort);
    const dev = accessFor(devPort);
    const originalToken = await encode({ secret: sharedSecret, token: { uid: "fake-original-user", role: "VIEWER", authVersion: 1 } });
    const devToken = await encode({ secret: sharedSecret, token: { uid: "fake-dev-user", role: "ADMIN", authVersion: 1 } });
    const cookies = [
      ...sessionCookies(original.sessionCookieName, originalToken, chunked),
      ...sessionCookies(dev.sessionCookieName, devToken, chunked),
      ...sessionCookies(SECURE_SESSION_COOKIE, "untrusted-canonical-token", chunked),
      { name: LOCAL_SESSION_COOKIE, value: "untrusted-legacy-token" },
      { name: "preference", value: "rtl" },
    ];

    // Both directions, then back again: visiting one copy must not log out the other.
    for (const [port, uid] of [[originalPort, "fake-original-user"], [devPort, "fake-dev-user"], [originalPort, "fake-original-user"]] as const) {
      useLocalEnvironment(port);
      const response = await proxy(requestFor(port, cookies));
      expect(response.status).toBe(200);
      expect(response.headers.has("set-cookie")).toBe(false);
      const downstreamHeader = response.headers.get("x-middleware-request-cookie")!;
      expect(downstreamHeader).toContain("preference=rtl");
      expect(downstreamHeader).not.toContain("untrusted-canonical-token");
      const downstream = new NextRequest(`http://localhost:${port}/patients-care`, { headers: { cookie: downstreamHeader } });
      expect(await getToken({ req: downstream, secret: sharedSecret, cookieName: SECURE_SESSION_COOKIE })).toMatchObject({ uid });
    }
  });

  it.each(["missing", "legacy", "canonical"])("requires the current copy's cookie with %s session input", async (input) => {
    const token = await encode({ secret: sharedSecret, token: { uid: "fake-foreign-user", role: "ADMIN" } });
    const cookies = input === "missing" ? [] : [{ name: input === "legacy" ? LOCAL_SESSION_COOKIE : SECURE_SESSION_COOKIE, value: token }];
    useLocalEnvironment(3001);
    expect((await proxy(requestFor(3001, cookies))).status).toBe(307);
  });

  it("does not alias another port, legacy cookie, or a name that only starts with the current cookie name", () => {
    const current = accessFor(3001).sessionCookieName;
    const cookies = [
      { name: accessFor(3000).sessionCookieName, value: "other-copy" },
      { name: LOCAL_SESSION_COOKIE, value: "legacy" },
      { name: accessFor(30010).sessionCookieName, value: "different-port" },
      { name: `${current}-extra`, value: "extra" },
      { name: `${current}.bad`, value: "invalid-chunk" },
      { name: SECURE_SESSION_COOKIE, value: "forged-alias" },
      { name: `${SECURE_SESSION_COOKIE}.0`, value: "forged-alias-chunk" },
    ];
    expect(downstreamCookiesForLocalSession(cookies, current).filter(({ name }) => name.startsWith(SECURE_SESSION_COOKIE))).toEqual([]);
    expect(downstreamCookiesForLocalSession([...cookies, { name: `${current}.0`, value: "own-chunk" }], current)
      .filter(({ name }) => name.startsWith(SECURE_SESSION_COOKIE))).toEqual([{ name: `${SECURE_SESSION_COOKIE}.0`, value: "own-chunk" }]);
  });

  it("rejects a foreign JWT relabelled as the current cookie when copies use independent secrets", async () => {
    const token = await encode({ secret: "fake-original-secret-at-least-32-characters", token: { uid: "fake-foreign-admin", role: "ADMIN" } });
    const current = accessFor(3001).sessionCookieName;
    expect(await getToken({ req: requestFor(3001, [{ name: current, value: token }]), secret: "fake-dev-secret-at-least-32-characters", cookieName: current })).toBeNull();
  });

  it("provides separate secret assignments for the original and dev copies in the example and environment guide", () => {
    for (const path of [".env.local.example", "ENVIRONMENTS.md"]) {
      const content = readFileSync(path, "utf8");
      const secrets = [...content.matchAll(/^#?\s*NEXTAUTH_SECRET=([^\s]+)\s*$/gm)].map((match) => match[1]);
      expect(secrets).toHaveLength(2);
      expect(new Set(secrets).size).toBe(2);
      expect(content).toContain("tahili-original");
      expect(content).toContain("tahili-dev");
      expect(content).toMatch(/يجب ألا تتساوى قيمتا .*NEXTAUTH_SECRET.* أبداً/);
    }
  });
});
