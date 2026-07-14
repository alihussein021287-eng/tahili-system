"use server";
import { requireSession } from "@/lib/access";
import { assertAdminDelete } from "@/lib/access";
import { prisma } from "@/lib/db";
import { canManageUsers } from "@/lib/permissions";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";

async function requireAdmin() {
  const s = await requireSession();
  if (!canManageUsers((s?.user as any)?.role)) throw new Error("غير مصرّح");
}
export async function addMobilityAid(fd: FormData) { await requireAdmin(); await prisma.mobilityAid.create({ data: { name: fd.get("name")?.toString() || "" } }); revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 }); }
export async function deleteMobilityAid(id: number) { await assertAdminDelete(); await requireAdmin(); await prisma.mobilityAid.delete({ where: { id } }); revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 }); }
export async function addProstheticType(fd: FormData) { await requireAdmin(); await prisma.prostheticType.create({ data: { name: fd.get("name")?.toString() || "" } }); revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 }); }
export async function deleteProstheticType(id: number) { await assertAdminDelete(); await requireAdmin(); await prisma.prostheticType.delete({ where: { id } }); revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 }); }
export async function addBranch(fd: FormData) {
  await requireAdmin();
  const name = fd.get("name")?.toString().trim();
  if (name) await prisma.branch.create({ data: { name } }).catch(() => {});
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function toggleBranch(id: number, isActive: boolean) {
  await requireAdmin();
  await prisma.branch.update({ where: { id }, data: { isActive } });
  await logAudit({ action: "UPDATE", tableName: "branches", recordId: String(id), newValue: { isActive } });
  revalidatePath("/settings"); revalidatePath("/users"); revalidatePath("/patients"); revalidateTag("lookups", { expire: 0 });
}
export async function deleteBranch(id: number) {
  await assertAdminDelete();
  await requireAdmin();
  await prisma.branch.delete({ where: { id } });
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function addCenter(fd: FormData) {
  await requireAdmin();
  await prisma.center.create({ data: { name: fd.get("name")?.toString() || "" } });
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function addInjuryType(fd: FormData) {
  await requireAdmin();
  await prisma.injuryType.create({ data: { name: fd.get("name")?.toString() || "" } });
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function addMedication(fd: FormData) {
  await requireAdmin();
  await prisma.medication.create({ data: { name: fd.get("name")?.toString() || "" } });
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}

export async function addDistrict(fd: FormData) {
  await requireAdmin();
  const governorateId = Number(fd.get("governorateId"));
  const name = fd.get("name")?.toString().trim() || "";
  if (!governorateId || !name) return;
  await prisma.district.create({ data: { name, governorateId } });
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}

export async function addFormation(fd: FormData) {
  await requireAdmin();
  await prisma.formation.create({ data: { name: fd.get("name")?.toString().trim() || "" } });
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}

const inUse = "/settings?saved=" + encodeURIComponent("لا يمكن الحذف — العنصر مستخدم في سجلات");

export async function addEmployee(fd: FormData) {
  await requireAdmin();
  const name = fd.get("name")?.toString().trim();
  const job = fd.get("job")?.toString().trim() || null;
  if (name) await prisma.employee.create({ data: { name, job } });
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function deleteEmployee(id: number) {
  await assertAdminDelete();
  await requireAdmin();
  try { await prisma.employee.delete({ where: { id } }); } catch { redirect(inUse); }
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}

export async function addRank(fd: FormData) {
  await requireAdmin();
  const name = fd.get("name")?.toString().trim();
  if (name) await prisma.rank.create({ data: { name } }).catch(() => {});
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function deleteRank(id: number) {
  await assertAdminDelete();
  await requireAdmin();
  try { await prisma.rank.delete({ where: { id } }); } catch { redirect(inUse); }
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}

export async function deleteCenter(id: number) {
  await assertAdminDelete();
  await requireAdmin();
  try { await prisma.center.delete({ where: { id } }); } catch { redirect(inUse); }
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function deleteInjuryType(id: number) {
  await assertAdminDelete();
  await requireAdmin();
  try { await prisma.injuryType.delete({ where: { id } }); } catch { redirect(inUse); }
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function deleteMedication(id: number) {
  await assertAdminDelete();
  await requireAdmin();
  try { await prisma.medication.delete({ where: { id } }); } catch { redirect(inUse); }
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function deleteFormation(id: number) {
  await assertAdminDelete();
  await requireAdmin();
  try { await prisma.formation.delete({ where: { id } }); } catch { redirect(inUse); }
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}
export async function deleteDistrict(id: number) {
  await assertAdminDelete();
  await requireAdmin();
  try { await prisma.district.delete({ where: { id } }); } catch { redirect(inUse); }
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
}

export async function saveOrg(fd: FormData) {
  await requireAdmin();
  const data = {
    name: fd.get("name")?.toString().trim() || "المجمع التأهيلي الطبي",
    subtitle: fd.get("subtitle")?.toString() || null,
    address: fd.get("address")?.toString() || null,
    phone: fd.get("phone")?.toString() || null,
    logoUrl: fd.get("logoUrl")?.toString().trim() || null,
  };
  await prisma.orgSetting.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  revalidatePath("/settings"); revalidateTag("lookups", { expire: 0 });
  redirect("/settings?saved=" + encodeURIComponent("تم حفظ هوية النظام"));
}

export async function setMaintenanceMode(on: boolean) {
  const s = await requireSession();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("غير مصرّح — الأدمن فقط");
  await prisma.orgSetting.upsert({ where: { id: 1 }, update: { maintenanceMode: on }, create: { id: 1, maintenanceMode: on } });
  await logAudit({ action: "UPDATE", tableName: "OrgSetting", recordId: "maintenanceMode", newValue: { on } });
  revalidatePath("/settings"); revalidatePath("/maintenance");
}

export async function saveRetention(fd: FormData) {
  await requireAdmin();
  // حدود آمنة: بين يوم واحد و3650 يوم (10 سنوات). سجل التدقيق غير مشمول — دائم.
  const clamp = (v: number, def: number) => (Number.isFinite(v) && v >= 1 && v <= 3650 ? Math.floor(v) : def);
  const notif = clamp(Number(fd.get("notifRetentionDays")), 30);
  const login = clamp(Number(fd.get("loginLogRetentionDays")), 180);
  await prisma.orgSetting.upsert({
    where: { id: 1 },
    update: { notifRetentionDays: notif, loginLogRetentionDays: login },
    create: { id: 1, notifRetentionDays: notif, loginLogRetentionDays: login },
  });
  await logAudit({ action: "UPDATE", tableName: "OrgSetting", recordId: "retention", newValue: { notif, login } });
  revalidatePath("/settings");
}
export async function saveExpenseApprovalLevels(fd: FormData) {
  await requireAdmin();
  const levels = Math.max(1, Math.min(5, Number(fd.get("expenseApprovalLevels")) || 1));
  await prisma.orgSetting.upsert({ where: { id: 1 }, update: { expenseApprovalLevels: levels }, create: { id: 1, expenseApprovalLevels: levels } });
  await logAudit({ action: "UPDATE", tableName: "OrgSetting", recordId: "expenseApprovalLevels", newValue: { levels } });
  revalidatePath("/settings");
}

const allowedTimezones = new Set(["Asia/Baghdad", "UTC"]);
const allowedLocales = new Set(["ar-IQ", "en-US"]);
const intRange = (fd: FormData, key: string, min: number, max: number) => {
  const value = Number(fd.get(key));
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`قيمة ${key} غير صالحة`);
  return value;
};

export async function saveAdminConfig(fd: FormData) {
  await requireAdmin();
  const timezone = fd.get("timezone")?.toString() || "Asia/Baghdad";
  const locale = fd.get("locale")?.toString() || "ar-IQ";
  if (!allowedTimezones.has(timezone) || !allowedLocales.has(locale)) throw new Error("اللغة أو المنطقة الزمنية غير صالحة");
  const fileTypes = (fd.get("fileTypes")?.toString() || "pdf,jpg,jpeg,png").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!fileTypes.length || fileTypes.some((x) => !/^[a-z0-9]{2,10}$/.test(x))) throw new Error("أنواع الملفات غير صالحة");
  const workDays = fd.getAll("workDays").map(String).filter((x) => /^[0-6]$/.test(x));
  if (!workDays.length) throw new Error("اختر يوم دوام واحداً على الأقل");
  const workStart = fd.get("workStart")?.toString() || "08:00";
  const workEnd = fd.get("workEnd")?.toString() || "15:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(workStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(workEnd) || workStart >= workEnd) throw new Error("ساعات الدوام غير صالحة");
  const dateFormat = fd.get("dateFormat")?.toString() || "yyyy/MM/dd";
  if (!new Set(["yyyy/MM/dd", "dd/MM/yyyy", "yyyy-MM-dd"]).has(dateFormat)) throw new Error("تنسيق التاريخ غير مدعوم");
  const config = {
    timezone, locale, dateFormat, workDays,
    workStart, workEnd,
    holidays: fd.get("holidays")?.toString().trim() || "",
    appointmentMinutes: intRange(fd, "appointmentMinutes", 5, 480),
    defaultSessions: intRange(fd, "defaultSessions", 1, 365), defaultPlanDays: intRange(fd, "defaultPlanDays", 1, 730),
    evaluationEvery: intRange(fd, "evaluationEvery", 1, 365), weakImprovementThreshold: intRange(fd, "weakImprovementThreshold", 0, 100),
    loginAttempts: intRange(fd, "loginAttempts", 1, 20), lockMinutes: intRange(fd, "lockMinutes", 1, 1440), sessionMinutes: intRange(fd, "sessionMinutes", 5, 10080),
    fileTypes, maxUploadMb: intRange(fd, "maxUploadMb", 1, 100), backupRetentionDays: intRange(fd, "backupRetentionDays", 1, 3650),
    fileNumberPrefix: fd.get("fileNumberPrefix")?.toString().trim().slice(0, 20) || "PAT",
    reportNumberPrefix: fd.get("reportNumberPrefix")?.toString().trim().slice(0, 20) || "REP",
  };
  const old = await prisma.orgSetting.findUnique({ where: { id: 1 }, select: { adminConfig: true } });
  await prisma.orgSetting.upsert({ where: { id: 1 }, update: { adminConfig: config }, create: { id: 1, adminConfig: config } });
  await logAudit({ action: "UPDATE", tableName: "OrgSetting", recordId: "adminConfig", oldValue: old?.adminConfig as any, newValue: config });
  revalidatePath("/settings"); revalidatePath("/readiness"); revalidatePath("/backup");
  redirect("/settings?saved=" + encodeURIComponent("تم حفظ الإعدادات وتفعيلها"));
}
