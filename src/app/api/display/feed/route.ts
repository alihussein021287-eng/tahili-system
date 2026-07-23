import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDisplayDevice } from "@/lib/display-auth";
import { baghdadDayRange, maskDisplayName } from "@/lib/display-utils";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const device = await getDisplayDevice();
  if (!device) return new NextResponse("غير مصرح", { status: 401, headers: { "Cache-Control": "no-store" } });
  const now = new Date();
  const { start, end } = baghdadDayRange(now);
  const scope = {
    ...(device.centerId ? { centerId: device.centerId } : {}),
    ...(device.halls.length ? { hall: { in: device.halls } } : {}),
  };
  const activeWhere: Prisma.QueueEntryWhereInput = {
    ...scope,
    OR: [
      { status: "CALLED", calledAt: { gte: start, lt: end } },
      { status: { in: ["WAITING", "IN_SESSION"] }, createdAt: { gte: start, lt: end } },
    ],
  };
  const [entries, inSessionTotal, waitingTotal] = await Promise.all([
    prisma.queueEntry.findMany({
      where: activeWhere,
      select: { id: true, status: true, hall: true, createdAt: true, calledAt: true, patient: { select: { fullName: true } } },
      orderBy: { createdAt: "asc" },
      take: 120,
    }),
    prisma.queueEntry.count({ where: { ...scope, status: "IN_SESSION", createdAt: { gte: start, lt: end } } }),
    prisma.queueEntry.count({ where: { ...scope, status: "WAITING", createdAt: { gte: start, lt: end } } }),
  ]);
  const numbered = entries.map((entry, index) => ({ entry, queueNumber: index + 1 }));
  const item = ({ entry, queueNumber }: typeof numbered[number]) => ({
    id: entry.id,
    name: maskDisplayName(entry.patient.fullName, device.nameMode, queueNumber),
    hall: entry.hall,
    queueNumber,
    time: new Intl.DateTimeFormat("ar-IQ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" }).format(entry.createdAt),
  });
  const calledCutoff = new Date(now.getTime() - device.callDisplaySeconds * 1000);
  const currentCall = numbered.filter(({ entry }) => entry.status === "CALLED" && entry.calledAt && entry.calledAt >= calledCutoff).sort((a, b) => (b.entry.calledAt?.getTime() ?? 0) - (a.entry.calledAt?.getTime() ?? 0))[0];
  const called = currentCall ? { ...item(currentCall), eventId: `${currentCall.entry.id}:${currentCall.entry.calledAt!.toISOString()}` } : null;
  const inSessionEntries = numbered.filter(({ entry }) => entry.status === "IN_SESSION");
  const waitingEntries = numbered.filter(({ entry }) => entry.status === "WAITING");
  // The display rotates compact pages. Keep enough items for several pages without sending an unbounded daily queue.
  const inSession = inSessionEntries.slice(0, 40).map(item);
  const waiting = waitingEntries.slice(0, 40).map(item);
  if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() >= 30_000) await prisma.displayDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } });
  return NextResponse.json({
    device: { id: device.id, name: device.name, centerName: device.center?.name ?? "المجمع التأهيلي الطبي", callDisplaySeconds: device.callDisplaySeconds },
    called, inSession, waiting, inSessionTotal, waitingTotal, updatedAt: now.toISOString(),
  }, { headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } });
}
