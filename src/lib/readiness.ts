import { prisma } from "@/lib/db";
import { ALL_PERMS } from "@/lib/perms";
import { getBackupOverview } from "@/lib/backup";
import { getAdminConfig, type AdminConfig } from "@/lib/admin-config";
import { checkClamAvStatus } from "@/lib/collaboration-scan";
import { getLibreOfficeStatus } from "@/lib/collaboration-office-preview";
import { isBackupStale, readinessDiskStatus } from "@/lib/readiness-config";
import { statfsSync } from "fs";
import fs from "fs/promises";
import path from "path";

export type ReadinessStatus = "ok" | "warn" | "fail";

export type ReadinessCheck = {
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  action?: string;
  href?: string;
};

function ok(key: string, label: string, detail: string): ReadinessCheck {
  return { key, label, status: "ok", detail };
}

function warn(key: string, label: string, detail: string, action?: string, href?: string): ReadinessCheck {
  return { key, label, status: "warn", detail, action, href };
}

function fail(key: string, label: string, detail: string, action?: string, href?: string): ReadinessCheck {
  return { key, label, status: "fail", detail, action, href };
}

function ageLabel(date: Date) {
  const hours = Math.floor((Date.now() - date.getTime()) / 3600000);
  if (hours < 1) return "قبل أقل من ساعة";
  if (hours < 24) return `قبل ${hours} ساعة`;
  return `قبل ${Math.floor(hours / 24)} يوم`;
}

async function checkUploads() {
  const uploadDir = process.env.UPLOAD_DIR || "uploads";
  const probe = path.join(uploadDir, `.readiness-${Date.now()}.tmp`);
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);
    return ok("uploads", "التخزين المحلي للمرفقات", `مجلد uploads قابل للكتابة: ${uploadDir}`);
  } catch (e: any) {
    return fail("uploads", "التخزين المحلي للمرفقات", e?.message || "تعذر الكتابة في مجلد uploads", "راجع صلاحيات المجلد أو volume", "/backup");
  }
}

async function checkMinio() {
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY || process.env.MINIO_USER;
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_PASSWORD;
  if (!endpoint && !accessKey && !secretKey) {
    return warn("minio", "MinIO", "لا توجد متغيرات MinIO فعّالة داخل التطبيق؛ النظام يستخدم uploads المحلي حالياً.");
  }
  if (endpoint && accessKey && secretKey) {
    return ok("minio", "MinIO", `إعدادات MinIO موجودة للوجهة: ${endpoint}`);
  }
  return warn("minio", "MinIO", "إعدادات MinIO ناقصة.", "أكمل MINIO_ENDPOINT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY");
}

async function checkLastBackup(config: AdminConfig) {
  const latest = getBackupOverview().latestDb;
  if (!latest) {
    return warn("backup", "آخر نسخة احتياطية", "لم يتم العثور على نسخة قاعدة بيانات.", "شغّل backup.sh أو أنشئ نسخة من صفحة النسخ الاحتياطي", "/backup");
  }
  const stale = isBackupStale(latest.mtime, config.dbBackupStaleHours);
  const source = latest.location === "app" ? "واجهة التطبيق" : "سكربت السيرفر";
  const detail = `${latest.name} (${Math.ceil(latest.size / 1024)} KB) - ${ageLabel(latest.mtime)} - ${source}`;
  return stale ? warn("backup", "آخر نسخة احتياطية", detail, "أنشئ نسخة جديدة", "/backup") : ok("backup", "آخر نسخة احتياطية", detail);
}

async function checkUploadsBackup(config: AdminConfig) {
  const latest = getBackupOverview().latestUploads;
  if (!latest) {
    return warn("uploadsBackup", "آخر نسخة مرفقات uploads", "لم يتم العثور على نسخة مرفقات.", "شغّل backup.sh لنسخ uploads", "/backup");
  }
  const stale = isBackupStale(latest.mtime, config.uploadsBackupStaleHours);
  const detail = `${latest.name} (${Math.ceil(latest.size / 1024)} KB) - ${ageLabel(latest.mtime)} - سكربت السيرفر`;
  return stale ? warn("uploadsBackup", "آخر نسخة مرفقات uploads", detail, "أنشئ نسخة مرفقات جديدة", "/backup") : ok("uploadsBackup", "آخر نسخة مرفقات uploads", detail);
}

async function checkDisk(config: AdminConfig) {
  try {
    const disk = statfsSync(process.cwd());
    const total = disk.blocks * disk.bsize;
    const free = disk.bavail * disk.bsize;
    if (total <= 0) return warn("disk", "مساحة القرص", "تعذر حساب الحجم الكلي للقرص.");
    const usedPercent = ((total - free) / total) * 100;
    const status = readinessDiskStatus(usedPercent, config);
    const detail = `${Math.round(usedPercent)}% مستخدم. التحذير عند ${config.diskWarnPercent}% والخطر عند ${config.diskCriticalPercent}%.`;
    if (status === "fail") return fail("disk", "مساحة القرص", detail, "حرر مساحة أو وسّع القرص");
    if (status === "warn") return warn("disk", "مساحة القرص", detail, "راقب المساحة المتبقية");
    return ok("disk", "مساحة القرص", detail);
  } catch (e: any) {
    return warn("disk", "مساحة القرص", e?.message || "تعذر فحص مساحة القرص.");
  }
}

