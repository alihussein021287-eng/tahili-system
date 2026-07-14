"use server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertMaintenanceAdmin } from "@/lib/maintenance";
import { redirect } from "next/navigation";
import { CATS } from "./cats";
import { getBackupOverview } from "@/lib/backup";

function assertRecentBackup() {
  const latest = getBackupOverview().latestDb;
  if (!latest || Date.now() - latest.mtime.getTime() > 24 * 60 * 60 * 1000) {
    throw new Error("لا يمكن المسح دون نسخة احتياطية ناجحة خلال آخر 24 ساعة");
  }
}

export async function wipeCategory(key: string, fd: FormData) {
  await assertMaintenanceAdmin();
  assertRecentBackup();
  const confirm = fd.get("confirm")?.toString().trim();
  if (confirm !== "امسح") redirect("/maintenance?err=" + encodeURIComponent("اكتب كلمة «امسح» بالضبط للتأكيد"));
  if (fd.get("count")?.toString() !== fd.get("expectedCount")?.toString()) redirect("/maintenance?err=" + encodeURIComponent("عدد السجلات المدخل لا يطابق العدد المعروض"));
  if (key === "audit") redirect("/maintenance?err=" + encodeURIComponent("سجل التدقيق دائم ولا يمكن مسحه"));

  if (key === "users") {
    await prisma.userPermission.deleteMany({});
    await prisma.userPreference.deleteMany({});
    const d = await prisma.user.deleteMany({ where: { role: { not: "ADMIN" } } });
    await logAudit({ action: "DELETE", tableName: "maintenance:users", recordId: "ALL", newValue: { deleted: d.count } });
    redirect("/maintenance?msg=" + encodeURIComponent(`تم حذف ${d.count} مستخدم (غير الأدمن)`));
  }

  const cat = CATS[key];
  if (!cat) redirect("/maintenance?err=" + encodeURIComponent("فئة غير معروفة"));
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${cat!.tables.join(", ")} RESTART IDENTITY CASCADE`);
  await logAudit({ action: "DELETE", tableName: `maintenance:${key}`, recordId: "ALL" });
  redirect("/maintenance?msg=" + encodeURIComponent(`تم مسح: ${cat!.label}`));
}

export async function wipeAll(fd: FormData) {
  await assertMaintenanceAdmin();
  assertRecentBackup();
  const confirm = fd.get("confirm")?.toString().trim();
  if (confirm !== "تصفير شامل") redirect("/maintenance?err=" + encodeURIComponent("اكتب «تصفير شامل» بالضبط للتأكيد"));

  const rows: any[] = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  if (fd.get("confirmCount")?.toString() !== fd.get("expectedCount")?.toString()) redirect("/maintenance?err=" + encodeURIComponent("عدد السجلات المدخل لا يطابق العدد المعروض"));
  const keep = new Set(["users", "OrgSetting", "_prisma_migrations", "audit_logs"]);
  const list = rows.map((r) => r.tablename).filter((t: string) => !keep.has(t)).map((t: string) => `"public"."${t}"`);
  if (list.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list.join(", ")} RESTART IDENTITY CASCADE`);
  const d = await prisma.user.deleteMany({ where: { role: { not: "ADMIN" } } });
  await logAudit({ action: "DELETE", tableName: "maintenance:FULL_RESET", recordId: "ALL", newValue: { usersDeleted: d.count } });
  redirect("/maintenance?msg=" + encodeURIComponent("تم التصفير الشامل — بقي الأدمن وإعدادات المركز فقط"));
}
