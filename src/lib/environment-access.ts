export const SECURE_SESSION_COOKIE = "__Secure-next-auth.session-token";
export const LOCAL_SESSION_COOKIE = "next-auth.session-token";

export const TAHILI_ACCESS_MATRIX = [
  {
    name: "development",
    canonicalOrigin: "https://tahili.elaqat.site",
    localOrigin: "http://192.168.17.20:3000",
  },
  {
    name: "production",
    canonicalOrigin: "https://tah.elaqat.site",
    localOrigin: "http://192.168.17.228:3000",
  },
] as const;

export type TahiliEnvironmentName = (typeof TAHILI_ACCESS_MATRIX)[number]["name"] | "local";
export type EnvironmentAccess = {
  environment: TahiliEnvironmentName;
  origin: string;
  host: string;
  secure: boolean;
  sessionCookieName: typeof SECURE_SESSION_COOKIE | typeof LOCAL_SESSION_COOKIE | `${typeof LOCAL_SESSION_COOKIE}-${number}-local`;
};

type Environment = Record<string, string | undefined>;
type HeaderReader = Pick<Headers, "get">;

export class EnvironmentAccessConfigError extends Error {}

function normalizedOrigin(value: string | undefined, variable: string) {
  if (!value) throw new EnvironmentAccessConfigError(`${variable} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EnvironmentAccessConfigError(`${variable} must be an absolute URL`);
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new EnvironmentAccessConfigError(`${variable} must contain only an origin`);
  }
  return url.origin;
}

function configuredLocalEnvironment(env: Environment) {
  if (env.TAHILI_LAN_IP?.trim()) {
    throw new EnvironmentAccessConfigError("TAHILI_LAN_IP is a server-only variable and cannot be combined with TAHILI_LOCAL_ACCESS");
  }
  const portValue = env.TAHILI_LOCAL_PORT;
  const port = Number(portValue);
  if (!portValue || !/^[0-9]+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvironmentAccessConfigError("TAHILI_LOCAL_PORT must be an integer from 1 to 65535");
  }

  function localOrigin(variable: "NEXTAUTH_URL" | "NEXTAUTH_URL_INTERNAL") {
    const value = env[variable];
    const origin = normalizedOrigin(value, variable);
    const url = new URL(origin);
    // Validate the literal host too: URL parsing normalizes aliases such as 127.1.
    if (!/^http:\/\/(localhost|127\.0\.0\.1)(?::[0-9]+)?\/?$/.test(value!) ||
        url.protocol !== "http:" || Number(url.port || "80") !== port) {
      throw new EnvironmentAccessConfigError(`${variable} must be an HTTP loopback origin on TAHILI_LOCAL_PORT`);
    }
    return origin;
  }

  const canonicalOrigin = localOrigin("NEXTAUTH_URL");
  const internalOrigin = localOrigin("NEXTAUTH_URL_INTERNAL");
  if (env.NEXTAUTH_ALLOW_HTTP_LOGIN !== "true") {
    throw new EnvironmentAccessConfigError("NEXTAUTH_ALLOW_HTTP_LOGIN must be true for local access");
  }
  if (env.AUTH_TRUST_HOST !== "true") {
    throw new EnvironmentAccessConfigError("AUTH_TRUST_HOST must be true after Tahili host validation");
  }
  return { name: "local" as const, canonicalOrigin, localOrigin: internalOrigin, port };
}

export function configuredEnvironment(env: Environment = process.env) {
  if (env.TAHILI_LOCAL_ACCESS === "true") return configuredLocalEnvironment(env);

  const canonicalOrigin = normalizedOrigin(env.NEXTAUTH_URL, "NEXTAUTH_URL");
  const selected = TAHILI_ACCESS_MATRIX.find((item) => item.canonicalOrigin === canonicalOrigin);
  if (!selected) throw new EnvironmentAccessConfigError("NEXTAUTH_URL is not in the Tahili access matrix");

  const localOrigin = normalizedOrigin(env.NEXTAUTH_URL_INTERNAL, "NEXTAUTH_URL_INTERNAL");
  if (localOrigin !== selected.localOrigin) {
    throw new EnvironmentAccessConfigError("NEXTAUTH_URL_INTERNAL does not match NEXTAUTH_URL environment");
  }
  if (env.NEXTAUTH_ALLOW_HTTP_LOGIN !== "true") {
    throw new EnvironmentAccessConfigError("NEXTAUTH_ALLOW_HTTP_LOGIN must be true for approved LAN access");
  }
  if (env.AUTH_TRUST_HOST !== "true") {
    throw new EnvironmentAccessConfigError("AUTH_TRUST_HOST must be true after Tahili host validation");
  }
  return selected;
}

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim().toLowerCase() || null;
}

export function resolveEnvironmentAccess(headers: HeaderReader, env: Environment = process.env): EnvironmentAccess | null {
  const selected = configuredEnvironment(env);
  if (selected.name === "local") {
    // Local mode accepts one exact authority, never a proxy header list.
    // Host is client-controlled: network isolation requires the Compose loopback binding.
    const host = headers.get("host");
    const forwardedHost = headers.get("x-forwarded-host");
    const forwardedProto = headers.get("x-forwarded-proto");
    if (host !== `localhost:${selected.port}` && host !== `127.0.0.1:${selected.port}`) return null;
    if (forwardedHost !== null && forwardedHost !== host) return null;
    if (forwardedProto !== null && forwardedProto !== "http") return null;
    return {
      environment: "local",
      origin: `http://${host}`,
      host,
      secure: false,
      // NextAuth reads by prefix: terminate the port so 3001 cannot read 30010.
      sessionCookieName: `${LOCAL_SESSION_COOKIE}-${selected.port}-local`,
    };
  }

  const rawHost = firstHeaderValue(headers.get("host"));
  const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"));
  if (!rawHost || (forwardedHost && forwardedHost !== rawHost)) return null;

  const canonical = new URL(selected.canonicalOrigin);
  const local = new URL(selected.localOrigin);
  const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto"));

  if (rawHost === canonical.host) {
    if (forwardedProto !== "https") return null;
    return {
      environment: selected.name,
      origin: canonical.origin,
      host: canonical.host,
      secure: true,
      sessionCookieName: SECURE_SESSION_COOKIE,
    };
  }

  if (rawHost === local.host) {
    if (forwardedProto && forwardedProto !== "http") return null;
    return {
      environment: selected.name,
      origin: local.origin,
      host: local.host,
      secure: false,
      sessionCookieName: LOCAL_SESSION_COOKIE,
    };
  }

  return null;
}

