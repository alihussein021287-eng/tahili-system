import { getToken } from "next-auth/jwt";
import { type NextRequest, NextResponse } from "next/server";
import {
  downstreamCookiesForLocalSession,
  EnvironmentAccessConfigError,
  resolveEnvironmentAccess,
  serializedCookieHeader,
} from "@/lib/environment-access";
import { logEvent, normalizeRoute, requestId } from "@/lib/observability";

const PUBLIC_PATHS = [
  /^\/setup(?:\/|$)/,
  /^\/login(?:\/|$)/,
  /^\/display(?:\/|$)/,
  /^\/portal(?:\/|$)/,
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/display(?:\/|$)/,
  /^\/api\/reminders(?:\/|$)/,
  /^\/favicon\.ico$/,
  /^\/manifest\.json$/,
  /^\/sw\.js$/,
  /^\/icon-(?:192|512)\.png$/,
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((pattern) => pattern.test(pathname));
}

export async function proxy(request: NextRequest) {
  const id = requestId(request.headers.get("x-request-id"));
  try {
    const access = resolveEnvironmentAccess(request.headers);
    if (!access) return new NextResponse("Unrecognized Tahili host", { status: 421 });
    if (isPublicPath(request.nextUrl.pathname)) {
      const response = NextResponse.next();
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

    if (access.secure) { const response = NextResponse.next(); response.headers.set("X-Request-ID", id); return response; }

    const headers = new Headers(request.headers);
    headers.set("cookie", serializedCookieHeader(downstreamCookiesForLocalSession(request.cookies.getAll())));
    headers.set("x-request-id", id);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("X-Request-ID", id);
    logEvent({ level: "info", route: normalizeRoute(request.nextUrl.pathname), method: request.method, status: 200, requestId: id });
    return response;
  } catch (error) {
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
