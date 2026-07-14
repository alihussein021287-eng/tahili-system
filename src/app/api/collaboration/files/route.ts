import { NextRequest } from "next/server";
import { uploadCollaborationFileFromFile } from "@/lib/collaboration-service";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function assertSameOrigin(request: NextRequest) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if (origin && origin !== expected) throw new Error("طلب رفع غير موثوق");
  if (!origin && referer && new URL(referer).origin !== expected) throw new Error("طلب رفع غير موثوق");
  if (!origin && !referer) throw new Error("طلب رفع غير موثوق");
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
