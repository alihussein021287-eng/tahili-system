"use server";
import { requireSession, assertAdminDelete } from "@/lib/access";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { runBackup, restoreBackup as doRestore, verifyBackup, BACKUP_DIR, backupErrorMessage } from "@/lib/backup";
import { maintenanceOn } from "@/lib/maintenance";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "fs";
import path from "path";

async function assertAdmin() {
  const s = await requireSession();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("غير مصرّح — الأدمن فقط");
  return s;
}

export async function createBackup() {
  await assertAdmin();
  try {
    const started = Date.now();
    const name = await runBackup("manual");
    const integrity = verifyBackup(name);
    await logAudit({ action: "CREATE", tableName: "backups", recordId: name, newValue: { integrity, durationMs: Date.now() - started } });
    if (!integrity.ok) throw new Error(integrity.detail);
    redirect("/backup?msg=" + encodeURIComponent(`تم إنشاء وفحص النسخة: ${name} خلال ${Date.now() - started}ms`));
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
  if (!(await maintenanceOn())) redirect("/backup?err=" + encodeURIComponent("الاستعادة محظورة خارج وضع الصيانة"));
  if (fd.get("confirm")?.toString().trim() !== "استعادة") redirect("/backup?err=" + encodeURIComponent("اكتب «استعادة» بالضبط للتأكيد"));
  try {
    const integrity = verifyBackup(name);
    if (!integrity.ok) throw new Error(integrity.detail);
    const safetyBackup = await runBackup("pre-restore");
    await doRestore(name);
    await logAudit({ action: "UPDATE", tableName: "backups", recordId: `restore:${name}`, newValue: { safetyBackup } });
    redirect("/backup?msg=" + encodeURIComponent("تمت الاستعادة بنجاح — تحقّق من البيانات"));
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    redirect("/backup?err=" + encodeURIComponent("فشلت الاستعادة: " + backupErrorMessage(e)));
  }
}

export async function testBackupIntegrity(name: string) {
  await assertAdmin();
  const result = verifyBackup(name);
  await logAudit({ action: "UPDATE", tableName: "backups", recordId: `isolated-test:${name}`, newValue: result });
  redirect(`/backup?${result.ok ? "msg" : "err"}=` + encodeURIComponent(`اختبار معزول دون استعادة: ${result.detail}`));
}

export async function toggleAutoBackup(on: boolean) {
  await assertAdmin();
  await prisma.orgSetting.upsert({ where: { id: 1 }, update: { autoBackup: on }, create: { id: 1, autoBackup: on } });
  await logAudit({ action: "UPDATE", tableName: "OrgSetting", recordId: "autoBackup", newValue: { on } });
  revalidatePath("/backup");
}
