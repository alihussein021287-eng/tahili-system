import { NextRequest } from "next/server";
import { uploadCollaborationFileFromFile } from "@/lib/collaboration-service";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function assertSameOrigin(request: NextRequest) {
  const expected = new Set([new URL(request.url).origin]);
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    expected.add(`${proto}://${host}`);
    const [hostname, port] = host.split(":");
    if (hostname === "127.0.0.1") expected.add(`${proto}://localhost${port ? `:${port}` : ""}`);
    if (hostname === "localhost") expected.add(`${proto}://127.0.0.1${port ? `:${port}` : ""}`);
  }
  if (process.env.NEXTAUTH_URL) expected.add(new URL(process.env.NEXTAUTH_URL).origin);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (origin && !expected.has(origin)) throw new Error("طلب رفع غير موثوق");
  if (!origin && referer && !expected.has(new URL(referer).origin)) throw new Error("طلب رفع غير موثوق");
  if (!origin && !referer && secFetchSite !== "same-origin") throw new Error("طلب رفع غير موثوق");
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const formData = await request.formData();
    const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    const single = formData.get("file");
    if (single instanceof File && single.size > 0) files.push(single);
    if (!files.length) return Response.json({ error: "لم يصل أي ملف" }, { status: 400, headers: HEADERS });
    const ids = [];
    for (const file of files) ids.push(await uploadCollaborationFileFromFile(file, formData));
    return Response.json({ ok: true, ids }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر رفع الملف";
    return Response.json({ error: message }, { status: 400, headers: HEADERS });
  }
}
