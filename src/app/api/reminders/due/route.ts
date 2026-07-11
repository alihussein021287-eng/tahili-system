import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { fmtDate, fmtTime } from "@/lib/labels";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function readReminderKey(req: Request) {
  const urlKey = new URL(req.url).searchParams.get("key");
  const headerKey = req.headers.get("x-reminder-key");
  const auth = req.headers.get("authorization") || "";
  const bearerKey = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearerKey || headerKey || urlKey;
}

export async function GET(req: Request) {
  const key = readReminderKey(req);
  if (!process.env.REMINDER_KEY || key !== process.env.REMINDER_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  const dayMs = 86400000;
  const startTomorrow = new Date(new Date(new Date().toDateString()).getTime() + dayMs);
  const startDayAfter = new Date(startTomorrow.getTime() + dayMs);
  const appts = await prisma.appointment.findMany({
    where: { status: "SCHEDULED", scheduledAt: { gte: startTomorrow, lt: startDayAfter } },
    include: { patient: true }, orderBy: { scheduledAt: "asc" },
  });
  const reminders = appts
    .filter((a) => a.patient.phone)
    .map((a) => ({
      phone: String(a.patient.phone).replace(/\D/g, "").replace(/^0/, "964"),
      name: a.patient.fullName,
      message: `تذكير: لديك موعد في المجمع التأهيلي يوم ${fmtDate(a.scheduledAt)} الساعة ${fmtTime(a.scheduledAt)}`,
    }));
  return NextResponse.json(
    { count: reminders.length, reminders },
    { headers: NO_STORE_HEADERS },
  );
}