async function checkAutoBackup() {
  const org = await prisma.orgSetting.findUnique({ where: { id: 1 }, select: { autoBackup: true, lastAutoBackupAt: true } });
  if (!org?.autoBackup) {
    return warn("autoBackup", "النسخ التلقائي", "النسخ التلقائي متوقف.", "فعّل النسخ التلقائي", "/backup");
  }
  if (!org.lastAutoBackupAt) {
    return warn("autoBackup", "النسخ التلقائي", "مفعّل لكن لا يوجد تاريخ تشغيل مسجل بعد.", "أنشئ نسخة الآن أو انتظر التشغيل اليومي", "/backup");
  }
  const stale = Date.now() - org.lastAutoBackupAt.getTime() > 30 * 3600000;
  const detail = `آخر تشغيل تلقائي ${ageLabel(org.lastAutoBackupAt)}`;
  return stale ? warn("autoBackup", "النسخ التلقائي", detail, "راجع سبب عدم التشغيل", "/backup") : ok("autoBackup", "النسخ التلقائي", detail);
}

async function checkPermissions() {
  const core = ["dashboard.view", "settings.view", "users.view", "users.manage", "settings.backup", "patients.view"];
  const missingCatalog = core.filter((key) => !ALL_PERMS.includes(key));
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  const explicit = admin ? await prisma.userPermission.count({ where: { userId: admin.id } }) : 0;
  if (missingCatalog.length) {
    return fail("permissions", "الصلاحيات الأساسية", `مفاتيح ناقصة من الكتالوج: ${missingCatalog.join(", ")}`, "راجع lib/perms.ts", "/permissions");
  }
  if (!admin) {
    return fail("permissions", "الصلاحيات الأساسية", "لا يوجد مدير نظام فعّال.", "أنشئ أو فعّل حساب admin", "/users");
  }
  return ok("permissions", "الصلاحيات الأساسية", explicit > 0 ? "كتالوج الصلاحيات موجود والمدير لديه استثناءات مخصصة." : "كتالوج الصلاحيات موجود ودور ADMIN يملك كل الصلاحيات افتراضياً.");
}

async function checkClamAv(config: AdminConfig) {
  const status = await checkClamAvStatus(Math.min(3, config.clamavScanTimeoutSeconds));
  if (status.available) return ok("clamav", "ClamAV", `متاح: ${status.detail}`);
  const detail = `غير متاح: ${status.detail}`;
  return config.requireClamav
    ? fail("clamav", "ClamAV", detail, "راجع حاوية الفحص أو إعدادات الشبكة الداخلية")
    : warn("clamav", "ClamAV", detail, "الفحص غير إلزامي حسب إعدادات الجاهزية");
}

async function checkLibreOffice(config: AdminConfig) {
  const status = await getLibreOfficeStatus();
  if (status.available) return ok("libreoffice", "LibreOffice", status.version ? `متاح: ${status.version}` : "متاح.");
  return config.requireLibreOffice
    ? fail("libreoffice", "LibreOffice", "غير متاح داخل بيئة التطبيق.", "تأكد أن Docker image تحتوي LibreOffice")
    : warn("libreoffice", "LibreOffice", "غير متاح داخل بيئة التطبيق.", "معاينة Office اختيارية حسب إعدادات الجاهزية");
}

export async function getReadinessChecks(): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const config = await getAdminConfig();

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push(ok("database", "اتصال قاعدة البيانات", "PostgreSQL يستجيب للاستعلامات."));
  } catch (e: any) {
    checks.push(fail("database", "اتصال قاعدة البيانات", e?.message || "تعذر الاتصال بقاعدة البيانات", "راجع DATABASE_URL وحاوية postgres"));
  }

  const activeAdmin = await prisma.user.findFirst({ where: { username: "admin", isActive: true }, select: { id: true } }).catch(() => null);
  checks.push(process.env.NEXTAUTH_SECRET ? ok("nextauth", "NEXTAUTH_SECRET", "موجود.") : fail("nextauth", "NEXTAUTH_SECRET", "غير موجود.", "أضفه إلى .env"));
  if (!activeAdmin) {
    checks.push(process.env.ADMIN_INITIAL_PASSWORD ? ok("adminInitialPassword", "ADMIN_INITIAL_PASSWORD", "موجود لأن admin غير مفعّل بعد.") : fail("adminInitialPassword", "ADMIN_INITIAL_PASSWORD", "مطلوب عند عدم وجود admin فعّال.", "أضفه إلى .env قبل seed"));
  }
  checks.push(process.env.REMINDER_KEY ? ok("reminderKey", "REMINDER_KEY", "موجود.") : warn("reminderKey", "REMINDER_KEY", "غير موجود؛ تذكيرات cron لن تعمل.", "أضفه إلى .env"));

  checks.push(await checkUploads());
  checks.push(await checkMinio());
  checks.push(await checkDisk(config));
  checks.push(await checkLastBackup(config));
  checks.push(await checkUploadsBackup(config));
  checks.push(await checkAutoBackup());
  checks.push(await checkPermissions());
  checks.push(await checkClamAv(config));
  checks.push(await checkLibreOffice(config));

  return checks;
}
