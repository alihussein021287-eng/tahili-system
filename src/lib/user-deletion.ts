import type { PrismaClient } from "@prisma/client";

export type UserDeletionBlocker = { table: string; count: number };
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function userDeletionBlockers(db: PrismaClient, userId: string): Promise<UserDeletionBlocker[]> {
  const refs = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      AND ccu.table_name = 'users' AND ccu.column_name = 'id'
  `;
  const counts = await Promise.all(refs.map(async (ref) => {
    if (!IDENTIFIER.test(ref.table_name) || !IDENTIFIER.test(ref.column_name)) throw new Error("مرجع قاعدة بيانات غير صالح");
    const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${ref.table_name}" WHERE "${ref.column_name}" = $1`, userId,
    );
    return { table: ref.table_name, count: Number(rows[0]?.count ?? 0) };
  }));
  return counts.filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
}
