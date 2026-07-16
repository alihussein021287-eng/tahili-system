import { requireSession } from "@/lib/access";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { prisma } from "@/lib/db";
import { getBackupOverview, maybeAutoBackup } from "@/lib/backup";
import { loadPerms } from "@/lib/access";
import { canOpenNotification } from "@/lib/notifications";
import { collaborationUnreadCount } from "@/lib/collaboration-service";
import { getAdminConfig } from "@/lib/admin-config";
import { normalizePresenceConfig } from "@/lib/presence";

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
  const soon = new Date(); soon.setDate(soon.getDate() + 60);
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const [admitted, devicesDue, meds, rxPending, expiringSoon, myTasks, overdueTasks, appointmentSoon, org, collaborationUnread, adminConfig] = await Promise.all([
    prisma.admission.findMany({ where: { status: "ADMITTED" }, select: { admissionDate: true, durationDays: true } }),
    prisma.device.count({ where: { nextMaintenanceAt: { lte: now }, status: { not: "REPLACED" } } }),
    prisma.medication.findMany({ select: { quantity: true, minQuantity: true } }),
    prisma.prescription.count({ where: { isDispensed: false, status: { not: "REJECTED" }, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE" } }),
    prisma.medicationBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: soon } } }),
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
  const notifs = (await prisma.notification.findMany({ where: { read: false, OR: [{ targetUserId: uid }, { targetRole: role }] }, orderBy: { createdAt: "desc" }, take: 30 }))
    .filter((n) => canOpenNotification(n.link, permSet))
    .slice(0, 15);

  return <AppShell role={role} name={name} alerts={alerts} perms={perms} notifs={JSON.parse(JSON.stringify(notifs))} presenceConfig={normalizePresenceConfig(adminConfig)}>{children}</AppShell>;
}
