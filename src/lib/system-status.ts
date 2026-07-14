import os from "os";
import fs from "fs";
import { prisma } from "@/lib/db";
import { getBackupOverview } from "@/lib/backup";

export async function getSystemStatus() {
  const disk = fs.statfsSync(process.cwd());
  const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at DESC
  `.catch(() => []);
  const dbSize = await prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database())::bigint AS size`.catch(() => []);
  const latest = getBackupOverview().latestDb;
  return {
    checkedAt: new Date().toISOString(), version: process.env.npm_package_version ?? "غير متاح",
    commit: process.env.APP_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "غير متاح داخل الصورة",
    image: process.env.APP_IMAGE ?? os.hostname(), uptimeSeconds: Math.floor(process.uptime()),
    memory: { total: os.totalmem(), free: os.freemem() }, disk: { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize },
    databaseBytes: Number(dbSize[0]?.size ?? 0), migrations: { count: migrations.length, latest: migrations[0]?.migration_name ?? "غير متاح", pendingOrFailed: migrations.filter((x) => !x.finished_at).length },
    backup: latest ? { name: latest.name, at: latest.mtime.toISOString(), size: latest.size } : null,
    services: { app: "running", postgresql: "connected", minio: process.env.MINIO_ENDPOINT ? "configured" : "external/unavailable", caddy: process.env.PUBLIC_URL || process.env.NEXTAUTH_URL ? "domain configured" : "unavailable" },
  };
}
