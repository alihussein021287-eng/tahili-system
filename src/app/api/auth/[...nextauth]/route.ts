import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { authOptionsForAccess } from "@/lib/auth";
import { EnvironmentAccessConfigError, resolveEnvironmentAccess } from "@/lib/environment-access";

type RouteContext = { params: Promise<{ nextauth: string[] }> };

async function handler(request: NextRequest, context: RouteContext) {
  try {
    const access = resolveEnvironmentAccess(request.headers);
    if (!access) return new Response("Unrecognized Tahili host", { status: 421 });

    const headers = new Headers(request.headers);
    headers.set("host", access.host);
    headers.set("x-forwarded-host", access.host);
    headers.set("x-forwarded-proto", access.secure ? "https" : "http");
    const trustedRequest = new NextRequest(request, { headers });
    return NextAuth(trustedRequest, context, authOptionsForAccess(access));
  } catch (error) {
    if (error instanceof EnvironmentAccessConfigError) {
      console.error("[auth] invalid environment access configuration");
      return new Response("Invalid authentication environment", { status: 500 });
    }
    throw error;
  }
}

export { handler as GET, handler as POST };
