import { prisma } from "./db";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const runFile = promisify(execFile);
export const BACKUP_DIR = path.join(process.env.UPLOAD_DIR || "/app/uploads", "backups");
export const SERVER_BACKUP_DIR = path.join(process.cwd(), "backups");

export type BackupFile = {
  name: string;
  size: number;
  mtime: Date;
  type: "manual" | "auto" | "server" | "unknown";
  kind: "db" | "uploads";
  location: "app" | "server";
  restorableInApp: boolean;
};

function dbEnv() {
  const u = new URL(process.env.DATABASE_URL || "");
  return {
    host: u.hostname, port: u.port || "5432",
    user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password),
    db: u.pathname.replace(/^\//, ""),
  };
}

export async function runBackup(prefix = "backup"): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const c = dbEnv();
  const name = `${prefix}-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}.sql`;
  const file = path.join(BACKUP_DIR, name);
  const tmp = `${file}.tmp`;
  try {
    await runFile("pg_dump", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "-h", c.host, "-p", c.port, "-U", c.user, "-d", c.db, "-f", tmp], {
      env: { ...process.env, PGPASSWORD: c.pass },
      maxBuffer: 1024 * 1024 * 64,
    });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  return name;
}

export async function restoreBackup(name: string): Promise<void> {
  const base = path.basename(name);
  if (!base.endsWith(".sql")) throw new Error("الاستعادة من الواجهة تقبل ملفات SQL غير المضغوطة فقط");
  const file = path.join(BACKUP_DIR, base);
  if (!fs.existsSync(file)) throw new Error("الملف غير موجود");
  const c = dbEnv();
  await runFile("psql", ["-h", c.host, "-p", c.port, "-U", c.user, "-d", c.db, "-f", file], {
    env: { ...process.env, PGPASSWORD: c.pass },
    maxBuffer: 1024 * 1024 * 64,
  });
}

function appBackupType(name: string): BackupFile["type"] {
  if (name.startsWith("auto-")) return "auto";
  if (name.startsWith("manual-")) return "manual";
  return "unknown";
}

function serverBackupKind(name: string): BackupFile["kind"] {
  return name.startsWith("uploads-") ? "uploads" : "db";
}

export function listBackups(): BackupFile[] {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".sql"))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, mtime: st.mtime, type: appBackupType(f), kind: "db", location: "app", restorableInApp: true } satisfies BackupFile;
      })
      .sort((a, b) => +b.mtime - +a.mtime);
  } catch { return []; }
}

export function listServerBackups(): BackupFile[] {
  try {
    return fs.readdirSync(SERVER_BACKUP_DIR)
      .filter((f) => /^db-.*\.sql\.gz$/.test(f) || /^uploads-.*\.tar\.gz$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(SERVER_BACKUP_DIR, f));
        return { name: f, size: st.size, mtime: st.mtime, type: "server", kind: serverBackupKind(f), location: "server", restorableInApp: false } satisfies BackupFile;
      })
      .sort((a, b) => +b.mtime - +a.mtime);
  } catch { return []; }
}

export function getBackupOverview() {
  const app = listBackups();
  const server = listServerBackups();
  const db = [...app, ...server.filter((b) => b.kind === "db")].sort((a, b) => +b.mtime - +a.mtime);
  const uploads = server.filter((b) => b.kind === "uploads").sort((a, b) => +b.mtime - +a.mtime);
  return {
    app,
    server,
    latestDb: db[0] ?? null,
    latestUploads: uploads[0] ?? null,
    latestAny: [...db, ...uploads].sort((a, b) => +b.mtime - +a.mtime)[0] ?? null,
  };
}

export function backupErrorMessage(e: unknown) {
  const raw = e instanceof Error ? e.message : String(e || "");
  const databaseUrl = process.env.DATABASE_URL;
  let message = raw;
  if (databaseUrl) message = message.split(databaseUrl).join("[DATABASE_URL]");
  try {
    const parsed = databaseUrl ? new URL(databaseUrl) : null;
    if (parsed?.password) message = message.split(decodeURIComponent(parsed.password)).join("[DB_PASSWORD]");
  } catch {}
  return message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://[credentials]@");
}

// نسخة تلقائية يومية: تُستدعى من الـlayout (خفيفة ومقيّدة بمرة كل 24 ساعة)
export async function maybeAutoBackup() {
  try {
    const o = await prisma.orgSetting.findUnique({ where: { id: 1 }, select: { autoBackup: true, lastAutoBackupAt: true, notifRetentionDays: true, loginLogRetentionDays: true } });
    if (!o?.autoBackup) return;
    const last = o.lastAutoBackupAt ? +new Date(o.lastAutoBackupAt) : 0;
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    await prisma.orgSetting.update({ where: { id: 1 }, data: { lastAutoBackupAt: new Date() } });
    // تنظيف يومي للسجلات المتضخمة — المدد من إعدادات الأدمن. سجل التدقيق (AuditLog) لا يُمسّ أبداً (للمساءلة الرسمية)
    try {
      const now = Date.now();
      const days = (n: number) => new Date(now - n * 86400000);
      const notifDays = o.notifRetentionDays ?? 30;
      const loginDays = o.loginLogRetentionDays ?? 180;
      await prisma.notification.deleteMany({ where: { read: true, createdAt: { lt: days(notifDays) } } });
      await prisma.loginLog.deleteMany({ where: { createdAt: { lt: days(loginDays) } } });
    } catch {}
    runBackup("auto").then(() => {
      // إبقاء آخر 14 نسخة تلقائية فقط
      const autos = listBackups().filter((b) => b.name.startsWith("auto-"));
      autos.slice(14).forEach((b) => { try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); } catch {} });
    }).catch(() => {});
  } catch {}
}
