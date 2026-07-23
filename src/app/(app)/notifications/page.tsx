import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { currentPerms, getSession } from "@/lib/access";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/notif-actions";
import { canOpenNotification, groupNotifications, NOTIFICATION_KINDS, notificationKind, notificationTone } from "@/lib/notifications";
import { fmtDateTime } from "@/lib/labels";
import { EmptyState, PageTabs } from "@/components/Ui";

export const dynamic = "force-dynamic";

const KIND_FILTERS = new Set(
  NOTIFICATION_KINDS.map((item) => item.value).filter((value) => !["all", "unread", "read"].includes(value)),
);

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
  const filtered = KIND_FILTERS.has(filter)
    ? visible.filter((n) => notificationKind(n) === filter)
    : visible;
  const grouped = groupNotifications(filtered);
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

      <PageTabs active={filter} label="فلاتر التنبيهات" tabs={NOTIFICATION_KINDS.map((item) => ({ key: item.value, href: `/notifications?filter=${item.value}`, label: item.label }))} />

      <div className="card overflow-hidden">
        {grouped.length === 0 ? (
          <EmptyState title="لا توجد تنبيهات مطابقة" description="جرّب فلتر الكل أو ستظهر التنبيهات الجديدة هنا عند وصولها." />
        ) : (
          <div className="divide-y divide-gray-100">
            {grouped.map((n) => {
              const tone = notificationTone(n);
              const bucket = n.bucket === "urgent"
                ? { label: "عاجل", className: "bg-red-50 text-red-700" }
                : n.bucket === "action"
                  ? { label: "يحتاج إجراء", className: "bg-amber-50 text-amber-700" }
                  : { label: "معلومات", className: "bg-slate-100 text-slate-600" };
              return (
                <div key={n.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between ${n.read ? "bg-white" : "bg-brand-50/25"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone.className}`}>{tone.icon} {tone.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${bucket.className}`}>{bucket.label}</span>
                      {n.groupedCount > 1 ? <span className="badge-neutral">{n.groupedCount} متشابهة</span> : null}
                      {!n.read && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">غير مقروء</span>}
                      <span className="text-xs text-gray-400">{fmtDateTime(n.createdAt)}</span>
                    </div>
                    <div className="mt-2 font-semibold text-gray-900">{n.title}</div>
                    {n.body && <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-600">{n.body}</div>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {n.canonicalLink && <Link href={n.canonicalLink} className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">فتح الرابط</Link>}
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
