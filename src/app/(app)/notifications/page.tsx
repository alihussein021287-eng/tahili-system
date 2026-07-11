import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { currentPerms, getSession } from "@/lib/access";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/notif-actions";
import { canOpenNotification, NOTIFICATION_KINDS, notificationKind, notificationTone } from "@/lib/notifications";
import { fmtDateTime } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const session = await getSession();
  const uid = (session?.user as any)?.id;
  const role = (session?.user as any)?.role;
  const sp = await searchParams;
  const filter = sp.filter ?? "unread";
  const perms = await currentPerms();

  const rows = await prisma.notification.findMany({
    where: {
      OR: [{ targetUserId: uid }, { targetRole: role }],
      ...(filter === "unread" ? { read: false } : {}),
      ...(filter === "read" ? { read: true } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const visible = rows.filter((n) => canOpenNotification(n.link, perms));
  const filtered = ["tasks", "appointments", "inventory", "devices", "system"].includes(filter)
    ? visible.filter((n) => notificationKind(n) === filter)
    : visible;
  const unreadCount = visible.filter((n) => !n.read).length;

  return (
    <div className="space-y-5">
      <PageHeader title="مركز التنبيهات" subtitle="إشعاراتك وإشعارات دورك مع روابط مباشرة للعمل" icon="🔔" />

      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-sm font-semibold text-gray-800">غير المقروء: {unreadCount}</div>
          <div className="mt-1 text-xs text-gray-500">لا تظهر هنا إلا الإشعارات المرتبطة بحسابك أو دورك، والروابط التي تملك صلاحية فتحها.</div>
        </div>
        {unreadCount > 0 && <form action={markAllNotificationsRead}><button className="btn-primary" type="submit">تعليم الكل كمقروء</button></form>}
      </div>

      <div className="flex flex-wrap gap-2">
        {NOTIFICATION_KINDS.map((item) => (
          <Link
            key={item.value}
            href={`/notifications?filter=${item.value}`}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${filter === item.value ? "border-brand-400 bg-brand-50 text-brand-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">لا توجد تنبيهات مطابقة لهذا الفلتر.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((n) => {
              const tone = notificationTone(n);
              return (
                <div key={n.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between ${n.read ? "bg-white" : "bg-brand-50/25"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone.className}`}>{tone.icon} {tone.label}</span>
                      {!n.read && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">غير مقروء</span>}
                      <span className="text-xs text-gray-400">{fmtDateTime(n.createdAt)}</span>
                    </div>
                    <div className="mt-2 font-semibold text-gray-900">{n.title}</div>
                    {n.body && <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-600">{n.body}</div>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {n.link && <Link href={n.link} className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">فتح الرابط</Link>}
                    {!n.read && <form action={markNotificationRead.bind(null, n.id)}><button className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50" type="submit">تعليم كمقروء</button></form>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
