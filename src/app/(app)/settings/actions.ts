"use server";

import { assertAdminDelete, assertPerm, requireSession } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { getAdminConfig, type AdminConfig } from "@/lib/admin-config";
import {
  assertNoDuplicateCenterHallName,
  assertNoDuplicateCenterName,
  centerDeleteUsageCounts,
  centerHallDeleteUsageCounts,
  DELETE_BLOCKED_MESSAGE,
  normalizeLookupName,
  therapyHallGlobalUsageCounts,
  usageTotal,
} from "@/lib/center-halls";
import { DEFAULT_ALLOWED_FILE_TYPES, DEFAULT_BLOCKED_FILE_TYPES } from "@/lib/collaboration-rules";
import { prisma } from "@/lib/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

export type SettingsActionState = {
  ok?: boolean;
  message?: string;
  values?: Record<string, string>;
};

const TAB_LOOKUPS = "/settings?tab=lookups";
const TAB_THERAPY = "/settings?tab=therapy";
const DANGEROUS_FILE_TYPES = new Set(DEFAULT_BLOCKED_FILE_TYPES);

function state(ok: boolean, message: string, values?: Record<string, string>): SettingsActionState {
  return { ok, message, values };
}

function formValues(fd: FormData, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, fd.get(key)?.toString() ?? ""]));
}

async function requireSettingsEdit() {
  const session = await requireSession();
  await assertPerm("settings.edit");
  return (session.user as any)?.id as string | undefined;
}

async function requireSettingsBackupEdit() {
  const session = await requireSession();
  await assertPerm("settings.edit");
  await assertPerm("settings.backup");
  return (session.user as any)?.id as string | undefined;
}

async function requireAdminEdit() {
  const session = await requireSession();
  await assertPerm("settings.edit");
  const user = await prisma.user.findUnique({
    where: { id: (session.user as any)?.id },
    select: { role: true, isActive: true },
  });
  if (!user?.isActive || user.role !== "ADMIN") throw new Error("غير مصرّح — الأدمن فقط");
  return (session.user as any)?.id as string | undefined;
}

function text(fd: FormData, key: string, max = 500) {
  return (fd.get(key)?.toString() ?? "").trim().slice(0, max);
}

function optionalText(fd: FormData, key: string, max = 500) {
  const value = text(fd, key, max);
  return value || null;
}

