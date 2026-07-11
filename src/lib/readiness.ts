import { prisma } from "@/lib/db";
import { ALL_PERMS } from "@/lib/perms";
import { getBackupOverview } from "@/lib/backup";
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

async function checkLastBackup() {
  const latest = getBackupOverview().latestDb;
  if (!latest) {
    return warn("backup", "آخر نسخة احتياطية", "لم يتم العثور على نسخة قاعدة بيانات.", "شغّل backup.sh أو أنشئ نسخة من صفحة النسخ الاحتياطي", "/backup");
  }
  const stale = Date.now() - latest.mtime.getTime() > 48 * 3600000;
  const source = latest.location === "app" ? "واجهة التطبيق" : "سكربت السيرفر";
  const detail = `${latest.name} (${Math.ceil(latest.size / 1024)} KB) - ${ageLabel(latest.mtime)} - ${source}`;
  return stale ? warn("backup", "آخر نسخة احتياطية", detail, "أنشئ نسخة جديدة", "/backup") : ok("backup", "آخر نسخة احتياطية", detail);
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

export async function getReadinessChecks(): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];

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
  checks.push(await checkLastBackup());
  checks.push(await checkAutoBackup());
  checks.push(await checkPermissions());

  return checks;
}
