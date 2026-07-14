import { prisma } from "@/lib/db";

export type AdminConfig = {
  timezone: string; locale: string; dateFormat: string; workDays: string[]; workStart: string; workEnd: string; holidays: string;
  appointmentMinutes: number; defaultSessions: number; defaultPlanDays: number; evaluationEvery: number; weakImprovementThreshold: number;
  loginAttempts: number; lockMinutes: number; sessionMinutes: number; fileTypes: string[]; maxUploadMb: number; backupRetentionDays: number;
  fileNumberPrefix: string; reportNumberPrefix: string;
};
export const ADMIN_CONFIG_DEFAULTS: AdminConfig = {
  timezone: "Asia/Baghdad", locale: "ar-IQ", dateFormat: "yyyy/MM/dd", workDays: ["0", "1", "2", "3", "4"], workStart: "08:00", workEnd: "15:00", holidays: "",
  appointmentMinutes: 30, defaultSessions: 10, defaultPlanDays: 30, evaluationEvery: 5, weakImprovementThreshold: 20,
  loginAttempts: 5, lockMinutes: 15, sessionMinutes: 480, fileTypes: ["pdf", "jpg", "jpeg", "png"], maxUploadMb: 10, backupRetentionDays: 30,
  fileNumberPrefix: "PAT", reportNumberPrefix: "REP",
};
export async function getAdminConfig(): Promise<AdminConfig> {
  const row = await prisma.orgSetting.findUnique({ where: { id: 1 }, select: { adminConfig: true } }).catch(() => null);
  return { ...ADMIN_CONFIG_DEFAULTS, ...((row?.adminConfig as Partial<AdminConfig> | null) ?? {}) };
}
