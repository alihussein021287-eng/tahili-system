import { NextRequest } from "next/server";
import { collaborationActor, listMessages } from "@/lib/collaboration-service";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await collaborationActor("collaboration.view");
    const { id } = await params;
    const cursor = new URL(request.url).searchParams.get("cursor");
    const messages = await listMessages(actor, id, cursor);
    return Response.json({ messages }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "غير مصرّح";
    return Response.json({ error: message }, { status: 403, headers: HEADERS });
  }
}
