import { z } from "zod";

const ROLES = ["ADMIN", "MANAGER", "DOCTOR", "THERAPIST", "ACCOUNTANT", "VIEWER", "PHARMACIST", "RECEPTION", "LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS", "HEAD_THERAPIST", "DATA_ENTRY", "RESIDENT"] as const;

// نموذج إنشاء مستخدم
export const userCreateSchema = z.object({
  username: z.string().trim()
    .min(3, "اسم المستخدم 3 أحرف على الأقل")
    .regex(/^[A-Za-z0-9._-]+$/, "اسم المستخدم: حروف وأرقام إنجليزية فقط بدون فراغات"),
  fullName: z.string().trim().min(2, "الاسم الكامل مطلوب"),
  role: z.enum(ROLES).optional(),
  email: z.string().trim().email("بريد إلكتروني غير صحيح").optional().or(z.literal("")),
});

// نموذج تعديل بيانات مستخدم (بدون اسم المستخدم)
export const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2, "الاسم الكامل مطلوب"),
  role: z.enum(ROLES).optional(),
  email: z.string().trim().email("بريد إلكتروني غير صحيح").optional().or(z.literal("")),
});

// يفكّ نتيجة zod ويرمي أول رسالة خطأ واضحة
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "بيانات غير صحيحة");
  return r.data;
}

// ============ سكيمات إضافية (دفعة E) ============

// أداة: تاريخ/وقت من نص إدخال، ترمي خطأ عربي واضح لو فاسد
export const dateTimeStr = z.string().trim().min(1, "الوقت مطلوب")
  .refine((v) => !Number.isNaN(Date.parse(v)), "تاريخ/وقت غير صحيح");

export const dateStr = z.string().trim().min(1, "التاريخ مطلوب")
  .refine((v) => !Number.isNaN(Date.parse(v)), "تاريخ غير صحيح");

const cuidLike = z.string().trim().min(1);

// المواعيد
const THERAPY = ["PHYSICAL", "PSYCHIATRIC", "OCCUPATIONAL", "BLADDER", "ULCER_CARE", "HYPERBARIC"] as const;
export const appointmentCreateSchema = z.object({
  patientId: cuidLike.refine((v) => !!v, "المريض مطلوب"),
  scheduledAt: dateTimeStr,
  type: z.string().trim().optional().nullable(),
  therapyType: z.enum(THERAPY).optional().nullable().or(z.literal("")),
  assignedTo: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
const APPT_STATUS = ["SCHEDULED", "COMPLETED", "CANCELLED", "NOSHOW"] as const;
export const appointmentStatusSchema = z.enum(APPT_STATUS, {
  errorMap: () => ({ message: "حالة الموعد غير صحيحة" }),
});

// المهام
const PRIORITY = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const taskCreateSchema = z.object({
  title: z.string().trim().min(2, "عنوان المهمة مطلوب").max(300),
  description: z.string().trim().max(4000).optional().nullable(),
  priority: z.enum(PRIORITY).optional().or(z.literal("")),
  dueDate: dateStr.optional().or(z.literal("")).nullable(),
});

// الورديات والإجازات
const SHIFT = ["MORNING", "EVENING", "NIGHT", "FULL"] as const;
export const shiftAddSchema = z.object({
  name: z.string().trim().min(2, "اسم الموظف مطلوب"),
  date: dateStr,
  type: z.enum(SHIFT).optional().or(z.literal("")),
});
const LEAVE = ["ANNUAL", "SICK", "EMERGENCY", "UNPAID", "OTHER"] as const;
export const leaveRequestSchema = z.object({
  name: z.string().trim().min(2, "اسم الموظف مطلوب"),
  fromDate: dateStr,
  toDate: dateStr,
  type: z.enum(LEAVE).optional().or(z.literal("")),
}).refine((v) => Date.parse(v.toDate) >= Date.parse(v.fromDate), {
  message: "تاريخ نهاية الإجازة يجب ألا يسبق تاريخ البداية",
  path: ["toDate"],
});
