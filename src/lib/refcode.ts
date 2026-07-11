// الرقم المرجعي الموحّد للمريض: TH-<السنة>-<رقم الملف>
export function refCode(p: { fileNumber?: number | null; createdAt?: Date | string | null }): string {
  const year = p.createdAt ? new Date(p.createdAt).getFullYear() : new Date().getFullYear();
  const num = String(p.fileNumber ?? 0).padStart(5, "0");
  return `TH-${year}-${num}`;
}
