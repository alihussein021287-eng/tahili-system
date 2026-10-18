import { describe, expect, it } from "vitest";
import { authOptionsForAccess } from "@/lib/auth";
import {
  configuredEnvironment,
  EnvironmentAccessConfigError,
  LOCAL_SESSION_COOKIE,
  resolveEnvironmentAccess,
  SECURE_SESSION_COOKIE,
  TAHILI_ACCESS_MATRIX,
} from "@/lib/environment-access";

function localEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    TAHILI_LOCAL_ACCESS: "true",
    TAHILI_LOCAL_PORT: "3001",
    NEXTAUTH_URL: "http://localhost:3001",
    NEXTAUTH_URL_INTERNAL: "http://127.0.0.1:3001",
    NEXTAUTH_ALLOW_HTTP_LOGIN: "true",
    AUTH_TRUST_HOST: "true",
    ...overrides,
  };
}

const matrixEnvironments = [
  {
    name: "development",
    NEXTAUTH_URL: "https://tahili.elaqat.site",
    NEXTAUTH_URL_INTERNAL: "http://192.168.17.20:3000",
    NEXTAUTH_ALLOW_HTTP_LOGIN: "true",
    AUTH_TRUST_HOST: "true",
  },
  {
    name: "production",
    NEXTAUTH_URL: "https://tah.elaqat.site",
    NEXTAUTH_URL_INTERNAL: "http://192.168.17.228:3000",
    NEXTAUTH_ALLOW_HTTP_LOGIN: "true",
    AUTH_TRUST_HOST: "true",
  },
] as const;

describe("opt-in local environment access", () => {
  it.each([
    ["192.168.17.20", "3001"],
    [" 192.168.17.20 ", "invalid"],
  ])("rejects TAHILI_LAN_IP in local mode (%s) before port validation", (lanIp, port) => {
    const env = localEnvironment({ TAHILI_LAN_IP: lanIp, TAHILI_LOCAL_PORT: port });
    expect(() => configuredEnvironment(env)).toThrowError(new EnvironmentAccessConfigError(
      "TAHILI_LAN_IP is a server-only variable and cannot be combined with TAHILI_LOCAL_ACCESS",
    ));
  });

  it.each([undefined, "", "   "])("accepts local mode with empty TAHILI_LAN_IP (%s)", (lanIp) => {
    expect(configuredEnvironment(localEnvironment({ TAHILI_LAN_IP: lanIp })).name).toBe("local");
  });

  it.each(["localhost:3001", "127.0.0.1:3001"])("accepts only HTTP loopback access for %s", (host) => {
    const env = localEnvironment();
    expect(configuredEnvironment(env).name).toBe("local");
    for (const forwarding of [{}, { "x-forwarded-host": host, "x-forwarded-proto": "http" }]) {
      const access = resolveEnvironmentAccess(new Headers({ host, ...forwarding }), env);
      expect(access).toEqual({
        environment: "local",
        origin: `http://${host}`,
        host,
        secure: false,
        sessionCookieName: "next-auth.session-token-3001-local",
      });
      expect(access!.sessionCookieName).toBe(`${LOCAL_SESSION_COOKIE}-3001-local`);
      expect(authOptionsForAccess(access!).useSecureCookies).toBe(false);
    }
  });

  it.each([
    "192.168.17.20:3001", "192.168.1.5:3001", "192.168.17.228:3001",
    "tahili.elaqat.site", "tah.elaqat.site", "example.invalid",
    "localhost:3000", "127.0.0.1:3000", "localhost", "127.0.0.1",
    "[::1]:3001", "127.1:3001", "2130706433:3001", "localhost.evil.invalid:3001",
    "localhost:3001, example.invalid", "localhost:03001", "http://localhost:3001",
  ])("rejects unapproved Host %s", (host) => {
    expect(resolveEnvironmentAccess(new Headers({ host }), localEnvironment())).toBeNull();
  });

  it("rejects a missing Host", () => {
    expect(resolveEnvironmentAccess(new Headers(), localEnvironment())).toBeNull();
  });

  it.each([
    { "x-forwarded-proto": "https" },
    { "x-forwarded-proto": "http, https" },
    { "x-forwarded-proto": "" },
    { "x-forwarded-host": "127.0.0.1:3001" },
    { "x-forwarded-host": "localhost:3000" },
    { "x-forwarded-host": "example.invalid" },
    { "x-forwarded-host": "localhost:3001, example.invalid" },
    { "x-forwarded-host": "" },
  ])("rejects invalid forwarding headers %j", (forwarding) => {
    expect(resolveEnvironmentAccess(new Headers({ host: "localhost:3001", ...forwarding }), localEnvironment())).toBeNull();
  });

  it.each(["1", "80", "65535"])("supports valid port boundary/default %s", (port) => {
    const host = `localhost:${port}`;
    const env = localEnvironment({
      TAHILI_LOCAL_PORT: port,
      NEXTAUTH_URL: `http://${host}`,
      NEXTAUTH_URL_INTERNAL: `http://127.0.0.1:${port}`,
    });
    expect(configuredEnvironment(env).name).toBe("local");
    expect(resolveEnvironmentAccess(new Headers({ host }), env)).toEqual({
      environment: "local", origin: `http://${host}`, host, secure: false, sessionCookieName: `${LOCAL_SESSION_COOKIE}-${port}-local`,
    });
  });

  it.each([undefined, "", "0", "65536", "-1", "1.5", "3e3", "0xBB9", "3001junk", " 3001 "])("rejects invalid local port %s", (port) => {
    expect(() => configuredEnvironment(localEnvironment({ TAHILI_LOCAL_PORT: port }))).toThrow(EnvironmentAccessConfigError);
  });

  describe.each(["NEXTAUTH_URL", "NEXTAUTH_URL_INTERNAL"])("validates %s independently", (variable) => {
    it.each([
      undefined, "", "not a URL", "/localhost:3001",
      "http://localhost:3000", "http://127.0.0.1:3000",
      "http://192.168.17.20:3000", "http://192.168.1.5:3001",
      "https://tahili.elaqat.site", "https://tah.elaqat.site", "http://example.invalid:3001",
      "https://localhost:3001", "ftp://localhost:3001", "http://[::1]:3001",
      "http://127.1:3001", "http://2130706433:3001", "http://0x7f000001:3001",
      "http://localhost:3001/path", "http://localhost:3001/?next=evil", "http://localhost:3001/#fragment",
      "http://user:password@localhost:3001",
    ])("rejects non-loopback or non-origin configuration %s", (url) => {
      expect(() => configuredEnvironment(localEnvironment({ [variable]: url }))).toThrow(EnvironmentAccessConfigError);
    });

    it.each(["http://localhost:3001", "http://127.0.0.1:3001"])("accepts loopback origin %s", (url) => {
      expect(configuredEnvironment(localEnvironment({ [variable]: url })).name).toBe("local");
    });
  });

  describe.each(["NEXTAUTH_ALLOW_HTTP_LOGIN", "AUTH_TRUST_HOST"])("requires explicit %s trust", (variable) => {
    it.each([undefined, "", "false", "TRUE", "1"])("rejects %s", (value) => {
      expect(() => configuredEnvironment(localEnvironment({ [variable]: value }))).toThrow(EnvironmentAccessConfigError);
    });
  });
});

