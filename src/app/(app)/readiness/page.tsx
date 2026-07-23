import { prisma } from "@/lib/db";
import { currentPerms, getSession, requirePerm } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { getReadinessChecks, type ReadinessCheck } from "@/lib/readiness";
import { readinessDiskStatus } from "@/lib/readiness-config";
import { getBackupOverview } from "@/lib/backup";
import { fmtDateTime } from "@/lib/labels";
import Link from "next/link";
import { getSystemStatus } from "@/lib/system-status";
import { getAdminConfig } from "@/lib/admin-config";

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
  const systemStatus = await getSystemStatus();

  const [systemChecks, incompletePatients, devicesDue, rxPending, expiringSoon, lowStock, pendingLeaves, urgentTasks, admissions, officialApproval, org, failedLogins24h, successLogins24h, recentAudits, adminConfig] = await Promise.all([
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
    canSeeBackup ? prisma.orgSetting.findUnique({ where: { id: 1 }, select: { name: true, address: true, phone: true, autoBackup: true, lastAutoBackupAt: true, officialHeader1: true, officialHeader2: true, officialHeader3: true, officialHeader4: true, officialAddress: true, officialPhone: true } }) : Promise.resolve(null),
    canSeeAudit ? prisma.loginLog.count({ where: { success: false, createdAt: { gte: last24h } } }) : Promise.resolve(0),
    canSeeAudit ? prisma.loginLog.count({ where: { success: true, createdAt: { gte: last24h } } }) : Promise.resolve(0),
    canSeeAudit ? prisma.auditLog.findMany({
      where: { OR: [{ action: { in: ["DELETE", "UPDATE"] } }, { tableName: { in: ["users", "UserPermission", "OrgSetting", "devices", "tasks"] } }] },
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }) : Promise.resolve([]),
    getAdminConfig(),
  ]);

  const lowCount = lowStock.filter((m: any) => (m.quantity ?? 0) <= (m.minQuantity ?? 0)).length;
  const admOver = admissions.filter((a: any) => {
    if (!a.durationDays) return false;
    const end = new Date(a.admissionDate); end.setDate(end.getDate() + a.durationDays);
    return end < now;
  }).length;
  const setupData = role === "ADMIN" ? await Promise.all([
    prisma.branch.count({ where: { isActive: true } }),
    prisma.center.count({ where: { active: true } }),
    prisma.therapyHall.count({ where: { active: true } }),
    prisma.user.groupBy({ by: ["role"], where: { isActive: true, needsActivation: false }, _count: { _all: true } }),
    prisma.rolePermission.count(),
    prisma.medication.count(),
    prisma.medicationBatch.count({ where: { quantity: { gt: 0 } } }),
  ]) : null;
  const systemCheckMap = new Map(systemChecks.map((check) => [check.key, check]));
  const roleCounts = new Map((setupData?.[3] ?? []).map((item) => [item.role, item._count._all]));
  const essentialRoles = ["RECEPTION", "RESIDENT", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "PHARMACIST", "ACCOUNTANT"] as const;
  const missingEssentialRoles = essentialRoles.filter((item) => !roleCounts.get(item));
  const setupChecklist = role === "ADMIN" && setupData ? [
    { label: "الفروع", complete: setupData[0] > 0, detail: setupData[0] > 0 ? `${setupData[0]} فرع فعّال` : "لا يوجد فرع فعّال", href: "/settings?tab=branches" },
    { label: "المراكز والقاعات", complete: setupData[1] > 0 && setupData[2] > 0, detail: `${setupData[1]} مركز · ${setupData[2]} قاعة فعالة`, href: "/settings?tab=centers" },
    { label: "مستخدمو الأدوار الأساسية", complete: missingEssentialRoles.length === 0, detail: missingEssentialRoles.length ? `ينقص: ${missingEssentialRoles.join("، ")}` : "كل الأدوار التشغيلية الأساسية ممثلة بحساب فعّال", href: "/users" },
    { label: "الصلاحيات الأساسية", complete: systemCheckMap.get("permissions")?.status === "ok", detail: setupData[4] > 0 ? `${setupData[4]} تخصيص دور مخزن، مع بقاء القوالب البرمجية مرجعاً` : "القوالب البرمجية فعالة ولا توجد تخصيصات دور مخزنة", href: "/permissions" },
    { label: "كتالوج الأدوية", complete: setupData[5] > 0, detail: `${setupData[5]} مادة في الكتالوج`, href: "/pharmacy-inventory?tab=stock" },
    { label: "المخزون الفعلي", complete: setupData[6] > 0, detail: setupData[6] > 0 ? `${setupData[6]} دفعة برصيد فعلي` : "صفر دفعات برصيد فعلي؛ وجود الكتالوج لا يعد مخزوناً", href: "/pharmacy-inventory?tab=batches" },
    { label: "إعداد النسخ", complete: Boolean(org?.autoBackup && systemCheckMap.get("backup")?.status === "ok"), detail: org?.autoBackup ? (systemCheckMap.get("backup")?.detail ?? "النسخ مفعّل") : "النسخ التلقائي غير مفعّل", href: "/backup" },
    { label: "ClamAV", complete: systemCheckMap.get("clamav")?.status === "ok", detail: systemCheckMap.get("clamav")?.detail ?? "غير مفحوص", href: "/readiness" },
    { label: "LibreOffice", complete: systemCheckMap.get("libreoffice")?.status === "ok", detail: systemCheckMap.get("libreoffice")?.detail ?? "غير مفحوص", href: "/readiness" },
    { label: "الهوية والطباعة", complete: Boolean(org?.name && (org.officialHeader1 || org.officialHeader2 || org.officialHeader3 || org.officialHeader4)), detail: org?.name ? "اسم المؤسسة موجود؛ راجع اكتمال ترويسة المطبوعات" : "اسم المؤسسة أو ترويسة المطبوعات ناقصة", href: "/settings?tab=identity" },
    { label: "بيانات التواصل", complete: Boolean(org?.address && org?.phone), detail: org?.address && org?.phone ? "العنوان والهاتف موجودان" : "العنوان أو الهاتف الأساسي ناقص", href: "/settings?tab=identity" },
  ] : [];

  const checks = [
    { label: "مراجعون ببيانات ناقصة (هاتف/محافظة/نوع إصابة)", count: incompletePatients, href: "/patients-care?tab=alerts", fix: "أكمل بياناتهم" },
    { label: "أجهزة فات موعد صيانتها", count: devicesDue, href: "/devices?due=1", fix: "سجّل الصيانة" },
    { label: "وصفات بانتظار الصرف", count: rxPending, href: "/pharmacy-inventory?tab=dispense", fix: "جهّز الوصفات" },
    { label: "أدوية قريبة/منتهية النفاذية", count: expiringSoon, href: "/pharmacy-inventory?tab=batches&batchState=soon", fix: "راجع الدفعات" },
    { label: "مواد منخفضة بالمخزون", count: lowCount, href: "/pharmacy-inventory?tab=stock&stockState=low", fix: "أعد التزويد" },
    { label: "رقود انتهى وقته", count: admOver, href: "/therapy-centers?tab=beds", fix: "خروج أو تمديد" },
    { label: "إجازات قيد الموافقة", count: pendingLeaves, href: "/staff?tab=leaves", fix: "اقبل أو ارفض" },
    { label: "مهام عاجلة مفتوحة", count: urgentTasks, href: "/staff?tab=tasks&priority=URGENT", fix: "تابعها" },
    { label: `التقرير الرسمي لهذا الشهر غير معتمد`, count: officialApproval ? 0 : 1, href: "/reports-finance?tab=official", fix: "اعتمده" },
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
  const dbBackupStale = backupAgeHours > adminConfig.dbBackupStaleHours;
  const uploadsBackupStale = uploadsAgeHours > adminConfig.uploadsBackupStaleHours;
  const diskUsedPercent = systemStatus.disk.total > 0 ? ((systemStatus.disk.total - systemStatus.disk.free) / systemStatus.disk.total) * 100 : 0;
  const diskTone = readinessDiskStatus(diskUsedPercent, adminConfig);
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
    !backupOverview.latestDb || dbBackupStale ? { label: "لا توجد نسخة قاعدة بيانات حديثة", detail: backupOverview.latestDb ? `آخر نسخة أقدم من ${adminConfig.dbBackupStaleHours} ساعة.` : "لا توجد نسخة قاعدة بيانات.", href: "/backup", perm: "settings.backup" } : null,
    !backupOverview.latestUploads || uploadsBackupStale ? { label: "نسخة uploads غير حديثة", detail: backupOverview.latestUploads ? `آخر نسخة مرفقات أقدم من ${adminConfig.uploadsBackupStaleHours} ساعة.` : "لا توجد نسخة مرفقات.", href: "/backup", perm: "settings.backup" } : null,
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3 text-sm">
        <div>آخر فحص: {new Date(systemStatus.checkedAt).toLocaleString("ar-IQ")} · commit: <span className="font-mono">{systemStatus.commit}</span> · image: <span className="font-mono">{systemStatus.image}</span></div>
        <div className="flex gap-2"><Link href="/readiness" className="btn-ghost">إعادة الفحص</Link><a href="/api/readiness/report" className="btn-primary">تنزيل تقرير الجاهزية</a></div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <HealthCard title="migrations" value={systemStatus.migrations.pendingOrFailed ? "غير متطابقة" : "متطابقة"} detail={`${systemStatus.migrations.count} · ${systemStatus.migrations.latest}`} tone={systemStatus.migrations.pendingOrFailed ? "fail" : "ok"} />
        <HealthCard title="مساحة القرص" value={`${Math.round(systemStatus.disk.free / 1073741824)} GB متاح`} detail={`${Math.round(diskUsedPercent)}% مستخدم من ${Math.round(systemStatus.disk.total / 1073741824)} GB`} tone={diskTone} />
        <HealthCard title="الذاكرة" value={`${Math.round(systemStatus.memory.free / 1048576)} MB متاح`} detail={`وقت التشغيل ${Math.round(systemStatus.uptimeSeconds / 60)} دقيقة`} tone="neutral" />
        <HealthCard title="الخدمات" value="app + PostgreSQL" detail={`MinIO: ${systemStatus.services.minio} · Caddy: ${systemStatus.services.caddy}`} tone="neutral" />
      </div>

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

      {role === "ADMIN" ? (
        <section className="card overflow-hidden" aria-labelledby="system-setup-title">
          <div className="border-b px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="system-setup-title" className="font-semibold text-gray-800">اكتمال إعداد النظام</h2>
                <p className="mt-1 text-xs text-gray-500">قراءة مباشرة للبيانات والخدمات الحالية؛ لا ينشئ هذا الفحص أي بيانات تلقائياً.</p>
              </div>
              <span className="badge-brand">{setupChecklist.filter((item) => item.complete).length}/{setupChecklist.length} مكتمل</span>
            </div>
          </div>
          <div className="grid gap-px bg-gray-100 sm:grid-cols-2">
            {setupChecklist.map((item) => (
              <Link key={item.label} href={item.href} className="flex items-start gap-3 bg-white p-4 transition hover:bg-gray-50">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${item.complete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{item.complete ? "✓" : "!"}</span>
                <span><span className="block font-medium text-gray-800">{item.label}</span><span className="mt-1 block text-xs leading-5 text-gray-500">{item.detail}</span></span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

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