function intRange(fd: FormData, key: string, label: string, min: number, max: number) {
  const value = Number(fd.get(key));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} يجب أن يكون بين ${min} و ${max}`);
  }
  return value;
}

function bool(fd: FormData, key: string) {
  return fd.get(key) === "on" || fd.get(key) === "1";
}

function parseExtensions(raw: string, label: string, allowEmpty = false) {
  const values = Array.from(new Set(raw.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)));
  if (!values.length && allowEmpty) return values;
  if (!values.length) throw new Error(`${label} مطلوب`);
  if (values.some((x) => !/^[a-z0-9]{1,12}$/.test(x))) throw new Error(`${label} يحتوي امتداداً غير صالح`);
  return values;
}

function parseAllowedExtensions(raw: string, label: string) {
  const values = parseExtensions(raw, label);
  if (values.some((x) => DANGEROUS_FILE_TYPES.has(x))) {
    throw new Error("لا يمكن السماح بامتداد تنفيذي خطر");
  }
  return values;
}

function parseBlockedExtensions(raw: string, label: string) {
  const values = parseExtensions(raw, label, true);
  return Array.from(new Set([...DEFAULT_BLOCKED_FILE_TYPES, ...values]));
}

function validateLogoUrl(value: string | null) {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return value;
  } catch {
    // handled below
  }
  throw new Error("رابط الشعار يجب أن يكون مساراً داخلياً أو رابط http/https");
}

function validateHolidays(value: string) {
  const dates = value.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
  if (dates.length > 120) throw new Error("عدد العطل الرسمية كبير جداً");
  const invalid = dates.find((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item));
  if (invalid) throw new Error("العطل الرسمية يجب أن تكون بصيغة YYYY-MM-DD ومفصولة بفواصل أو أسطر");
  return dates.join(", ");
}

async function updateAdminConfig(userId: string | undefined, recordId: string, patch: Partial<AdminConfig>, paths: string[] = []) {
  const oldConfig = await getAdminConfig();
  const nextConfig = { ...oldConfig, ...patch };
  const keys = Object.keys(patch) as (keyof AdminConfig)[];
  await prisma.orgSetting.upsert({
    where: { id: 1 },
    update: { adminConfig: nextConfig },
    create: { id: 1, adminConfig: nextConfig },
  });
  await logAudit({
    userId,
    action: "UPDATE",
    tableName: "OrgSetting",
    recordId,
    oldValue: Object.fromEntries(keys.map((key) => [key, oldConfig[key]])),
    newValue: patch,
  });
  revalidatePath("/settings");
  for (const path of paths) revalidatePath(path);
}

function lookupRedirect(card: string, message: string, kind: "saved" | "error" = "saved") {
  redirect(`${TAB_LOOKUPS}&card=${encodeURIComponent(card)}&${kind}=${encodeURIComponent(message)}`);
}

function therapyRedirect(card: string, message: string, kind: "saved" | "error" = "saved", centerId?: number | null) {
  const center = centerId ? `&center=${encodeURIComponent(String(centerId))}` : "";
  redirect(`${TAB_THERAPY}&card=${encodeURIComponent(card)}${center}&${kind}=${encodeURIComponent(message)}`);
}

function refreshCenterHalls() {
  const paths = [
    "/settings",
    "/queue",
    "/visits",
    "/search",
    "/appointments",
    "/appointments/calendar",
    "/therapy",
    "/therapy/today",
    "/therapy-centers",
    "/workload",
    "/patients",
    "/patients-care",
    "/centers",
    "/centers/reports",
    "/referrals",
    "/analytics",
    "/collaboration",
    "/collaboration/files",
    "/collaboration/admin",
    "/display",
  ];
  for (const path of paths) revalidatePath(path);
  revalidatePath("/patients", "layout");
  revalidateTag("lookups", { expire: 0 });
}

async function addLookup(card: string, tableName: string, create: () => Promise<unknown>) {
  await requireSettingsEdit();
  try {
    await create();
  } catch {
    lookupRedirect(card, "تعذر إضافة العنصر. تحقق من أنه غير مكرر.", "error");
  }
  revalidatePath("/settings");
  revalidateTag("lookups", { expire: 0 });
  await logAudit({ action: "CREATE", tableName, recordId: card });
  lookupRedirect(card, "تمت الإضافة");
}

async function deleteLookup(card: string, tableName: string, id: number, del: () => Promise<unknown>) {
  await assertAdminDelete();
  await requireSettingsEdit();
  try {
    await del();
  } catch {
    lookupRedirect(card, "لا يمكن الحذف لأن العنصر مستخدم في سجلات حالية.", "error");
  }
  revalidatePath("/settings");
  revalidateTag("lookups", { expire: 0 });
  await logAudit({ action: "DELETE", tableName, recordId: String(id) });
  lookupRedirect(card, "تم الحذف");
}

export async function saveIdentityAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, [
    "name", "subtitle", "address", "phone", "logoUrl",
    "officialHeader1", "officialHeader2", "officialHeader3", "officialHeader4",
    "officialMotto", "officialMottoSub", "officialAddress", "officialPhone", "officialToOffice",
  ]);
  try {
    const userId = await requireSettingsEdit();
    const data = {
      name: text(fd, "name", 120) || "المجمع التأهيلي الطبي",
      subtitle: optionalText(fd, "subtitle", 180),
      address: optionalText(fd, "address", 250),
      phone: optionalText(fd, "phone", 80),
      logoUrl: validateLogoUrl(optionalText(fd, "logoUrl", 500)),
      officialHeader1: optionalText(fd, "officialHeader1", 160),
      officialHeader2: optionalText(fd, "officialHeader2", 160),
      officialHeader3: optionalText(fd, "officialHeader3", 160),
      officialHeader4: optionalText(fd, "officialHeader4", 160),
      officialMotto: optionalText(fd, "officialMotto", 240),
      officialMottoSub: optionalText(fd, "officialMottoSub", 160),
      officialAddress: optionalText(fd, "officialAddress", 240),
      officialPhone: optionalText(fd, "officialPhone", 80),
      officialToOffice: optionalText(fd, "officialToOffice", 180),
    };
    const old = await prisma.orgSetting.findUnique({ where: { id: 1 } });
    await prisma.orgSetting.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    await logAudit({ userId, action: "UPDATE", tableName: "OrgSetting", recordId: "identity", oldValue: old, newValue: data });
    revalidatePath("/settings");
    revalidateTag("lookups", { expire: 0 });
    return state(true, "تم حفظ هوية النظام");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ هوية النظام", values);
  }
}

export async function savePresenceAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, ["onlineMinutes", "idleMinutes", "pingIntervalSeconds"]);
  try {
    const userId = await requireSettingsEdit();
    const onlineMinutes = intRange(fd, "onlineMinutes", "مدة الأونلاين بالدقائق", 1, 60);
    const idleMinutes = intRange(fd, "idleMinutes", "مدة الخمول بالدقائق", 2, 240);
    if (idleMinutes <= onlineMinutes) throw new Error("مدة الخمول يجب أن تكون أكبر من مدة الأونلاين");
    await updateAdminConfig(userId, "presence", {
      onlineMinutes,
      idleMinutes,
      pingIntervalSeconds: intRange(fd, "pingIntervalSeconds", "فاصل تحديث التواجد بالثواني", 15, 600),
    }, ["/users"]);
    return state(true, "تم حفظ إعدادات التواجد");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ إعدادات التواجد", values);
  }
}

export async function saveOperationsAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, ["timezone", "locale", "dateFormat", "workStart", "workEnd", "holidays", "appointmentMinutes"]);
  try {
    const userId = await requireSettingsEdit();
    const timezone = text(fd, "timezone", 40) || "Asia/Baghdad";
    const locale = text(fd, "locale", 20) || "ar-IQ";
    const dateFormat = text(fd, "dateFormat", 20) || "yyyy/MM/dd";
    if (!new Set(["Asia/Baghdad", "UTC"]).has(timezone)) throw new Error("المنطقة الزمنية غير مدعومة");
    if (!new Set(["ar-IQ", "en-US"]).has(locale)) throw new Error("اللغة غير مدعومة");
    if (!new Set(["yyyy/MM/dd", "dd/MM/yyyy", "yyyy-MM-dd"]).has(dateFormat)) throw new Error("تنسيق التاريخ غير مدعوم");
    const workDays = fd.getAll("workDays").map(String).filter((x) => /^[0-6]$/.test(x));
    if (!workDays.length) throw new Error("اختر يوم دوام واحداً على الأقل");
    const workStart = text(fd, "workStart", 5) || "08:00";
    const workEnd = text(fd, "workEnd", 5) || "15:00";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(workStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(workEnd) || workStart >= workEnd) {
      throw new Error("بداية ونهاية الدوام غير صالحة");
    }
    await updateAdminConfig(userId, "operations", {
      timezone,
      locale,
      dateFormat,
      workDays,
      workStart,
      workEnd,
      holidays: validateHolidays(text(fd, "holidays", 2000)),
      appointmentMinutes: intRange(fd, "appointmentMinutes", "مدة الموعد الافتراضية بالدقيقة", 5, 480),
    }, ["/appointments", "/readiness"]);
    return state(true, "تم حفظ الدوام والمواعيد");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ الدوام والمواعيد", values);
  }
}

export async function saveTherapyAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, ["defaultSessions", "defaultPlanDays", "evaluationEvery", "weakImprovementThreshold"]);
  try {
    const userId = await requireSettingsEdit();
    await updateAdminConfig(userId, "therapy", {
      defaultSessions: intRange(fd, "defaultSessions", "عدد الجلسات الافتراضي", 1, 365),
      defaultPlanDays: intRange(fd, "defaultPlanDays", "مدة الخطة باليوم", 1, 730),
      evaluationEvery: intRange(fd, "evaluationEvery", "دورية التقييم بالجلسات", 1, 365),
      weakImprovementThreshold: intRange(fd, "weakImprovementThreshold", "تنبيه ضعف التحسن بالنسبة المئوية", 0, 100),
    }, ["/therapy", "/centers"]);
    return state(true, "تم حفظ إعدادات العلاج والمراكز");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ إعدادات العلاج", values);
  }
}

export async function saveSecurityAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, ["loginAttempts", "lockMinutes", "sessionMinutes", "passwordMinLength"]);
  try {
    const userId = await requireSettingsEdit();
    const loginAttempts = intRange(fd, "loginAttempts", "محاولات الدخول", 3, 20);
    const lockMinutes = intRange(fd, "lockMinutes", "مدة قفل الحساب بالدقيقة", 5, 1440);
    const sessionMinutes = intRange(fd, "sessionMinutes", "مدة الجلسة بالدقيقة", 15, 10080);
    const passwordMinLength = intRange(fd, "passwordMinLength", "طول كلمة المرور", 8, 64);
    if (!bool(fd, "passwordRequireLetters") && !bool(fd, "passwordRequireNumbers")) {
      throw new Error("يجب إبقاء شرط الحروف أو الأرقام مفعلاً على الأقل");
    }
    await updateAdminConfig(userId, "security", {
      loginAttempts,
      lockMinutes,
      sessionMinutes,
      passwordMinLength,
      passwordRequireLetters: bool(fd, "passwordRequireLetters"),
      passwordRequireNumbers: bool(fd, "passwordRequireNumbers"),
      passwordRequireSymbols: bool(fd, "passwordRequireSymbols"),
    }, ["/login", "/users"]);
    return state(true, "تم حفظ إعدادات الأمان. مدة الجلسة تطبق على الجلسات الجديدة.");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ إعدادات الأمان", values);
  }
}

export async function saveNotificationsAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, ["notifRetentionDays", "notificationRetentionUnreadDays", "notificationDedupeMinutes"]);
  try {
    const userId = await requireSettingsEdit();
    const notificationTypes = fd.getAll("notificationTypes").map(String).filter((x) => /^[a-z]+$/.test(x));
    if (!notificationTypes.length) throw new Error("اختر نوع إشعار واحداً على الأقل");
    const notifRetentionDays = intRange(fd, "notifRetentionDays", "مدة احتفاظ الإشعارات المقروءة باليوم", 1, 3650);
    const old = await prisma.orgSetting.findUnique({ where: { id: 1 }, select: { notifRetentionDays: true, adminConfig: true } });
    await updateAdminConfig(userId, "notifications", {
      notificationTypes,
      notificationRetentionUnreadDays: intRange(fd, "notificationRetentionUnreadDays", "مدة احتفاظ الإشعارات غير المقروءة باليوم", 1, 3650),
      importantAlerts: bool(fd, "importantAlerts"),
      notificationDedupeMinutes: intRange(fd, "notificationDedupeMinutes", "منع تكرار الإشعارات بالدقيقة", 1, 1440),
    });
    await prisma.orgSetting.upsert({
      where: { id: 1 },
      update: { notifRetentionDays },
      create: { id: 1, notifRetentionDays },
    });
    await logAudit({
      userId,
      action: "UPDATE",
      tableName: "OrgSetting",
      recordId: "notificationRetention",
      oldValue: { notifRetentionDays: old?.notifRetentionDays },
      newValue: { notifRetentionDays },
    });
    revalidatePath("/settings");
    return state(true, "تم حفظ إعدادات الإشعارات");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ الإشعارات", values);
  }
}

export async function saveFilesAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, [
    "maxUploadMb", "fileTypes", "blockedFileTypes", "fileNumberPrefix", "reportNumberPrefix", "pdfPageSize",
    "printFooter", "collabMaxUploadMb", "collabAllowedTypes", "collabBlockedTypes", "editWindowMinutes",
    "messageRetentionDays", "trashRetentionDays", "userQuotaMb", "departmentQuotaMb", "centerQuotaMb",
  ]);
  try {
    const userId = await requireSettingsEdit();
    const fileTypes = parseAllowedExtensions(text(fd, "fileTypes", 500), "أنواع الملفات المسموحة");
    const blockedFileTypes = parseBlockedExtensions(text(fd, "blockedFileTypes", 500), "أنواع الملفات الممنوعة");
    await updateAdminConfig(userId, "files", {
      maxUploadMb: intRange(fd, "maxUploadMb", "الحجم الأقصى بالميغابايت", 1, 100),
      fileTypes,
      blockedFileTypes,
      fileNumberPrefix: text(fd, "fileNumberPrefix", 20) || "PAT",
      reportNumberPrefix: text(fd, "reportNumberPrefix", 20) || "REP",
      pdfPageSize: text(fd, "pdfPageSize", 10) === "Letter" ? "Letter" : "A4",
      printFooter: text(fd, "printFooter", 240),
    }, ["/patients", "/reports"]);

    if (fd.has("collabMaxUploadMb")) {
      const old = await prisma.collaborationSettings.findUnique({ where: { id: 1 } });
      const collabAllowedTypes = parseAllowedExtensions(text(fd, "collabAllowedTypes", 700) || DEFAULT_ALLOWED_FILE_TYPES.join(","), "أنواع ملفات التعاون المسموحة");
      const collabBlockedTypes = parseBlockedExtensions(text(fd, "collabBlockedTypes", 700), "أنواع ملفات التعاون الممنوعة");
      const data = {
        servicePaused: bool(fd, "servicePaused"),
        maxUploadMb: intRange(fd, "collabMaxUploadMb", "حجم ملف التعاون بالميغابايت", 1, 500),
        allowedTypes: collabAllowedTypes,
        blockedTypes: collabBlockedTypes,
        editWindowMinutes: intRange(fd, "editWindowMinutes", "مدة تعديل رسالة التعاون بالدقيقة", 1, 1440),
        messageRetentionDays: intRange(fd, "messageRetentionDays", "احتفاظ رسائل التعاون باليوم", 1, 3650),
        trashRetentionDays: intRange(fd, "trashRetentionDays", "احتفاظ سلة الملفات باليوم", 1, 365),
        userQuotaMb: intRange(fd, "userQuotaMb", "حصة المستخدم بالميغابايت", 1, 102400),
        departmentQuotaMb: intRange(fd, "departmentQuotaMb", "حصة القسم بالميغابايت", 1, 1024000),
        centerQuotaMb: intRange(fd, "centerQuotaMb", "حصة المركز بالميغابايت", 1, 1024000),
      };
      await prisma.collaborationSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
      await logAudit({ userId, action: "UPDATE", tableName: "collaboration_settings", recordId: "1", oldValue: old as any, newValue: data });
      revalidatePath("/collaboration");
    }
    return state(true, "تم حفظ إعدادات الملفات والطباعة");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ إعدادات الملفات", values);
  }
}

export async function saveOfficePreviewAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, ["officePreviewMaxMb", "officePreviewTimeoutSeconds", "officePreviewCacheRetentionHours"]);
  try {
    const userId = await requireSettingsEdit();
    await updateAdminConfig(userId, "officePreview", {
      officePreviewEnabled: bool(fd, "officePreviewEnabled"),
      officePreviewMaxMb: intRange(fd, "officePreviewMaxMb", "حد معاينة Office بالميغابايت", 1, 100),
      officePreviewTimeoutSeconds: intRange(fd, "officePreviewTimeoutSeconds", "مهلة تحويل Office بالثواني", 5, 120),
      officePreviewCacheRetentionHours: intRange(fd, "officePreviewCacheRetentionHours", "احتفاظ معاينات Office المؤقتة بالساعات", 1, 720),
    }, ["/collaboration/files", "/collaboration", "/readiness"]);
    return state(true, "تم حفظ إعدادات معاينة Office");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ إعدادات معاينة Office", values);
  }
}

export async function saveClamAvAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, ["clamavScanTimeoutSeconds"]);
  try {
    const userId = await requireSettingsEdit();
    await updateAdminConfig(userId, "clamav", {
      clamavScanTimeoutSeconds: intRange(fd, "clamavScanTimeoutSeconds", "مهلة فحص ClamAV بالثواني", 1, 60),
      clamavFailClosed: bool(fd, "clamavFailClosed"),
    }, ["/collaboration/files", "/collaboration", "/readiness"]);
    return state(true, "تم حفظ إعدادات ClamAV");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ إعدادات ClamAV", values);
  }
}

export async function saveBackupAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, ["backupRetentionDays", "loginLogRetentionDays"]);
  try {
    const userId = await requireSettingsBackupEdit();
    const backupRetentionDays = intRange(fd, "backupRetentionDays", "عدد النسخ المحتفظ بها", 1, 3650);
    const loginLogRetentionDays = intRange(fd, "loginLogRetentionDays", "مدة احتفاظ سجل الدخول باليوم", 1, 3650);
    const old = await prisma.orgSetting.findUnique({
      where: { id: 1 },
      select: { autoBackup: true, loginLogRetentionDays: true },
    });
    await updateAdminConfig(userId, "backup", { backupRetentionDays }, ["/backup", "/readiness"]);
    await prisma.orgSetting.upsert({
      where: { id: 1 },
      update: { autoBackup: bool(fd, "autoBackup"), loginLogRetentionDays },
      create: { id: 1, autoBackup: bool(fd, "autoBackup"), loginLogRetentionDays },
    });
    await logAudit({
      userId,
      action: "UPDATE",
      tableName: "OrgSetting",
      recordId: "backupRetention",
      oldValue: { autoBackup: old?.autoBackup, loginLogRetentionDays: old?.loginLogRetentionDays },
      newValue: { autoBackup: bool(fd, "autoBackup"), loginLogRetentionDays },
    });
    revalidatePath("/settings");
    return state(true, "تم حفظ إعدادات النسخ والاحتفاظ دون تنفيذ استعادة أو حذف");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ إعدادات النسخ", values);
  }
}

export async function saveReadinessAction(_: SettingsActionState, fd: FormData): Promise<SettingsActionState> {
  const values = formValues(fd, ["dbBackupStaleHours", "uploadsBackupStaleHours", "diskWarnPercent", "diskCriticalPercent"]);
  try {
    const userId = await requireSettingsBackupEdit();
    const diskWarnPercent = intRange(fd, "diskWarnPercent", "تحذير القرص بالنسبة المئوية", 1, 99);
    const diskCriticalPercent = intRange(fd, "diskCriticalPercent", "خطر القرص بالنسبة المئوية", 2, 100);
    if (diskCriticalPercent <= diskWarnPercent) throw new Error("حد خطر القرص يجب أن يكون أكبر من حد التحذير");
    await updateAdminConfig(userId, "readiness", {
      dbBackupStaleHours: intRange(fd, "dbBackupStaleHours", "قدم نسخة قاعدة البيانات بالساعات", 1, 720),
      uploadsBackupStaleHours: intRange(fd, "uploadsBackupStaleHours", "قدم نسخة المرفقات بالساعات", 1, 2160),
      diskWarnPercent,
      diskCriticalPercent,
      requireClamav: bool(fd, "requireClamav"),
      requireLibreOffice: bool(fd, "requireLibreOffice"),
    }, ["/readiness"]);
    return state(true, "تم حفظ عتبات الجاهزية");
  } catch (error) {
    return state(false, error instanceof Error ? error.message : "تعذر حفظ عتبات الجاهزية", values);
  }
}

export async function setMaintenanceMode(on: boolean) {
  const userId = await requireAdminEdit();
  const old = await prisma.orgSetting.findUnique({ where: { id: 1 }, select: { maintenanceMode: true } });
  await prisma.orgSetting.upsert({
    where: { id: 1 },
    update: { maintenanceMode: on },
    create: { id: 1, maintenanceMode: on },
  });
  await logAudit({
    userId,
    action: "UPDATE",
    tableName: "OrgSetting",
    recordId: "maintenanceMode",
    oldValue: { on: old?.maintenanceMode ?? false },
    newValue: { on },
  });
  revalidatePath("/settings");
  revalidatePath("/maintenance");
  redirect(`/settings?tab=security&card=maintenance&saved=${encodeURIComponent(on ? "تم تفعيل وضع الصيانة" : "تم إيقاف وضع الصيانة")}`);
}

export async function addMobilityAid(fd: FormData) {
  const name = text(fd, "name", 100);
  if (!name) lookupRedirect("mobility", "اسم مساعدة الحركة مطلوب", "error");
  await addLookup("mobility", "mobility_aids", () => prisma.mobilityAid.create({ data: { name } }));
}

export async function deleteMobilityAid(id: number) {
  await deleteLookup("mobility", "mobility_aids", id, () => prisma.mobilityAid.delete({ where: { id } }));
}

export async function addProstheticType(fd: FormData) {
  const name = text(fd, "name", 100);
  if (!name) lookupRedirect("prosthetic", "اسم نوع الطرف مطلوب", "error");
  await addLookup("prosthetic", "prosthetic_types", () => prisma.prostheticType.create({ data: { name } }));
}

export async function deleteProstheticType(id: number) {
  await deleteLookup("prosthetic", "prosthetic_types", id, () => prisma.prostheticType.delete({ where: { id } }));
}

export async function addBranch(fd: FormData) {
  const name = text(fd, "name", 120);
  if (!name) lookupRedirect("branches", "اسم الفرع مطلوب", "error");
  await addLookup("branches", "branches", () => prisma.branch.create({ data: { name } }));
}

export async function toggleBranch(id: number, isActive: boolean) {
  await requireSettingsEdit();
  const old = await prisma.branch.findUnique({ where: { id }, select: { isActive: true } });
  await prisma.branch.update({ where: { id }, data: { isActive } });
  await logAudit({ action: "UPDATE", tableName: "branches", recordId: String(id), oldValue: old, newValue: { isActive } });
  revalidatePath("/settings");
  revalidatePath("/users");
  revalidatePath("/patients");
  revalidateTag("lookups", { expire: 0 });
  lookupRedirect("branches", isActive ? "تم تفعيل الفرع" : "تم تعطيل الفرع");
}

export async function deleteBranch(id: number) {
  await deleteLookup("branches", "branches", id, () => prisma.branch.delete({ where: { id } }));
}

export async function addCenter(fd: FormData) {
  const name = text(fd, "name", 120);
  if (!name) lookupRedirect("centers", "اسم المركز مطلوب", "error");
  await addLookup("centers", "centers", () => prisma.center.create({ data: { name } }));
}

export async function createTherapyCenter(fd: FormData) {
  const userId = await requireSettingsEdit();
  const name = normalizeLookupName(text(fd, "name", 120));
  if (!name) therapyRedirect("center-halls", "اسم المركز مطلوب", "error");
  let centerId: number | null = null;
  try {
    const normalizedName = await assertNoDuplicateCenterName(prisma, name);
    const center = await prisma.center.create({ data: { name: normalizedName } });
    centerId = center.id;
    await logAudit({ userId, action: "CREATE", tableName: "centers", recordId: String(center.id), newValue: { name } });
    refreshCenterHalls();
  } catch (error) {
    therapyRedirect("center-halls", error instanceof Error ? error.message : "تعذر حفظ المركز", "error");
  }
  therapyRedirect("center-halls", "تم حفظ المركز", "saved", centerId);
}

export async function renameTherapyCenter(id: number, fd: FormData) {
  const userId = await requireSettingsEdit();
  const name = normalizeLookupName(text(fd, "name", 120));
  if (!Number.isInteger(id) || id <= 0 || !name) therapyRedirect("center-halls", "اسم المركز مطلوب", "error");
  try {
    const normalizedName = await assertNoDuplicateCenterName(prisma, name, id);
    const old = await prisma.center.findUnique({ where: { id } });
    await prisma.center.update({ where: { id }, data: { name: normalizedName } });
    await logAudit({ userId, action: "UPDATE", tableName: "centers", recordId: String(id), oldValue: old, newValue: { name: normalizedName } });
    refreshCenterHalls();
  } catch (error) {
    therapyRedirect("center-halls", error instanceof Error ? error.message : "تعذر تعديل المركز. تحقق من عدم تكرار الاسم.", "error", id);
  }
  therapyRedirect("center-halls", "تم تعديل المركز", "saved", id);
}

export async function setTherapyCenterActive(id: number, active: boolean) {
  const userId = await requireSettingsEdit();
  if (!Number.isInteger(id) || id <= 0) therapyRedirect("center-halls", "المركز غير صالح", "error");
  const old = await prisma.center.findUnique({ where: { id }, select: { id: true, name: true, active: true } });
  if (!old) therapyRedirect("center-halls", "المركز غير صالح", "error");
  await prisma.center.update({ where: { id }, data: { active } });
  await logAudit({ userId, action: "UPDATE", tableName: "centers", recordId: String(id), oldValue: old, newValue: { active } });
  refreshCenterHalls();
  therapyRedirect("center-halls", active ? "تم تفعيل المركز" : "تم تعطيل المركز", "saved", id);
}

export async function addCenterHall(fd: FormData) {
  const userId = await requireSettingsEdit();
  const centerId = Number(fd.get("centerId"));
  const name = normalizeLookupName(text(fd, "name", 120));
  if (!Number.isInteger(centerId) || centerId <= 0 || !name) therapyRedirect("center-halls", "اختر المركز واكتب اسم الفرع/القاعة", "error");
  try {
    await prisma.$transaction(async (tx) => {
      const center = await tx.center.findUnique({ where: { id: centerId }, select: { id: true, active: true } });
      if (!center) throw new Error("center");
      if (!center.active) throw new Error("لا يمكن إضافة فرع/قاعة إلى مركز معطل");
      const normalizedName = await assertNoDuplicateCenterHallName(tx, centerId, name);
      const hall = await tx.therapyHall.upsert({ where: { name: normalizedName }, update: { active: true }, create: { name: normalizedName } });
      const resource = await tx.centerResource.create({
        data: { centerId, name: normalizedName, type: "HALL", status: "AVAILABLE", therapyHallId: hall.id },
      });
      await tx.auditLog.create({ data: { userId, action: "CREATE", tableName: "center_resources", recordId: resource.id, newValue: { centerId, hallId: hall.id, name } } });
    });
    refreshCenterHalls();
  } catch (error) {
    therapyRedirect("center-halls", error instanceof Error ? error.message : "تعذر إضافة الفرع/القاعة. تحقق من الاسم والمركز.", "error", centerId);
  }
  therapyRedirect("center-halls", "تمت إضافة الفرع/القاعة", "saved", centerId);
}

export async function renameCenterHall(resourceId: string, fd: FormData) {
  const userId = await requireSettingsEdit();
  const name = normalizeLookupName(text(fd, "name", 120));
  if (!resourceId || !name) therapyRedirect("center-halls", "اسم الفرع/القاعة مطلوب", "error");
  let centerId: number | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const resource = await tx.centerResource.findUnique({
        where: { id: resourceId },
        include: { therapyHall: true },
      });
      if (!resource?.therapyHallId || !resource.therapyHall) throw new Error("الفرع/القاعة غير صالح");
      centerId = resource.centerId;
      const normalizedName = await assertNoDuplicateCenterHallName(tx, resource.centerId, name, resource.id);
      const old = { resource, hall: resource.therapyHall };
      await tx.therapyHall.update({ where: { id: resource.therapyHallId }, data: { name: normalizedName } });
      await tx.centerResource.updateMany({ where: { therapyHallId: resource.therapyHallId, type: "HALL" }, data: { name: normalizedName } });
      await tx.auditLog.create({ data: { userId, action: "UPDATE", tableName: "center_resources", recordId: resource.id, oldValue: old, newValue: { centerId: resource.centerId, hallId: resource.therapyHallId, name: normalizedName } } });
    });
    refreshCenterHalls();
  } catch (error) {
    therapyRedirect("center-halls", error instanceof Error ? error.message : "تعذر تعديل الفرع/القاعة. تحقق من عدم تكرار الاسم.", "error", centerId);
  }
  therapyRedirect("center-halls", "تم تعديل الفرع/القاعة", "saved", centerId);
}

export async function setCenterHallActive(resourceId: string, active: boolean) {
  const userId = await requireSettingsEdit();
  if (!resourceId) therapyRedirect("center-halls", "الفرع/القاعة غير صالح", "error");
  const old = await prisma.centerResource.findUnique({
    where: { id: resourceId },
    select: { centerId: true, status: true, therapyHallId: true },
  });
  if (!old) therapyRedirect("center-halls", "الفرع/القاعة غير صالح", "error");
  await prisma.centerResource.update({ where: { id: resourceId }, data: { status: active ? "AVAILABLE" : "OUT_OF_SERVICE" } });
  if (active && old.therapyHallId) await prisma.therapyHall.update({ where: { id: old.therapyHallId }, data: { active: true } });
  await logAudit({ userId, action: "UPDATE", tableName: "center_resources", recordId: resourceId, oldValue: old, newValue: { active, status: active ? "AVAILABLE" : "OUT_OF_SERVICE" } });
  refreshCenterHalls();
  therapyRedirect("center-halls", active ? "تم تفعيل الفرع/القاعة" : "تم تعطيل الفرع/القاعة", "saved", old.centerId);
}

export async function deleteTherapyCenter(id: number) {
  const userId = await requireSettingsEdit();
  if (!Number.isInteger(id) || id <= 0) therapyRedirect("center-halls", "المركز غير صالح", "error");
  try {
    await prisma.$transaction(async (tx) => {
      const center = await tx.center.findUnique({
        where: { id },
        include: { resources: { where: { type: "HALL", therapyHallId: { not: null } }, include: { therapyHall: true } } },
      });
      if (!center) throw new Error("المركز غير موجود");
      const counts = await centerDeleteUsageCounts(tx, id);
      if (usageTotal(counts) > 0) throw new Error(DELETE_BLOCKED_MESSAGE);
      const hallIds = center.resources.flatMap((resource) => resource.therapyHallId ? [{ id: resource.therapyHallId, name: resource.therapyHall?.name }] : []);
      await tx.center.delete({ where: { id } });
      for (const hall of hallIds) {
        const hallCounts = await therapyHallGlobalUsageCounts(tx, hall.id, hall.name);
        if (usageTotal(hallCounts) === 0) await tx.therapyHall.delete({ where: { id: hall.id } }).catch(() => {});
      }
      await tx.auditLog.create({ data: { userId, action: "DELETE", tableName: "centers", recordId: String(id), oldValue: { name: center.name } } });
    });
    refreshCenterHalls();
  } catch (error) {
    therapyRedirect("center-halls", error instanceof Error ? error.message : "تعذر حذف المركز", "error", id);
  }
  therapyRedirect("center-halls", "تم حذف المركز");
}

export async function deleteCenterHall(resourceId: string) {
  const userId = await requireSettingsEdit();
  if (!resourceId) therapyRedirect("center-halls", "الفرع/القاعة غير صالح", "error");
  let centerId: number | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const resource = await tx.centerResource.findUnique({
        where: { id: resourceId },
        include: { therapyHall: true },
      });
      if (!resource?.therapyHallId || !resource.therapyHall) throw new Error("الفرع/القاعة غير صالح");
      centerId = resource.centerId;
      const counts = await centerHallDeleteUsageCounts(tx, resource);
      if (usageTotal(counts) > 0) throw new Error(DELETE_BLOCKED_MESSAGE);
      await tx.centerResource.delete({ where: { id: resource.id } });
      const hallCounts = await therapyHallGlobalUsageCounts(tx, resource.therapyHallId, resource.therapyHall.name);
      if (usageTotal(hallCounts) === 0) await tx.therapyHall.delete({ where: { id: resource.therapyHallId } }).catch(() => {});
      await tx.auditLog.create({ data: { userId, action: "DELETE", tableName: "center_resources", recordId: resource.id, oldValue: { centerId: resource.centerId, hallId: resource.therapyHallId, name: resource.name } } });
    });
    refreshCenterHalls();
  } catch (error) {
    therapyRedirect("center-halls", error instanceof Error ? error.message : "تعذر حذف الفرع/القاعة", "error", centerId);
  }
  therapyRedirect("center-halls", "تم حذف الفرع/القاعة", "saved", centerId);
}

export async function deleteCenter(id: number) {
  await deleteLookup("centers", "centers", id, () => prisma.center.delete({ where: { id } }));
}

export async function addInjuryType(fd: FormData) {
  const name = text(fd, "name", 120);
  if (!name) lookupRedirect("injuries", "نوع الإصابة مطلوب", "error");
  await addLookup("injuries", "injury_types", () => prisma.injuryType.create({ data: { name } }));
}

export async function deleteInjuryType(id: number) {
  await deleteLookup("injuries", "injury_types", id, () => prisma.injuryType.delete({ where: { id } }));
}

export async function addDistrict(fd: FormData) {
  const governorateId = Number(fd.get("governorateId"));
  const name = text(fd, "name", 120);
  if (!Number.isInteger(governorateId) || governorateId <= 0 || !name) {
    lookupRedirect("districts", "اختر المحافظة واكتب اسم المنطقة", "error");
  }
  await addLookup("districts", "districts", () => prisma.district.create({ data: { name, governorateId } }));
}

export async function deleteDistrict(id: number) {
  await deleteLookup("districts", "districts", id, () => prisma.district.delete({ where: { id } }));
}

export async function addFormation(fd: FormData) {
  const name = text(fd, "name", 120);
  if (!name) lookupRedirect("formations", "اسم التشكيل مطلوب", "error");
  await addLookup("formations", "formations", () => prisma.formation.create({ data: { name } }));
}

export async function deleteFormation(id: number) {
  await deleteLookup("formations", "formations", id, () => prisma.formation.delete({ where: { id } }));
}

export async function addRank(fd: FormData) {
  const name = text(fd, "name", 120);
  if (!name) lookupRedirect("ranks", "اسم الصفة مطلوب", "error");
  await addLookup("ranks", "ranks", () => prisma.rank.create({ data: { name } }));
}

export async function deleteRank(id: number) {
  await deleteLookup("ranks", "ranks", id, () => prisma.rank.delete({ where: { id } }));
}

export async function saveExpenseApprovalLevels(fd: FormData) {
  await requireSettingsEdit();
  const levels = Math.max(1, Math.min(5, Number(fd.get("expenseApprovalLevels")) || 1));
  const old = await prisma.orgSetting.findUnique({ where: { id: 1 }, select: { expenseApprovalLevels: true } });
  await prisma.orgSetting.upsert({
    where: { id: 1 },
    update: { expenseApprovalLevels: levels },
    create: { id: 1, expenseApprovalLevels: levels },
  });
  await logAudit({ action: "UPDATE", tableName: "OrgSetting", recordId: "expenseApprovalLevels", oldValue: old, newValue: { levels } });
  revalidatePath("/settings");
  redirect(`/settings?tab=backup&card=expense&saved=${encodeURIComponent("تم حفظ سياسة اعتماد الصرفيات")}`);
}
