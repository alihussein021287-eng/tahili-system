import type { UserRole } from "@prisma/client";

// ===== كتالوج الصلاحيات الكامل =====
// كل إجراء/زر/تقرير له مفتاح مستقل. مجمّعة حسب القسم.
export type PermItem = { key: string; label: string; adminOnly?: boolean };
export type PermGroup = { section: string; title: string; items: PermItem[] };

export const PERM_GROUPS: PermGroup[] = [
  { section: "dashboard", title: "الرئيسية", items: [
    { key: "dashboard.view", label: "عرض الرئيسية" },
  ]},
  { section: "patients", title: "المراجعون", items: [
    { key: "patients.view", label: "عرض المراجعين" },
    { key: "patients.create", label: "إضافة مراجع" },
    { key: "patients.edit", label: "تعديل بيانات المراجع" },
    { key: "patients.delete", label: "حذف مراجع (أدمن فقط)", adminOnly: true },
    { key: "patients.archive", label: "أرشفة / استرجاع" },
    { key: "patients.import", label: "استيراد جماعي" },
    { key: "patients.export", label: "تصدير Excel" },
    { key: "patients.print", label: "طباعة بطاقة/تقرير المريض" },
    { key: "patients.portal", label: "إدارة بوابة المريض (رابط/QR)" },
  ]},
  { section: "clinical", title: "الملف السريري", items: [
    { key: "clinical.view", label: "عرض السجل السريري" },
    { key: "clinical.diagnosis", label: "تشخيصات (إضافة/حذف)" },
    { key: "clinical.session", label: "جلسات علاجية (إضافة/حذف)" },
    { key: "clinical.prescription", label: "وصفات دوائية (إضافة/حذف)" },
    { key: "clinical.admission", label: "الرقود (إضافة/تعديل/خروج)" },
    { key: "clinical.wound", label: "تقييم الجروح" },
    { key: "clinical.care", label: "التداوي والتضميد" },
    { key: "clinical.report", label: "التقارير الطبية" },
    { key: "clinical.metrics", label: "مقاييس التقدّم" },
    { key: "clinical.plan", label: "الخطة العلاجية" },
  ]},
  { section: "appointments", title: "المواعيد", items: [
    { key: "appointments.view", label: "عرض المواعيد" },
    { key: "appointments.create", label: "حجز موعد" },
    { key: "appointments.edit", label: "تعديل/نقل موعد" },
    { key: "appointments.delete", label: "حذف موعد (أدمن فقط)", adminOnly: true },
  ]},
  { section: "queue", title: "الطابور", items: [
    { key: "queue.view", label: "عرض الطابور" },
    { key: "queue.manage", label: "إدارة الطابور (استدعاء/تحريك)" },
  ]},
  { section: "visits", title: "استعلامات وحضور المراجعين", items: [
    { key: "visits.view", label: "عرض سجل الحضور والاستعلام" },
    { key: "visits.manage", label: "تسجيل حضور مراجع" },
  ]},
  { section: "beds", title: "الأسرّة والإشغال", items: [
    { key: "beds.view", label: "عرض الأسرّة" },
    { key: "beds.manage", label: "إدارة الغرف (إضافة/تعديل/حذف)" },
    { key: "beds.assign", label: "تخصيص سرير" },
  ]},
  { section: "meds", title: "أدوية الراقدين", items: [
    { key: "meds.view", label: "عرض جدول الأدوية" },
    { key: "meds.manage", label: "إضافة/تأشير جرعة" },
  ]},
  { section: "inventory", title: "المخزون", items: [
    { key: "inventory.view", label: "عرض المخزون" },
    { key: "inventory.manage", label: "إدارة المخزون" },
  ]},
  { section: "pharmacy", title: "الصيدلية", items: [
    { key: "pharmacy.view", label: "عرض الصيدلية" },
    { key: "pharmacy.dispense", label: "تجهيز الوصفات" },
    { key: "pharmacy.batch", label: "إدارة الدفعات والنفاذية" },
    { key: "pharmacy.print", label: "طباعة الوصفة" },
  ]},
  { section: "devices", title: "التسليم والصيانة", items: [
    { key: "devices.view", label: "عرض الأجهزة" },
    { key: "devices.create", label: "تسليم جهاز" },
    { key: "devices.maintain", label: "تسجيل صيانة/استبدال" },
    { key: "devices.delete", label: "حذف جهاز (أدمن فقط)", adminOnly: true },
  ]},
  { section: "workload", title: "حمل المعالجين", items: [
    { key: "workload.view", label: "عرض حمل المعالجين" },
  ]},
  { section: "attendance", title: "حضور الموظفين", items: [
    { key: "attendance.view", label: "عرض الحضور" },
    { key: "attendance.manage", label: "تسجيل حضور/انصراف" },
  ]},
  { section: "analytics", title: "التحليلات", items: [
    { key: "analytics.view", label: "عرض التحليلات" },
  ]},
  { section: "reports", title: "التقارير", items: [
    { key: "reports.view", label: "عرض التقارير" },
    { key: "reports.official", label: "التقرير الرسمي" },
    { key: "reports.print", label: "طباعة التقارير" },
    { key: "reports.approve", label: "اعتماد/توقيع التقرير الرسمي" },
  ]},
  { section: "finance", title: "المالية", items: [
    { key: "finance.view", label: "عرض المالية" },
    { key: "finance.invoice", label: "إنشاء فاتورة" },
    { key: "finance.payment", label: "تسجيل دفعة" },
    { key: "finance.delete", label: "حذف فاتورة (أدمن فقط)", adminOnly: true },
    { key: "finance.receipt", label: "طباعة وصل" },
    { key: "finance.report", label: "التقرير المالي السنوي" },
  ]},
  { section: "settings", title: "الإعدادات", items: [
    { key: "settings.view", label: "عرض الإعدادات" },
    { key: "settings.edit", label: "تعديل القوائم وهوية المركز (أدمن فقط)", adminOnly: true },
    { key: "settings.backup", label: "النسخ الاحتياطي والاستعادة" },
  ]},
  { section: "approvals", title: "سير الموافقات", items: [
    { key: "approvals.view", label: "عرض الطلبات" },
    { key: "approvals.create", label: "تقديم طلب" },
    { key: "approvals.review", label: "مراجعة (مستوى 1)" },
    { key: "approvals.approve", label: "موافقة نهائية (مدير)" },
    { key: "approvals.execute", label: "تأشير التنفيذ" },
  ]},
  { section: "sickleave", title: "الإجازات المرضية للمراجعين", items: [
    { key: "sickleave.view", label: "عرض الإجازات المرضية" },
    { key: "sickleave.manage", label: "إصدار إجازة مرضية" },
  ]},
  { section: "officialdocs", title: "الإجراءات الرسمية", items: [
    { key: "officialdocs.view", label: "عرض الأرشيف الرسمي" },
    { key: "officialdocs.manage", label: "إضافة/حذف إجراء رسمي" },
  ]},
  { section: "journey", title: "مسار متابعة المريض", items: [
    { key: "journey.view", label: "عرض المسار" },
    { key: "journey.confirm", label: "تأكيد محطة" },
    { key: "journey.manage", label: "إدارة المحطات (إضافة/حذف)" },
  ]},
  { section: "shifts", title: "المناوبات والإجازات", items: [
    { key: "shifts.view", label: "عرض المناوبات والإجازات" },
    { key: "shifts.manage", label: "إدارة المناوبات وطلب إجازة" },
    { key: "shifts.approve", label: "قبول/رفض الإجازات" },
  ]},
  { section: "tasks", title: "المهام والتحويلات", items: [
    { key: "tasks.view", label: "عرض المهام" },
    { key: "tasks.create", label: "إنشاء/إسناد مهمة" },
    { key: "tasks.complete", label: "إنجاز/إعادة فتح" },
    { key: "tasks.delete", label: "حذف مهمة (أدمن فقط)", adminOnly: true },
  ]},
  { section: "users", title: "المستخدمون والنظام", items: [
    { key: "users.view", label: "عرض المستخدمين" },
    { key: "users.manage", label: "إضافة/تعطيل/تغيير كلمة سر (أدمن فقط)", adminOnly: true },
    { key: "users.permissions", label: "إدارة الصلاحيات (أدمن فقط)", adminOnly: true },
    { key: "audit.view", label: "سجل التدقيق (أدمن فقط)", adminOnly: true },
  ]},
];

