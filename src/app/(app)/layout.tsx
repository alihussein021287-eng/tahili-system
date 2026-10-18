import { requireSession } from "@/lib/access";
import { filterRoleNoticesToPatientScope } from "@/lib/patient-access";
import { EXPIRY_SOON_DAYS } from "@/lib/pharmacy-expiry";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { prisma } from "@/lib/db";
import { getBackupOverview, maybeAutoBackup } from "@/lib/backup";
import { loadPerms } from "@/lib/access";
import { canOpenNotification } from "@/lib/notifications";
import { collaborationUnreadCount } from "@/lib/collaboration-service";
import { getAdminConfig } from "@/lib/admin-config";
import { normalizePresenceConfig } from "@/lib/presence";
import { currentStockViewer, batchViewWhere, lowStockMedications } from "@/lib/pharmacy-stock";
import { pharmacyPrescriptionWhere } from "@/lib/pharmacy-scope";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session) redirect("/login");
  const uid = (session.user as any)?.id;
  // قراءة المستخدم الحيّ من القاعدة: طرد المعطّل فوراً + اعتماد الدور المحدّث (لا ننتظر انتهاء التوكن)
  const dbUser = uid ? await prisma.user.findUnique({ where: { id: uid }, select: { isActive: true, role: true, fullName: true } }) : null;
  if (!dbUser || !dbUser.isActive) redirect("/login");
  const role = dbUser.role;
  const name = dbUser.fullName ?? session.user?.name ?? "مستخدم";
  const perms = Array.from(await loadPerms(uid, role));
  const permSet = new Set(perms);

  const now = new Date();
  const soon = new Date(); soon.setDate(soon.getDate() + EXPIRY_SOON_DAYS);
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const stockViewer = await currentStockViewer();
  const rxScope = await pharmacyPrescriptionWhere();
  const [admitted, devicesDue, meds, rxPending, expiringSoon, myTasks, overdueTasks, appointmentSoon, org, collaborationUnread, adminConfig] = await Promise.all([
    prisma.admission.findMany({ where: { status: "ADMITTED" }, select: { admissionDate: true, durationDays: true } }),
    prisma.device.count({ where: { nextMaintenanceAt: { lte: now }, status: { not: "REPLACED" } } }),
    lowStockMedications(stockViewer),
    prisma.prescription.count({ where: { ...rxScope, isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", visitId: { not: null } } }),
    prisma.medicationBatch.count({ where: { ...batchViewWhere(stockViewer), quantity: { gt: 0 }, expiryDate: { not: null, lte: soon } } }),
    prisma.task.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, OR: [{ assignedToId: uid }, { assignedRole: role }] } }),
    prisma.task.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: now }, OR: [{ assignedToId: uid }, { assignedRole: role }] } }),
    prisma.appointment.count({ where: { status: "SCHEDULED", scheduledAt: { gte: now, lte: inTwoHours }, OR: [{ assignedTo: name }, { assignedTo: null }] } }),
    permSet.has("settings.backup") ? prisma.orgSetting.findUnique({ where: { id: 1 }, select: { autoBackup: true } }) : Promise.resolve(null),
    permSet.has("collaboration.view") ? collaborationUnreadCount(uid, role) : Promise.resolve(0),
    getAdminConfig(),
  ]);
  const admOver = admitted.filter((a) => a.durationDays && now >= new Date(new Date(a.admissionDate).getTime() + a.durationDays * 86400000)).length;
  const lowStock = meds.filter((m: any) => (m.quantity ?? 0) <= (m.minQuantity ?? 0)).length;
  const backupOverview = permSet.has("settings.backup") ? getBackupOverview() : null;
  const backupAgeHours = backupOverview?.latestDb ? (now.getTime() - backupOverview.latestDb.mtime.getTime()) / 3600000 : Infinity;
  const alerts = {
    admOver,
    devicesDue,
    lowStock,
    rxPending,
    expiringSoon,
    myTasks,
    collaborationUnread,
    overdueTasks,
    appointmentSoon,
    backupStale: permSet.has("settings.backup") && backupAgeHours > adminConfig.dbBackupStaleHours ? 1 : 0,
    backupStopped: permSet.has("settings.backup") && org?.autoBackup === false ? 1 : 0,
  };
  maybeAutoBackup();
  const notificationRows = await prisma.notification.findMany({
    // Unread FOR THIS USER: legacy/closed flag is false and this user has no receipt for the role-wide notice.
    where: { read: false, readReceipts: { none: { userId: uid } }, OR: [{ targetUserId: uid }, { targetRole: role }] },
    orderBy: { createdAt: "desc" },
    select: { id: true, targetRole: true, targetUserId: true, title: true, body: true, link: true, read: true, createdAt: true },
  });
  const permittedRows = notificationRows.filter((n) => canOpenNotification(n.link, permSet));
  const visibleNotificationRows = await filterRoleNoticesToPatientScope(prisma, { userId: uid, role: role as any, permissions: permSet }, permittedRows);
  const notifs = visibleNotificationRows.slice(0, 15);
  const notificationUnreadCount = visibleNotificationRows.length;

  return <AppShell role={role} name={name} alerts={alerts} perms={perms} notifs={JSON.parse(JSON.stringify(notifs))} notificationUnreadCount={notificationUnreadCount} presenceConfig={normalizePresenceConfig(adminConfig)}>{children}</AppShell>;
}
