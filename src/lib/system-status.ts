import os from "os";
import fs from "fs";
import { prisma } from "@/lib/db";
import { getBackupOverview } from "@/lib/backup";
import path from "node:path";
import { createHash } from "node:crypto";

type MigrationRecord = { migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null };
type MigrationFile = { name: string; checksum: string };

export function migrationStatus(records: MigrationRecord[] | null, files: MigrationFile[] | null) {
  const successful = (records ?? []).filter((row) => row.finished_at && !row.rolled_back_at);
  const applied = new Set(successful.map((row) => row.migration_name));
  const expected = new Map((files ?? []).map((file) => [file.name, file.checksum]));
  const pending = [...expected.keys()].filter((name) => !applied.has(name));
  const unresolved = (records ?? []).filter((row) => !row.finished_at && !row.rolled_back_at).map((row) => row.migration_name);
  const mismatched = successful.filter((row) => expected.has(row.migration_name) && expected.get(row.migration_name) !== row.checksum).map((row) => row.migration_name);
  const unexpected = [...applied].filter((name) => !expected.has(name));
  const unavailable = records === null || files === null || files.length === 0;
  return {
    count: applied.size,
    latest: successful[0]?.migration_name ?? "غير متاح",
    pendingOrFailed: new Set([...pending, ...unresolved, ...mismatched, ...unexpected]).size + Number(unavailable),
    pending, unresolved, mismatched, unexpected, unavailable,
    rolledBackCount: (records ?? []).filter((row) => row.rolled_back_at).length,
  };
}

function migrationFiles(): MigrationFile[] | null {
  try {
    const directory = path.join(process.cwd(), "prisma", "migrations");
    return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => ({
      name: entry.name,
      checksum: createHash("sha256").update(fs.readFileSync(path.join(directory, entry.name, "migration.sql"))).digest("hex"),
    }));
  } catch { return null; }
}

export async function getSystemStatus() {
  const disk = fs.statfsSync(process.cwd());
  const migrations = await prisma.$queryRaw<MigrationRecord[]>`
    SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC
  `.catch(() => null);
  const dbSize = await prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database())::bigint AS size`.catch(() => []);
  const latest = getBackupOverview().latestDb;
  return {
    checkedAt: new Date().toISOString(), version: process.env.npm_package_version ?? "غير متاح",
    commit: process.env.APP_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "غير متاح داخل الصورة",
    image: process.env.APP_IMAGE ?? os.hostname(), uptimeSeconds: Math.floor(process.uptime()),
    memory: { total: os.totalmem(), free: os.freemem() }, disk: { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize },
    databaseBytes: Number(dbSize[0]?.size ?? 0), migrations: migrationStatus(migrations, migrationFiles()),
    backup: latest ? { name: latest.name, at: latest.mtime.toISOString(), size: latest.size } : null,
    services: { app: "running", postgresql: "connected", minio: process.env.MINIO_ENDPOINT ? "configured" : "external/unavailable", caddy: process.env.PUBLIC_URL || process.env.NEXTAUTH_URL ? "domain configured" : "unavailable" },
  };
}
