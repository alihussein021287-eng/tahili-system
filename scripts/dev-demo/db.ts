import { PrismaClient } from "@prisma/client";

/**
 * Prisma client for the demo scripts. Normal installs use the bundled engine; a harness without the
 * native engine can set DEMO_PG_ADAPTER=1 to go through @prisma/adapter-pg instead.
 */
export async function demoPrisma(): Promise<PrismaClient> {
  if (process.env.DEMO_PG_ADAPTER !== "1") return new PrismaClient();
  const name = "@prisma/adapter-pg";
  const { PrismaPg } = await import(name);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) } as any);
}

/** The demo tools only ever touch the local working copy on port 3001. */
export function assertLocalDevCopy() {
  const ok = process.env.TAHILI_ENVIRONMENT === "development"
    && process.env.TAHILI_LOCAL_ACCESS === "true"
    && process.env.TAHILI_LOCAL_PORT === "3001"
    && process.env.NEXTAUTH_URL === "http://localhost:3001";
  if (!ok) throw new Error("رفض: هذه الأداة تعمل فقط على نسخة التجربة المحلية (localhost:3001).");
}
