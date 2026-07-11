export const QUEUE_STATUS = { WAITING: "بالانتظار", CALLED: "تم الاستدعاء", IN_SESSION: "داخل الجلسة", DONE: "خلص" } as const;
export const PLAN_STATUS = { ACTIVE: "نشطة", COMPLETED: "مكتملة", PAUSED: "متوقفة" } as const;
export const CONFIRM_STATUS = { CONFIRMED: "مؤكّد", CANCELLED: "ملغى" } as const;
export const GENDER = { MALE: "ذكر", FEMALE: "أنثى" } as const;
export const CASE_TYPE = { WOUNDED: "جريح", SICK: "مريض" } as const;
export const KINSHIP = { FATHER: "أبوه", MOTHER: "أمه", WIFE: "زوجته", SON: "ابنه", SELF: "نفسه", NONE: "لا يوجد قرابة" } as const;
export const MARITAL = { SINGLE: "أعزب", MARRIED: "متزوج", DIVORCED: "مطلق", WIDOWED: "أرمل" } as const;
export const PATIENT_STATUS = { ACTIVE: "نشط", COMPLETED: "أنهى المراجعات", INACTIVE: "غير نشط" } as const;
export const THERAPY = { PHYSICAL: "علاج طبيعي", PSYCHIATRIC: "تأهيل نفسي", OCCUPATIONAL: "علاج وظيفي", BLADDER: "تأهيل المثانة", ULCER_CARE: "علاج تقرحات (مركز النقاء)", HYPERBARIC: "هايبر أوكسجين (مركز النقاء)" } as const;
export const DIAGNOSIS = { PRELIMINARY: "أولي", SPECIALIST: "اختصاص", GENERAL: "عام" } as const;
export const ADMISSION = { ADMITTED: "راقد", DISCHARGED: "خرج" } as const;
export const DIRECTION = { INCOMING: "وارد", OUTGOING: "صادر" } as const;

export function fmtDate(d?: Date | string | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ar-IQ", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Baghdad" });
}

export const AUDIT_TABLE: Record<string, string> = {
  devices: "الأجهزة والصيانة",
  invoices: "الفواتير",
  patients: "المراجعون", diagnoses: "التشخيصات", medical_reports: "التقارير الطبية",
  therapy_sessions: "الجلسات", prescriptions: "الوصفات", admissions: "الرقود",
  wound_assessments: "تقييم الجروح", correspondence: "المخاطبات", attachments: "المرفقات",
  relatives: "ذوو القربى", users: "المستخدمون",
};
export const AUDIT_ACTION: Record<string, string> = {
  CREATE: "إضافة", UPDATE: "تعديل", DELETE: "حذف",
};
export function fmtDateTime(d?: Date | string | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("ar-IQ", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" });
}

export const APPT_STATUS = { SCHEDULED: "مجدول", COMPLETED: "تم", CANCELLED: "ملغى", NOSHOW: "لم يحضر" } as const;
export function fmtTime(d?: Date | string | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" });
}

export const INVOICE_STATUS = { UNPAID: "غير مدفوعة", PARTIAL: "مدفوعة جزئياً", PAID: "مدفوعة" } as const;
export function fmtMoney(n?: number | null) {
  return (n ?? 0).toLocaleString("en-US") + " د.ع";
}

export const DEVICE_STATUS = { DELIVERED: "مُسلّم", DUE: "بحاجة صيانة", MAINTAINED: "تمت الصيانة", REPLACED: "مُستبدل" } as const;

export const RX_STATUS = { PENDING: "بانتظار التجهيز", DISPENSED: "جُهّزت", PARTIAL: "جزئية", REJECTED: "مرفوضة" } as const;
export const MOVE_TYPE = { IN: "إدخال", DISPENSE: "صرف", DISPOSE: "إتلاف", ADJUST: "تعديل" } as const;

export const CARE_PERIOD = { MORNING: "صباح", EVENING: "مساء", NIGHT: "ليلي" } as const;
export const CARE_KIND = { TREAT: "تداوي", DRESS: "تضميد", BOTH: "تداوي وتضميد" } as const;

export const DOC_TYPE = { LETTER: "كتاب رسمي", DECISION: "قرار", REFERRAL: "إحالة", CIRCULAR: "تعميم", OTHER: "أخرى" } as const;
export const DOC_DIRECTION = { INCOMING: "وارد", OUTGOING: "صادر" } as const;

export const APPROVAL_TYPE = { DEVICE: "صرف جهاز", REFERRAL: "إحالة خارجية", FINANCIAL: "صرف مالي", LEAVE: "إجازة", PROCEDURE: "إجراء طبي", OTHER: "أخرى" } as const;
export const APPROVAL_STATUS = { PENDING_REVIEW: "بانتظار المراجعة", PENDING_APPROVAL: "بانتظار موافقة المدير", APPROVED: "معتمد", REJECTED: "مرفوض", EXECUTED: "منفّذ" } as const;

// تفقيط: تحويل عدد الأيام إلى كتابة عربية (للنموذج الرسمي)
export function numToArabicWords(n: number): string {
  if (n == null || Number.isNaN(n)) return "";
  const ones = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة",
    "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
  const tens = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  if (n < 0) return "";
  if (n < 20) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return o ? `${ones[o]} و${tens[t]}` : tens[t];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    const hw = h === 1 ? "مئة" : h === 2 ? "مئتان" : `${ones[h]}مئة`;
    return r ? `${hw} و${numToArabicWords(r)}` : hw;
  }
  return String(n);
}
