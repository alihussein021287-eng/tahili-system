import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { fmtDate, fmtTime } from "@/lib/labels";
import { notifyRole, notifyUser } from "@/lib/notify";

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
  const now = new Date();
  const soon = new Date(now.getTime() + 60 * dayMs);
  // Independent branch pharmacies: stock reminders are computed per branch and go only to that branch's pharmacists.
  const [delayed, partial, overdueExpenses] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { expectedDeliveryDate: { lt: now }, status: { in: ["APPROVED","ORDERED","PARTIALLY_RECEIVED"] } }, select: { createdById: true }, distinct: ["createdById"] }),
    prisma.purchaseOrder.findMany({ where: { status: "PARTIALLY_RECEIVED" }, select: { createdById: true }, distinct: ["createdById"] }),
    prisma.woundedExpense.findMany({ where: { dueDate: { lt: now }, status: { in: ["SUBMITTED","APPROVED","READY_FOR_PAYMENT"] } }, select: { createdById: true }, distinct: ["createdById"] }),
  ]);
  const pharmacists = await prisma.user.findMany({ where: { role: "PHARMACIST", isActive: true, branchId: { not: null }, branch: { isActive: true } }, select: { id: true, branchId: true } });
  const medsForMin = await prisma.medication.findMany({ select: { id: true, minQuantity: true } });
  const minOf = new Map(medsForMin.map((m) => [m.id, m.minQuantity]));
  const perBranchMed = await prisma.medicationBatch.groupBy({ by: ["branchId", "medicationId"], where: { branchId: { not: null } }, _sum: { quantity: true } });
  const branchStockReminders: Promise<unknown>[] = [];
  for (const branchId of new Set(pharmacists.map((p) => p.branchId as number))) {
    const ids = pharmacists.filter((p) => p.branchId === branchId).map((p) => p.id);
    const [expired, expiring] = await Promise.all([
      prisma.medicationBatch.count({ where: { branchId, quantity: { gt: 0 }, expiryDate: { lt: now } } }),
      prisma.medicationBatch.count({ where: { branchId, quantity: { gt: 0 }, expiryDate: { gte: now, lte: soon } } }),
    ]);
    const low = perBranchMed.some((r) => r.branchId === branchId && (r._sum.quantity ?? 0) <= (minOf.get(r.medicationId) ?? 0));
    for (const id of ids) {
      if (low) branchStockReminders.push(notifyUser(id, "انخفاض أو نفاد مخزون", { body: "راجع مخزون صيدلية فرعك وإجراءات إعادة التزويد.", link: "/pharmacy/stock" }));
      if (expired) branchStockReminders.push(notifyUser(id, "دفعات منتهية الصلاحية", { body: "راجع شاشة الدفعات قبل أي صرف.", link: "/pharmacy/stock" }));
      if (expiring) branchStockReminders.push(notifyUser(id, "دفعات قريبة الانتهاء", { body: "راجع تقرير النفاذية وخطة الاستخدام.", link: "/pharmacy/reports" }));
    }
  }
  await Promise.all([
    ...branchStockReminders,
    ...delayed.map((row) => notifyUser(row.createdById, "تأخر توريد أمر شراء", { body: "يوجد أمر شراء تجاوز موعد التسليم المتوقع.", link: "/pharmacy/purchases" })),
    ...partial.map((row) => notifyUser(row.createdById, "استلام جزئي يحتاج متابعة", { body: "توجد كمية متبقية في أمر شراء.", link: "/pharmacy/purchases" })),
    ...overdueExpenses.map((row) => notifyUser(row.createdById, "طلب صرف متأخر", { body: "تجاوز طلب صرف تاريخ الاستحقاق ويحتاج متابعة.", link: "/finance/expenses" })),
  ]);
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
