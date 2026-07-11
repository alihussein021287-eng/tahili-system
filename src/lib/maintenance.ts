import { prisma } from "./db";
import { requireSession } from "./access";

// هل وضع الصيانة مُفعّل؟ (مفتاح بقاعدة البيانات يتحكم به الأدمن)
export async function maintenanceOn(): Promise<boolean> {
  try {
    const o = await prisma.orgSetting.findUnique({ where: { id: 1 }, select: { maintenanceMode: true } });
    return !!o?.maintenanceMode;
  } catch { return false; }
}

// حارس للإجراءات: يرمي خطأ إن لم يكن أدمن أو الوضع متوقف
export async function assertMaintenanceAdmin() {
  const s = await requireSession();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("غير مصرّح — الأدمن فقط");
  if (!(await maintenanceOn())) throw new Error("وضع الصيانة متوقف");
  return s;
}
