import { getSession } from "@/lib/access";
import { prisma } from "./db";

export async function logAudit(opts: {
  userId?: string; action: "CREATE" | "UPDATE" | "DELETE";
  tableName: string; recordId: string; oldValue?: any; newValue?: any;
}) {
  try {
    // إن لم يُمرّر المستخدم، نجلبه من الجلسة الحالية تلقائياً
    let userId = opts.userId;
    if (!userId) {
      const s = await getSession();
      userId = (s?.user as any)?.id;
    }
    await prisma.auditLog.create({ data: {
      userId, action: opts.action, tableName: opts.tableName,
      recordId: opts.recordId, oldValue: opts.oldValue ?? undefined, newValue: opts.newValue ?? undefined,
    }});
  } catch { /* لا نوقف العملية بسبب فشل التدقيق */ }
}
