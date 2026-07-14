import { NextRequest } from "next/server";
import { uploadCollaborationFileFromFile } from "@/lib/collaboration-service";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: NextRequest) {
  try {
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
