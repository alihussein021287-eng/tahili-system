import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import {
  downstreamCookieHeaderForLocalSession,
  EnvironmentAccessConfigError,
  InvalidCookieHeaderError,
  resolveEnvironmentAccess,
  SECURE_SESSION_COOKIE,
} from "@/lib/environment-access";
import { logEvent, normalizeRoute } from "@/lib/observability";

const PUBLIC_PATHS = [
  /^\/setup(?:\/|$)/,
  /^\/login(?:\/|$)/,
  /^\/display(?:\/|$)/,
  /^\/portal(?:\/|$)/,
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/display(?:\/|$)/,
  /^\/api\/reminders(?:\/|$)/,
  /^\/api\/observability\/client-error(?:\/|$)/,
  /^\/api\/observability\/faro(?:\/|$)/,
  /^\/favicon\.ico$/,
  /^\/manifest\.json$/,
  /^\/sw\.js$/,
  /^\/icon-(?:192|512)\.png$/,
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((pattern) => pattern.test(pathname));
}

export async function proxy(request: NextRequest) {
  const id = crypto.randomUUID();
  try {
    const internalFaroMetrics = request.nextUrl.pathname === "/api/observability/faro/metrics" && request.headers.get("host") === "app:3000";
    if (internalFaroMetrics) {
      const headers = new Headers(request.headers);
      headers.delete("x-request-id"); headers.delete("x-tahili-request-id"); headers.delete("x-tahili-request-id-source");
      headers.set("x-tahili-request-id", id); headers.set("x-tahili-request-id-source", "proxy");
      const response = NextResponse.next({ request: { headers } }); response.headers.set("X-Request-ID", id); return response;
    }
    const access = resolveEnvironmentAccess(request.headers);
    if (!access) return new NextResponse("Unrecognized Tahili host", { status: 421 });
    if (isPublicPath(request.nextUrl.pathname)) {
      const headers = new Headers(request.headers);
      headers.delete("x-request-id"); headers.delete("x-tahili-request-id"); headers.delete("x-tahili-request-id-source");
      headers.set("x-tahili-request-id", id); headers.set("x-tahili-request-id-source", "proxy");
      const response = NextResponse.next({ request: { headers } });
      response.headers.set("X-Request-ID", id);
      logEvent({ level: "info", route: normalizeRoute(request.nextUrl.pathname), method: request.method, status: 200, requestId: id });
      return response;
    }

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
      cookieName: access.sessionCookieName,
    });
    if (!token) {
      const signInUrl = new URL("/login", access.origin);
      signInUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      const response = NextResponse.redirect(signInUrl); response.headers.set("X-Request-ID", id); return response;
    }

    const headers = new Headers(request.headers);
    if (!access.secure) {
      headers.set("cookie", downstreamCookieHeaderForLocalSession(request.headers.get("cookie"), access.sessionCookieName));
    }
    // NextAuth's session path reads cookies, not getToken's Bearer fallback.
    // Compare its effective token bytes with those already authenticated above.
    const sessionHeaders = new Headers(headers);
    sessionHeaders.delete("authorization");
    const forwarded = new NextRequest(request.url, { headers: sessionHeaders });
    const verifiedToken = await getToken({ req: request, cookieName: access.sessionCookieName, raw: true });
    const forwardedToken = await getToken({ req: forwarded, cookieName: access.secure ? access.sessionCookieName : SECURE_SESSION_COOKIE, raw: true });
    if (!verifiedToken || verifiedToken !== forwardedToken) throw new InvalidCookieHeaderError();

    if (access.secure) {
      headers.delete("x-request-id"); headers.delete("x-tahili-request-id"); headers.delete("x-tahili-request-id-source");
      headers.set("x-tahili-request-id", id); headers.set("x-tahili-request-id-source", "proxy");
      const response = NextResponse.next({ request: { headers } }); response.headers.set("X-Request-ID", id); return response;
    }

    headers.delete("x-request-id"); headers.delete("x-tahili-request-id"); headers.delete("x-tahili-request-id-source");
    headers.set("x-tahili-request-id", id); headers.set("x-tahili-request-id-source", "proxy");
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("X-Request-ID", id);
    logEvent({ level: "info", route: normalizeRoute(request.nextUrl.pathname), method: request.method, status: 200, requestId: id });
    return response;
  } catch (error) {
    if (error instanceof InvalidCookieHeaderError) {
      const response = new NextResponse("Invalid authentication cookies", { status: 400 });
      response.headers.set("X-Request-ID", id);
      return response;
    }
    if (error instanceof EnvironmentAccessConfigError) {
      logEvent({ level: "error", route: normalizeRoute(request.nextUrl.pathname), method: request.method, status: 500, requestId: id, errorCode: "ENV_ACCESS" });
      const response = new NextResponse("Invalid authentication environment", { status: 500 }); response.headers.set("X-Request-ID", id); return response;
    }
    throw error;
  }
}

export const config = {
  matcher: ["/((?!_next/).*)"],
};
