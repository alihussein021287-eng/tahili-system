import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { authOptionsForAccess } from "@/lib/auth";
import {
  configuredEnvironment,
  downstreamCookiesForLocalSession,
  LOCAL_SESSION_COOKIE,
  resolveEnvironmentAccess,
  safeAuthRedirect,
  SECURE_SESSION_COOKIE,
} from "@/lib/environment-access";

const environments = {
  development: {
    NEXTAUTH_URL: "https://tahili.elaqat.site",
    NEXTAUTH_URL_INTERNAL: "http://192.168.17.20:3000",
    NEXTAUTH_ALLOW_HTTP_LOGIN: "true",
    AUTH_TRUST_HOST: "true",
  },
  production: {
    NEXTAUTH_URL: "https://tah.elaqat.site",
    NEXTAUTH_URL_INTERNAL: "http://192.168.17.228:3000",
    NEXTAUTH_ALLOW_HTTP_LOGIN: "true",
    AUTH_TRUST_HOST: "true",
  },
} as const;

function headers(host: string, proto?: "http" | "https", forwardedHost = host) {
  const values = new Headers({ host, "x-forwarded-host": forwardedHost });
  if (proto) values.set("x-forwarded-proto", proto);
  return values;
}

describe("Tahili environment access matrix", () => {
  it.each([
    ["development domain", environments.development, headers("tahili.elaqat.site", "https"), true, SECURE_SESSION_COOKIE],
    ["development LAN", environments.development, headers("192.168.17.20:3000"), false, LOCAL_SESSION_COOKIE],
    ["production domain", environments.production, headers("tah.elaqat.site", "https"), true, SECURE_SESSION_COOKIE],
    ["production LAN", environments.production, headers("192.168.17.228:3000"), false, LOCAL_SESSION_COOKIE],
  ])("accepts %s", (_label, env, requestHeaders, secure, cookieName) => {
    const access = resolveEnvironmentAccess(requestHeaders, env);
    expect(access).toMatchObject({ secure, sessionCookieName: cookieName });
    expect(authOptionsForAccess(access!).useSecureCookies).toBe(secure);
  });

  it("rejects unknown, cross-environment, spoofed, and non-HTTPS domain hosts", () => {
    expect(resolveEnvironmentAccess(headers("example.invalid", "https"), environments.development)).toBeNull();
    expect(resolveEnvironmentAccess(headers("192.168.17.228:3000"), environments.development)).toBeNull();
    expect(resolveEnvironmentAccess(headers("192.168.17.20:3000", "http", "tahili.elaqat.site"), environments.development)).toBeNull();
    expect(resolveEnvironmentAccess(headers("tahili.elaqat.site"), environments.development)).toBeNull();
    expect(resolveEnvironmentAccess(headers("tahili.elaqat.site", "http"), environments.development)).toBeNull();
  });

  it("rejects an environment pair or trust policy outside the fixed matrix", () => {
    expect(() => configuredEnvironment({ ...environments.development, NEXTAUTH_URL_INTERNAL: environments.production.NEXTAUTH_URL_INTERNAL })).toThrow();
    expect(() => configuredEnvironment({ ...environments.development, NEXTAUTH_ALLOW_HTTP_LOGIN: "false" })).toThrow();
    expect(() => configuredEnvironment({ ...environments.development, AUTH_TRUST_HOST: "false" })).toThrow();
  });

  it("keeps callbacks on the request origin and blocks open redirects", () => {
    const origin = environments.development.NEXTAUTH_URL_INTERNAL;
    expect(safeAuthRedirect("/patients-care", origin)).toBe(`${origin}/patients-care`);
    expect(safeAuthRedirect(`${origin}/settings`, origin)).toBe(`${origin}/settings`);
    expect(safeAuthRedirect("https://example.invalid/steal", origin)).toBe(origin);
    expect(safeAuthRedirect("//example.invalid/steal", origin)).toBe(origin);
    expect(safeAuthRedirect("not a URL", origin)).toBe(origin);
  });

  it("aliases only the LAN session cookie for downstream Server Components", () => {
    expect(downstreamCookiesForLocalSession([
      { name: LOCAL_SESSION_COOKIE, value: "local-token" },
      { name: SECURE_SESSION_COOKIE, value: "untrusted-secure-token" },
      { name: "preference", value: "rtl" },
    ])).toEqual([
      { name: LOCAL_SESSION_COOKIE, value: "local-token" },
      { name: "preference", value: "rtl" },
      { name: SECURE_SESSION_COOKIE, value: "local-token" },
    ]);
  });

  it("binds port 3000 only to loopback and the configured LAN address", () => {
    const compose = fs.readFileSync(path.join(process.cwd(), "docker-compose.yml"), "utf8");
    expect(compose).toContain('"127.0.0.1:3000:3000"');
    expect(compose).toContain('"${TAHILI_LAN_IP:?set TAHILI_LAN_IP in .env}:3000:3000"');
    expect(compose).not.toMatch(/^\s*-\s*"?3000:3000"?$/m);
  });
});
