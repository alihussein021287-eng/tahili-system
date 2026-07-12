import { prisma } from "@/lib/db";
import { currentPerms, getSession, requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { getReadinessChecks, type ReadinessCheck } from "@/lib/readiness";
import { getBackupOverview } from "@/lib/backup";
import { fmtDateTime } from "@/lib/labels";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Readiness() {
  await requirePerm("settings.view");
  const session = await getSession();
  const role = (session?.user as any)?.role;
  const perms = await currentPerms();
  const canSeeAudit = role === "ADMIN" || perms.has("audit.view");
  const canSeeBackup = role === "ADMIN" || perms.has("settings.backup");
  const now = new Date();
  const soon = new Date(); soon.setDate(soon.getDate() + 60);
  const last24h = new Date(now.getTime() - 24 * 3600000);
  const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
  const backupOverview = getBackupOverview();

  const [systemChecks, incompletePatients, devicesDue, rxPending, expiringSoon, lowStock, pendingLeaves, urgentTasks, admissions, officialApproval, org, failedLogins24h, successLogins24h, recentAudits] = await Promise.all([
    getReadinessChecks(),
    prisma.patient.count({ where: { archivedAt: null, OR: [{ phone: null }, { governorateId: null }, { injuryTypeId: null }] } }),
    prisma.device.count({ where: { nextMaintenanceAt: { lte: now }, status: { not: "REPLACED" } } }),
    prisma.prescription.count({ where: { isDispensed: false, prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE" } }),
    prisma.medicationBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: soon } } }),
    prisma.medication.findMany({ select: { quantity: true, minQuantity: true } }),
    prisma.leave.count({ where: { status: "PENDING" } }),
    prisma.task.count({ where: { priority: "URGENT", status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.admission.findMany({ where: { status: "ADMITTED" }, select: { admissionDate: true, durationDays: true } }),
    prisma.reportApproval.findUnique({ where: { kind_refKey: { kind: "official-monthly", refKey: monthKey } } }),
    canSeeBackup ? prisma.orgSetting.findUnique({ where: { id: 1 }, select: { autoBackup: true, lastAutoBackupAt: true } }) : Promise.resolve(null),
    canSeeAudit ? prisma.loginLog.count({ where: { success: false, createdAt: { gte: last24h } } }) : Promise.resolve(0),
    canSeeAudit ? prisma.loginLog.count({ where: { success: true, createdAt: { gte: last24h } } }) : Promise.resolve(0),
    canSeeAudit ? prisma.auditLog.findMany({
      where: { OR: [{ action: { in: ["DELETE", "UPDATE"] } }, { tableName: { in: ["users", "UserPermission", "OrgSetting", "devices", "tasks"] } }] },
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }) : Promise.resolve([]),
  ]);

  const lowCount = lowStock.filter((m: any) => (m.quantity ?? 0) <= (m.minQuantity ?? 0)).length;
  const admOver = admissions.filter((a: any) => {
    if (!a.durationDays) return false;
    const end = new Date(a.admissionDate); end.setDate(end.getDate() + a.durationDays);
    return end < now;
  }).length;

  const checks = [
    { label: "مراجعون ببيانات ناقصة (هاتف/محافظة/نوع إصابة)", count: incompletePatients, href: "/patients", fix: "أكمل بياناتهم" },
    { label: "أجهزة فات موعد صيانتها", count: devicesDue, href: "/devices?due=1", fix: "سجّل الصيانة" },
    { label: "وصفات بانتظار الصرف", count: rxPending, href: "/pharmacy", fix: "جهّز الوصفات" },
    { label: "أدوية قريبة/منتهية النفاذية", count: expiringSoon, href: "/pharmacy", fix: "راجع الدفعات" },
    { label: "مواد منخفضة بالمخزون", count: lowCount, href: "/inventory", fix: "أعد التزويد" },
    { label: "رقود انتهى وقته", count: admOver, href: "/beds", fix: "خروج أو تمديد" },
    { label: "إجازات قيد الموافقة", count: pendingLeaves, href: "/shifts", fix: "اقبل أو ارفض" },
    { label: "مهام عاجلة مفتوحة", count: urgentTasks, href: "/tasks", fix: "تابعها" },
    { label: `التقرير الرسمي لهذا الشهر غير معتمد`, count: officialApproval ? 0 : 1, href: "/reports/official", fix: "اعتمده" },
  ];
  const issues = checks.filter((c) => c.count > 0);
  const okCount = checks.length - issues.length;
  const systemIssues = systemChecks.filter((c) => c.status !== "ok");
  const systemOkCount = systemChecks.length - systemIssues.length;
  const checkByKey = new Map(systemChecks.map((c) => [c.key, c]));
  const dbCheck = checkByKey.get("database");
  const uploadsCheck = checkByKey.get("uploads");
  const backupAgeHours = backupOverview.latestDb ? (now.getTime() - backupOverview.latestDb.mtime.getTime()) / 3600000 : Infinity;
  const uploadsAgeHours = backupOverview.latestUploads ? (now.getTime() - backupOverview.latestUploads.mtime.getTime()) / 3600000 : Infinity;
  const dbBackupStale = backupAgeHours > 48;
  const uploadsBackupStale = uploadsAgeHours > 168;
  const autoBackupStopped = canSeeBackup && org?.autoBackup === false;
  const failedLoginHigh = failedLogins24h >= 10;
  const envChecks = [
    { key: "DATABASE_URL", label: "DATABASE_URL", ok: Boolean(process.env.DATABASE_URL), required: true },
    { key: "NEXTAUTH_SECRET", label: "NEXTAUTH_SECRET", ok: Boolean(process.env.NEXTAUTH_SECRET), required: true },
    { key: "REMINDER_KEY", label: "REMINDER_KEY", ok: Boolean(process.env.REMINDER_KEY), required: false },
    { key: "UPLOAD_DIR", label: "UPLOAD_DIR", ok: Boolean(process.env.UPLOAD_DIR), required: false },
    { key: "MINIO", label: "MINIO_*", ok: Boolean(process.env.MINIO_ENDPOINT || process.env.MINIO_ACCESS_KEY || process.env.MINIO_SECRET_KEY), required: false },
  ];
  const actions = [
    !backupOverview.latestDb || dbBackupStale ? { label: "لا توجد نسخة قاعدة بيانات حديثة", detail: backupOverview.latestDb ? "آخر نسخة أقدم من 48 ساعة." : "لا توجد نسخة قاعدة بيانات.", href: "/backup", perm: "settings.backup" } : null,
    !backupOverview.latestUploads || uploadsBackupStale ? { label: "نسخة uploads غير حديثة", detail: backupOverview.latestUploads ? "آخر نسخة مرفقات أقدم من 7 أيام." : "لا توجد نسخة مرفقات.", href: "/backup", perm: "settings.backup" } : null,
    autoBackupStopped ? { label: "النسخ التلقائي متوقف", detail: "فعّل النسخ التلقائي اليومي من صفحة النسخ الاحتياطي.", href: "/backup", perm: "settings.backup" } : null,
    failedLoginHigh ? { label: "محاولات دخول فاشلة مرتفعة", detail: `${failedLogins24h} محاولة فاشلة خلال آخر 24 ساعة.`, href: "/login-log", perm: "audit.view" } : null,
    !process.env.REMINDER_KEY ? { label: "REMINDER_KEY غير موجود", detail: "تذكيرات cron لن تعمل بدون هذا المفتاح.", href: "/readiness", perm: "settings.view" } : null,
    !process.env.NEXTAUTH_SECRET ? { label: "NEXTAUTH_SECRET غير موجود", detail: "هذا متغير أساسي للجلسات ويجب ضبطه.", href: "/readiness", perm: "settings.view" } : null,
  ].filter((a): a is { label: string; detail: string; href: string; perm: string } => Boolean(a))
    .filter((a) => a.perm !== "settings.backup" || canSeeBackup)
    .filter((a) => a.perm !== "audit.view" || canSeeAudit);

  return (
    <div className="space-y-5">
      <PageHeader title="جاهزية النظام" subtitle="فحص بنية التشغيل والبيانات المعلّقة" icon="✅" />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <HealthCard title="قاعدة البيانات" value={dbCheck?.status === "ok" ? "متصلة" : "تحتاج متابعة"} detail={dbCheck?.detail ?? "غير مفحوصة"} tone={dbCheck?.status === "ok" ? "ok" : "fail"} />
        <HealthCard title="uploads" value={uploadsCheck?.status === "ok" ? "قابل للكتابة" : "تحتاج متابعة"} detail={uploadsCheck?.detail ?? "غير مفحوص"} tone={uploadsCheck?.status === "ok" ? "ok" : "warn"} />
        <div className={`card p-4 ${backupOverview.latestDb ? "" : "ring-1 ring-amber-200"}`}>
          <div className="text-xs font-medium text-gray-500">آخر نسخة قاعدة بيانات</div>
          <div className="mt-2 break-all text-sm font-bold text-gray-900">{backupOverview.latestDb?.name ?? "لا توجد نسخة"}</div>
          <div className="mt-1 text-xs text-gray-500">{backupOverview.latestDb ? `${Math.ceil(backupOverview.latestDb.size / 1024)} KB · ${backupOverview.latestDb.location === "app" ? "واجهة التطبيق" : "سكربت السيرفر"} · ${ageLabel(backupOverview.latestDb.mtime)}` : "راجع صفحة النسخ الاحتياطي"}</div>
        </div>
        <div className={`card p-4 ${backupOverview.latestUploads ? "" : "ring-1 ring-amber-200"}`}>
          <div className="text-xs font-medium text-gray-500">آخر نسخة مرفقات uploads</div>
          <div className="mt-2 break-all text-sm font-bold text-gray-900">{backupOverview.latestUploads?.name ?? "لا توجد نسخة مرفقات"}</div>
          <div className="mt-1 text-xs text-gray-500">{backupOverview.latestUploads ? `${Math.ceil(backupOverview.latestUploads.size / 1024)} KB · /tahili-system/backups · ${ageLabel(backupOverview.latestUploads.mtime)}` : "زر الواجهة لا ينسخ المرفقات؛ استخدم backup.sh"}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <HealthCard title="النسخ التلقائي" value={!canSeeBackup ? "مخفي" : org?.autoBackup ? "مفعّل" : "متوقف"} detail={!canSeeBackup ? "يتطلب صلاحية النسخ الاحتياطي." : org?.lastAutoBackupAt ? `آخر تشغيل: ${fmtDateTime(org.lastAutoBackupAt)}` : "لا يوجد تشغيل تلقائي مسجل"} tone={!canSeeBackup ? "neutral" : org?.autoBackup ? "ok" : "warn"} href={canSeeBackup ? "/backup" : undefined} />
        <HealthCard title="دخول فاشل آخر 24 ساعة" value={canSeeAudit ? String(failedLogins24h) : "مخفي"} detail={canSeeAudit ? `نجاح: ${successLogins24h} · فشل: ${failedLogins24h}` : "يتطلب صلاحية audit.view أو ADMIN."} tone={!canSeeAudit ? "neutral" : failedLoginHigh ? "fail" : failedLogins24h > 0 ? "warn" : "ok"} href={canSeeAudit ? "/login-log?f=fail" : undefined} />
        <HealthCard title="متغيرات البيئة" value={`${envChecks.filter((e) => e.ok).length}/${envChecks.length}`} detail="يعرض حالة الوجود فقط بدون قيم." tone={envChecks.some((e) => e.required && !e.ok) ? "fail" : envChecks.some((e) => !e.ok) ? "warn" : "ok"} />
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-gray-800">إجراءات مقترحة</div>
            <div className="mt-1 text-xs text-gray-500">أولويات تشغيلية مبنية على حالة النسخ، الدخول، والمتغيرات.</div>
          </div>
          {actions.length === 0 && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">لا توجد إجراءات عاجلة</span>}
        </div>
        {actions.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {actions.map((a) => (
              <Link key={a.label} href={a.href} className="rounded-xl border border-amber-200 bg-amber-50 p-3 transition hover:bg-amber-100">
                <div className="font-medium text-amber-900">{a.label}</div>
                <div className="mt-1 text-xs leading-5 text-amber-800">{a.detail}</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b px-4 py-3">
            <div className="font-semibold text-gray-800">حالة متغيرات البيئة</div>
            <div className="mt-1 text-xs text-gray-500">لا يتم عرض أي قيمة فعلية.</div>
          </div>
          <div className="divide-y divide-gray-100">
            {envChecks.map((env) => (
              <div key={env.key} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-mono text-sm text-gray-800">{env.label}</div>
                  <div className="mt-1 text-xs text-gray-500">{env.required ? "أساسي" : "اختياري/تشغيلي"}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${env.ok ? "bg-emerald-50 text-emerald-700" : env.required ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{env.ok ? "موجود" : "غير موجود"}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b px-4 py-3">
            <div className="font-semibold text-gray-800">آخر عمليات audit المهمة</div>
            <div className="mt-1 text-xs text-gray-500">{canSeeAudit ? "تحديثات وحذف وعمليات على المستخدمين والإعدادات." : "مخفية لغير الأدمن أو من لا يملك audit.view."}</div>
          </div>
          {!canSeeAudit ? (
            <div className="p-6 text-center text-sm text-gray-400">لا تملك صلاحية عرض تفاصيل التدقيق.</div>
          ) : recentAudits.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">لا توجد عمليات مهمة حديثة.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentAudits.map((a) => (
                <div key={a.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{a.action}</span>
                    <span className="font-mono text-xs text-gray-500">{a.tableName}</span>
                    <span className="text-xs text-gray-400">{fmtDateTime(a.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-700">{a.user?.fullName || a.user?.username || "نظام"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`card flex items-center gap-4 p-5 ${systemIssues.length === 0 ? "bg-emerald-50" : ""}`}>
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl text-white ${systemIssues.length === 0 ? "bg-emerald-600" : "bg-amber-500"}`}>
          {systemIssues.length === 0 ? "✓" : systemIssues.length}
        </div>
        <div>
          <div className="text-lg font-bold text-gray-800">
            {systemIssues.length === 0 ? "أساس النظام جاهز" : `${systemIssues.length} فحص بنية يحتاج متابعة`}
          </div>
          <div className="text-sm text-gray-500">{systemOkCount} من {systemChecks.length} فحوصات بنية سليمة.</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {systemChecks.map((c) => <SystemCheckCard key={c.key} check={c} />)}
      </div>

      <div className={`card flex items-center gap-4 p-5 ${issues.length === 0 ? "bg-emerald-50" : ""}`}>
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl text-white ${issues.length === 0 ? "bg-emerald-600" : "bg-amber-500"}`}>
          {issues.length === 0 ? "✓" : issues.length}
        </div>
        <div>
          <div className="text-lg font-bold text-gray-800">
            {issues.length === 0 ? "لا توجد أمور تشغيلية معلّقة" : `${issues.length} أمور تشغيلية بحاجة متابعة`}
          </div>
          <div className="text-sm text-gray-500">هذه مؤشرات عمل يومية وليست أخطاء تقنية. {okCount} من {checks.length} فحوصات تشغيلية سليمة.</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {checks.map((c) => (
          <div key={c.label} className={`card flex items-center justify-between gap-3 p-4 ${c.count > 0 ? "ring-1 ring-amber-200" : ""}`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${c.count > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                {c.count > 0 ? c.count : "✓"}
              </span>
              <span className="text-sm text-gray-700">{c.label}</span>
            </div>
            {c.count > 0 && <Link href={c.href} className="shrink-0 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">{c.fix} ←</Link>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ageLabel(date: Date) {
  const hours = Math.floor((Date.now() - date.getTime()) / 3600000);
  if (hours < 1) return "قبل أقل من ساعة";
  if (hours < 24) return `قبل ${hours} ساعة`;
  return `قبل ${Math.floor(hours / 24)} يوم`;
}

function HealthCard({ title, value, detail, tone, href }: { title: string; value: string; detail: string; tone: "ok" | "warn" | "fail" | "neutral"; href?: string }) {
  const cls = tone === "ok" ? "border-emerald-100 bg-emerald-50 text-emerald-800"
    : tone === "fail" ? "border-red-100 bg-red-50 text-red-800"
      : tone === "warn" ? "border-amber-100 bg-amber-50 text-amber-800"
        : "border-gray-100 bg-white text-gray-800";
  const body = (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="text-xs font-medium opacity-80">{title}</div>
      <div className="mt-2 text-lg font-bold">{value}</div>
      <div className="mt-1 text-xs leading-5 opacity-80">{detail}</div>
    </div>
  );
  return href ? <Link href={href} className="block transition hover:brightness-95">{body}</Link> : body;
}

function SystemCheckCard({ check }: { check: ReadinessCheck }) {
  const style = check.status === "ok"
    ? { ring: "", icon: "✓", iconClass: "bg-emerald-100 text-emerald-700", title: "text-gray-800" }
    : check.status === "warn"
      ? { ring: "ring-1 ring-amber-200", icon: "!", iconClass: "bg-amber-100 text-amber-700", title: "text-amber-800" }
      : { ring: "ring-1 ring-red-200", icon: "×", iconClass: "bg-red-100 text-red-700", title: "text-red-800" };

  return (
    <div className={`card flex items-start justify-between gap-3 p-4 ${style.ring}`}>
      <div className="flex min-w-0 gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${style.iconClass}`}>{style.icon}</span>
        <div className="min-w-0">
          <div className={`font-medium ${style.title}`}>{check.label}</div>
          <div className="mt-1 text-sm text-gray-500">{check.detail}</div>
        </div>
      </div>
      {check.href && check.action && (
        <Link href={check.href} className="shrink-0 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">{check.action} ←</Link>
      )}
    </div>
  );
}