// كل المفاتيح
export const ALL_PERMS: string[] = PERM_GROUPS.flatMap((g) => g.items.map((i) => i.key));

// ===== الافتراضيات لكل دور =====
const VIEWER_DEFAULT = [
  "dashboard.view", "patients.view", "clinical.view",
  "appointments.view", "queue.view", "visits.view", "reports.view",
  "tasks.view", "tasks.create", "tasks.complete",
  "shifts.view",
  "journey.view", "journey.confirm",
  "officialdocs.view",
  "approvals.view", "approvals.create",
  "sickleave.view",
];
const THERAPIST_DEFAULT = [
  ...VIEWER_DEFAULT,
  "patients.edit", "patients.print", "patients.portal",
  "clinical.session", "clinical.metrics", "clinical.plan", "clinical.report", "clinical.wound", "clinical.care",
  "appointments.create", "appointments.edit",
  "queue.manage", "visits.manage", "meds.view", "meds.manage",
  "reports.official", "reports.print",
];
const DOCTOR_DEFAULT = [
  ...THERAPIST_DEFAULT,
  "patients.create", "patients.archive", "patients.import", "patients.export",
  "clinical.diagnosis", "clinical.prescription", "clinical.admission", "clinical.care",
  "beds.view", "beds.manage", "beds.assign",
  "inventory.view", "inventory.manage", "workload.view",
  "journey.manage", "officialdocs.manage",
  "approvals.review", "sickleave.manage",
];
const MANAGER_DEFAULT = [
  ...DOCTOR_DEFAULT,
  "pharmacy.view", "pharmacy.dispense", "pharmacy.batch", "pharmacy.print",
  "devices.view", "devices.create", "devices.maintain", 
  "attendance.view", "attendance.manage", "analytics.view",
  "finance.view", "finance.receipt", "finance.report",
  "shifts.manage", "shifts.approve", "reports.approve", "journey.manage",
  "approvals.approve", "approvals.execute",
];
const ACCOUNTANT_DEFAULT = [
  "dashboard.view", "patients.view", "reports.view",
  "tasks.view", "tasks.create", "tasks.complete",
  "finance.view", "finance.invoice", "finance.payment", "finance.receipt", "finance.report",
  "reports.official",
  "journey.view", "journey.confirm",
  "officialdocs.view",
  "approvals.view", "approvals.create",
  "sickleave.view",
];
const PHARMACIST_DEFAULT = [
  "dashboard.view", "patients.view",
  "tasks.view", "tasks.create", "tasks.complete",
  "pharmacy.view", "pharmacy.dispense", "pharmacy.batch", "pharmacy.print",
  "inventory.view", "inventory.manage",
  "journey.view", "journey.confirm",
  "officialdocs.view",
  "approvals.view", "approvals.create",
  "sickleave.view",
];

