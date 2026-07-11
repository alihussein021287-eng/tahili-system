import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/access";
import { BACKUP_DIR } from "@/lib/backup";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await getSession();
  if ((s?.user as any)?.role !== "ADMIN") return new NextResponse("غير مصرّح", { status: 403 });
  const name = path.basename(req.nextUrl.searchParams.get("f") || "");
  const file = path.join(BACKUP_DIR, name);
  if (!(name.endsWith(".sql") || name.endsWith(".sql.gz")) || !fs.existsSync(file)) return new NextResponse("غير موجود", { status: 404 });
  const buf = fs.readFileSync(file);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": name.endsWith(".gz") ? "application/gzip" : "application/sql",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
