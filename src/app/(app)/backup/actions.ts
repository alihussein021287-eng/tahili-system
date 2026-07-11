"use server";
import { getSession, assertAdminDelete } from "@/lib/access";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { runBackup, restoreBackup as doRestore, BACKUP_DIR, backupErrorMessage } from "@/lib/backup";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "fs";
import path from "path";

async function assertAdmin() {
  const s = await getSession();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("غير مصرّح — الأدمن فقط");
  return s;
}

export async function createBackup() {
  await assertAdmin();
  try {
    const name = await runBackup("manual");
    await logAudit({ action: "CREATE", tableName: "backups", recordId: name });
    redirect("/backup?msg=" + encodeURIComponent(`تم إنشاء النسخة: ${name}`));
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    redirect("/backup?err=" + encodeURIComponent("فشل النسخ: " + backupErrorMessage(e)));
  }
}

export async function deleteBackup(name: string, fd: FormData) {
  await assertAdminDelete();
  await assertAdmin();
  if (fd.get("confirm")?.toString().trim() !== "حذف") redirect("/backup?err=" + encodeURIComponent("اكتب «حذف» بالضبط لتأكيد حذف النسخة"));
  const file = path.join(BACKUP_DIR, path.basename(name));
  if (fs.existsSync(file)) fs.unlinkSync(file);
  await logAudit({ action: "DELETE", tableName: "backups", recordId: name });
  redirect("/backup?msg=" + encodeURIComponent(`تم حذف النسخة: ${path.basename(name)}`));
}

export async function restoreBackupAction(name: string, fd: FormData) {
  await assertAdmin();
  if (fd.get("confirm")?.toString().trim() !== "استعادة") redirect("/backup?err=" + encodeURIComponent("اكتب «استعادة» بالضبط للتأكيد"));
  try {
    await doRestore(name);
    await logAudit({ action: "UPDATE", tableName: "backups", recordId: `restore:${name}` });
    redirect("/backup?msg=" + encodeURIComponent("تمت الاستعادة بنجاح — تحقّق من البيانات"));
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    redirect("/backup?err=" + encodeURIComponent("فشلت الاستعادة: " + backupErrorMessage(e)));
  }
}

export async function toggleAutoBackup(on: boolean) {
  await assertAdmin();
  await prisma.orgSetting.upsert({ where: { id: 1 }, update: { autoBackup: on }, create: { id: 1, autoBackup: on } });
  await logAudit({ action: "UPDATE", tableName: "OrgSetting", recordId: "autoBackup", newValue: { on } });
  revalidatePath("/backup");
}