const STATION_BASE = [
  "dashboard.view", "patients.view", "clinical.view",
  "queue.view", "visits.view", "appointments.view", "reports.view",
  "tasks.view", "tasks.create", "tasks.complete",
  "journey.view", "journey.confirm",
  "officialdocs.view",
  "approvals.view", "approvals.create",
  "sickleave.view",
];
const RECEPTION_DEFAULT = [...STATION_BASE, "patients.create", "patients.edit", "patients.print", "patients.portal", "appointments.create", "appointments.edit", "queue.manage", "visits.manage", "officialdocs.manage"];
const LAB_DEFAULT = [...STATION_BASE, "clinical.report"];
const RADIOLOGY_DEFAULT = [...STATION_BASE, "clinical.report"];
const DRESSING_DEFAULT = [...STATION_BASE, "clinical.wound", "clinical.care"];
const PROSTHETICS_DEFAULT = [...STATION_BASE, "devices.view", "devices.create", "devices.maintain"];
const DATA_ENTRY_DEFAULT = [...STATION_BASE, "patients.create", "patients.edit", "patients.print", "patients.portal", "appointments.create", "appointments.edit", "queue.manage", "visits.manage"];
const HEAD_THERAPIST_DEFAULT = [...STATION_BASE,
  "patients.edit", "patients.print",
  "appointments.create", "appointments.edit", "queue.manage", "visits.manage",
  "clinical.session", "clinical.plan", "clinical.metrics", "clinical.report",
  "meds.view", "workload.view", "journey.manage", "shifts.view",
];

// الطبيب المقيم: صلاحيات المعالج + التشخيص/الإحالة (دور طبي)
const RESIDENT_DEFAULT = [
  ...THERAPIST_DEFAULT,
  "clinical.diagnosis",
];

export const ROLE_DEFAULTS: Record<UserRole, string[]> = {
  ADMIN: ALL_PERMS, // الأدمن دائماً كل الصلاحيات
  MANAGER: MANAGER_DEFAULT,
  DOCTOR: DOCTOR_DEFAULT,
  THERAPIST: THERAPIST_DEFAULT,
  ACCOUNTANT: ACCOUNTANT_DEFAULT,
  PHARMACIST: PHARMACIST_DEFAULT,
  VIEWER: VIEWER_DEFAULT,
  RECEPTION: RECEPTION_DEFAULT,
  LAB: LAB_DEFAULT,
  RADIOLOGY: RADIOLOGY_DEFAULT,
  DRESSING: DRESSING_DEFAULT,
  PROSTHETICS: PROSTHETICS_DEFAULT,
  HEAD_THERAPIST: HEAD_THERAPIST_DEFAULT,
  DATA_ENTRY: DATA_ENTRY_DEFAULT,
  RESIDENT: RESIDENT_DEFAULT,
};

export function roleDefaultSet(role: UserRole): Set<string> {
  return new Set(role === "ADMIN" ? ALL_PERMS : ROLE_DEFAULTS[role] ?? []);
}