describe("local opt-in preserves the fixed environment matrix", () => {
  it("resolves development with TAHILI_LAN_IP when local access is unset", () => {
    const { name, ...development } = matrixEnvironments[0];
    expect(configuredEnvironment({ ...development, TAHILI_LAN_IP: "192.168.17.20" }).name).toBe("development");
  });

  it("preserves matrix literal values", () => {
    expect(TAHILI_ACCESS_MATRIX).toEqual(matrixEnvironments.map((env) => ({
      name: env.name, canonicalOrigin: env.NEXTAUTH_URL, localOrigin: env.NEXTAUTH_URL_INTERNAL,
    })));
  });

  describe.each([undefined, "false", "TRUE", "1", " true", "true ", ""])("with TAHILI_LOCAL_ACCESS=%s", (flag) => {
    it.each(matrixEnvironments)("preserves $name resolution and rejects localhost", (fixture) => {
      const { name, ...originalEnv } = fixture;
      const env = { ...originalEnv, TAHILI_LOCAL_ACCESS: flag, TAHILI_LOCAL_PORT: "invalid-and-ignored" };
      expect(configuredEnvironment(env)).toEqual({
        name, canonicalOrigin: originalEnv.NEXTAUTH_URL, localOrigin: originalEnv.NEXTAUTH_URL_INTERNAL,
      });
      for (const [origin, secure] of [[originalEnv.NEXTAUTH_URL, true], [originalEnv.NEXTAUTH_URL_INTERNAL, false]] as const) {
        const host = new URL(origin).host;
        const headers = new Headers({ host, "x-forwarded-host": host, "x-forwarded-proto": secure ? "https" : "http" });
        const expected = { environment: name, origin, host, secure, sessionCookieName: secure ? SECURE_SESSION_COOKIE : LOCAL_SESSION_COOKIE };
        expect(resolveEnvironmentAccess(headers, originalEnv)).toEqual(expected);
        expect(resolveEnvironmentAccess(headers, env)).toEqual(expected);
      }
      expect(resolveEnvironmentAccess(new Headers({ host: "localhost:3000" }), env)).toBeNull();
      expect(resolveEnvironmentAccess(new Headers({ host: "localhost:3001" }), env)).toBeNull();
      expect(resolveEnvironmentAccess(new Headers({ host: "127.0.0.1:3001" }), env)).toBeNull();
    });

    it("does not activate loopback configuration without exact true", () => {
      expect(() => configuredEnvironment(localEnvironment({ TAHILI_LOCAL_ACCESS: flag }))).toThrow(EnvironmentAccessConfigError);
    });
  });
});
