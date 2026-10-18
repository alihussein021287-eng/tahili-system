import { NextResponse, type NextRequest } from "next/server";
import { readUserError, sessionOwner } from "@/lib/user-error-store";

export const dynamic = "force-dynamic";

/** The reason of the caller's own rejected save, by error digest; nothing for anyone else. */
export async function GET(request: NextRequest) {
  const digest = request.nextUrl.searchParams.get("digest") || "";
  if (!/^[\w-]{1,64}$/.test(digest)) return NextResponse.json({ message: null }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const message = readUserError(digest, sessionOwner(request.headers.get("cookie")));
  return NextResponse.json({ message }, { status: message ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
