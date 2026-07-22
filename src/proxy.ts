import { getToken } from "next-auth/jwt";
import { type NextRequest, NextResponse } from "next/server";
import {
  downstreamCookiesForLocalSession,
  EnvironmentAccessConfigError,
  resolveEnvironmentAccess,
  serializedCookieHeader,
} from "@/lib/environment-access";

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
  try {
    const access = resolveEnvironmentAccess(request.headers);
    if (!access) return new NextResponse("Unrecognized Tahili host", { status: 421 });
    if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
      cookieName: access.sessionCookieName,
    });
    if (!token) {
      const signInUrl = new URL("/login", access.origin);
      signInUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(signInUrl);
    }

    if (access.secure) return NextResponse.next();

    const headers = new Headers(request.headers);
    headers.set("cookie", serializedCookieHeader(downstreamCookiesForLocalSession(request.cookies.getAll())));
    return NextResponse.next({ request: { headers } });
  } catch (error) {
    if (error instanceof EnvironmentAccessConfigError) {
      console.error("[proxy] invalid environment access configuration");
      return new NextResponse("Invalid authentication environment", { status: 500 });
    }
    throw error;
  }
}

export const config = {
  matcher: ["/((?!_next/).*)"],
};
