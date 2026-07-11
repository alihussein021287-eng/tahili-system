import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { fmtTime } from "@/lib/labels";
import { apiPermissionResponse, checkApiPermission } from "@/lib/api-permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const uid = (session.user as any)?.id;
  const role = (session.user as any)?.role;
  const permission = await checkApiPermission(uid, role, "queue.view");
  if (permission.allowed === false) return apiPermissionResponse(permission);

  const startToday = new Date(new Date().toDateString());
  const entries = await prisma.queueEntry.findMany({
    where: { createdAt: { gte: startToday } }, include: { patient: true }, orderBy: { createdAt: "asc" },
  });
  const map = (s: string) => entries.filter((e) => e.status === s).map((e) => ({ id: e.id, name: e.patient.fullName, hall: e.hall ?? null, time: fmtTime(e.createdAt) }));
  return NextResponse.json(
    { called: map("CALLED"), inSession: map("IN_SESSION"), waiting: map("WAITING") },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } },
  );
}