export function safeAuthRedirect(url: string, requestOrigin: string) {
  try {
    const target = url.startsWith("/") && !url.startsWith("//")
      ? new URL(url, requestOrigin)
      : new URL(url);
    return target.origin === requestOrigin ? target.toString() : requestOrigin;
  } catch {
    return requestOrigin;
  }
}

export function downstreamCookiesForLocalSession(
  cookies: ReadonlyArray<{ name: string; value: string }>,
  sessionCookieName: EnvironmentAccess["sessionCookieName"] = LOCAL_SESSION_COOKIE,
) {
  // NextAuth matches cookie name prefixes, so remove all incoming canonical
  // variants before creating a request-only alias for this environment.
  const withoutCanonical = cookies.filter((cookie) => !cookie.name.startsWith(SECURE_SESSION_COOKIE));
  const aliases = withoutCanonical
    .filter((cookie) => cookie.name === sessionCookieName ||
      (cookie.name.startsWith(`${sessionCookieName}.`) && /^\d+$/.test(cookie.name.slice(sessionCookieName.length + 1))))
    .map((cookie) => ({
      name: `${SECURE_SESSION_COOKIE}${cookie.name.slice(sessionCookieName.length)}`,
      value: cookie.value,
    }));
  return [...withoutCanonical, ...aliases];
}

export function serializedCookieHeader(cookies: ReadonlyArray<{ name: string; value: string }>) {
  // This API receives decoded values, unlike the raw forwarding path below.
  return cookies.map((cookie) => {
    if (!validCookieName(cookie.name)) throw new TypeError("Invalid cookie name");
    return `${cookie.name}=${encodeURIComponent(cookie.value)}`;
  }).join("; ");
}

function validCookieName(name: string) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

export class InvalidCookieHeaderError extends TypeError {
  constructor() { super("Invalid authentication cookies"); }
}

export function downstreamCookieHeaderForLocalSession(
  header: string | null,
  sessionCookieName: EnvironmentAccess["sessionCookieName"] = LOCAL_SESSION_COOKIE,
) {
  if (!header) return "";
  if (/[\r\n\0]/.test(header)) throw new InvalidCookieHeaderError();
  const cookies = new Map<string, string>();
  for (const part of header.split(/; */)) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (!validCookieName(name)) continue;
    // Match NextRequest's last-valid-value selection, including malformed URI handling.
    // Validate decoding only: forward the original bytes to avoid double encoding.
    try { decodeURIComponent(value); } catch { continue; }
    cookies.set(name, value);
  }
  // Validate AFTER authoritative duplicate selection. Never retain an older value
  // because the value actually selected by NextRequest is not representable.
  for (const value of cookies.values()) {
    const content = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    if (!/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(content)) throw new InvalidCookieHeaderError();
  }
  return downstreamCookiesForLocalSession([...cookies].map(([name, value]) => ({ name, value })), sessionCookieName)
    .map(({ name, value }) => `${name}=${value}`).join("; ");
}
