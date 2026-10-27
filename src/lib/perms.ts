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
    { key: "therapy.view", label: "عرض دورة العلاج الطبيعي" },
    { key: "therapy.plan.manage", label: "إنشاء وجدولة خطط العلاج الطبيعي" },
    { key: "therapy.session.record", label: "تسجيل الجلسات المسندة" },
    { key: "therapy.plan.finalize", label: "التقييم النهائي للبرنامج" },
    { key: "therapy.evaluation.periodic", label: "إدارة التقييمات الدورية" },
    { key: "therapy.improvement.update", label: "تحديث ملاحظات التقدم ونسبة التحسن" },
    { key: "therapy.specialist.assign", label: "تعيين طبيب الاختصاص للخطة" },
    { key: "therapy.schedule.reschedule", label: "إعادة جدولة جلسات العلاج" },
    { key: "therapy.admin.override", label: "تجاوز قفل الخطة والجلسات (أدمن فقط)", adminOnly: true },
  ]},
  { section: "centers", title: "مساحات المراكز", items: [
    { key: "centers.view", label: "عرض مساحات المراكز" },
    { key: "centers.central.view", label: "عرض مركزي لكل المراكز" },
    { key: "centers.memberships.manage", label: "إدارة عضويات المراكز" },
    { key: "centers.resources.manage", label: "إدارة الموارد والحجوزات" },
    { key: "centers.programs.manage", label: "قبول الإحالات وإدارة البرامج" },
    { key: "centers.sessions.record", label: "تسجيل الجلسات المسندة" },
    { key: "services.designate", label: "تعيين مسؤول الخدمة — ADMIN فقط" },
    { key: "services.assign", label: "إسناد عمل خدمة مفوضة" },
    { key: "services.execute", label: "تنفيذ عمل خدمة مسندة" },
    { key: "consents.view", label: "عرض الموافقات الموقعة" },
    { key: "consents.record", label: "تسجيل دليل موافقة موقعة" },
    { key: "consents.withdraw", label: "توثيق سحب الموافقة" },
    { key: "clinical.review.nominate", label: "ترشيح مراجع طبي — تفويض فردي للسكرتارية فقط" },
    { key: "clinical.review.accept", label: "قبول مسؤولية المراجعة الطبية" },
    { key: "centers.programs.medicalConfirm", label: "التأكيد الطبي لإغلاق البرنامج" },
    { key: "centers.programs.finalize", label: "التقييم النهائي والمتابعة" },
    { key: "centers.psych.sensitive", label: "عرض الملاحظات النفسية الحساسة" },
  ]},
  { section: "referrals", title: "الفحوص والإحالات", items: [
    { key: "referrals.view", label: "عرض طلبات الفحوص والإحالات" },
    { key: "referrals.create", label: "إنشاء طلب فحص أو إحالة" },
    { key: "referrals.print", label: "تجهيز وطباعة كتاب الإرسال" },
    { key: "referrals.updateStatus", label: "تحديث حالة الإرسال" },
    { key: "referrals.recordResult", label: "تسجيل وصول النتيجة" },
    { key: "referrals.reviewResult", label: "مراجعة النتيجة طبياً" },
    { key: "referrals.accept", label: "قبول الإحالة الداخلية" },
    { key: "referrals.cancel", label: "إلغاء طلب مع السبب" },
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
  { section: "handoff", title: "تسليم المراجع", items: [
    { key: "handoff.send", label: "إرسال تسليم المراجع" },
    { key: "handoff.receive", label: "استلام تسليم المراجع" },
    { key: "handoff.manage", label: "إدارة التحويلات: أخذ/إلغاء/إعادة توجيه" },
  ]},
  { section: "visits", title: "استعلامات وحضور المراجعين", items: [
    { key: "visits.view", label: "عرض سجل الحضور والاستعلام" },
    { key: "visits.manage", label: "تسجيل حضور مراجع" },
  ]},
  { section: "beds", title: "الرقود والفندقة", items: [
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
    { key: "pharmacy.dispense.partial", label: "الصرف الجزئي" },
    { key: "pharmacy.purchase.view", label: "عرض أوامر الشراء" },
    { key: "pharmacy.purchase.create", label: "إنشاء أوامر الشراء" },
    { key: "pharmacy.purchase.approve", label: "اعتماد أوامر الشراء" },
    { key: "pharmacy.purchase.receive", label: "استلام أوامر الشراء" },
    { key: "pharmacy.purchase.prices", label: "عرض أسعار الشراء" },
    { key: "pharmacy.purchase.override", label: "تجاوز كمية الاستلام مع السبب (أدمن فقط)", adminOnly: true },
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
    { key: "reports.medical.approve", label: "اعتماد التقرير الطبي للمراجع بعد الطباعة" },
  ]},
  { section: "finance", title: "المالية", items: [
    { key: "finance.view", label: "عرض المالية" },
    { key: "finance.invoice", label: "إنشاء فاتورة" },
    { key: "finance.payment", label: "تسجيل دفعة" },
    { key: "finance.delete", label: "حذف فاتورة (أدمن فقط)", adminOnly: true },
    { key: "finance.receipt", label: "طباعة وصل" },
    { key: "finance.report", label: "التقرير المالي السنوي" },
    { key: "expenses.view", label: "عرض صرفيات الجرحى" },
    { key: "expenses.create", label: "إنشاء مسودة صرفية" },
    { key: "expenses.submit", label: "تقديم الصرفية للاعتماد" },
    { key: "expenses.approve", label: "اعتماد أو رفض الصرفية" },
    { key: "expenses.pay", label: "تنفيذ الصرف" },
    { key: "expenses.amounts", label: "عرض مبالغ الصرفيات" },
    { key: "expenses.print", label: "طباعة سند الصرف" },
    { key: "expenses.reports", label: "تقارير صرفيات الجرحى" },
    { key: "expenses.correct", label: "إلغاء أو تصحيح أو عكس الصرفية" },
  ]},
  { section: "datacenter", title: "استيراد وتصدير البيانات", items: [
    { key: "datacenter.view", label: "فتح مركز البيانات وسجل عملياته" },
    { key: "datacenter.import.patients", label: "استيراد المراجعين (معاينة)" },
    { key: "datacenter.import.personnel", label: "استيراد الموظفين والأطباء المقيمين وأطباء الاختصاص (معاينة)" },
    { key: "datacenter.import.accounts", label: "استيراد هويات الحسابات (غير مفعّلة)" },
    { key: "datacenter.import.memberships", label: "استيراد عضويات المراكز الموثّقة" },
    { key: "datacenter.import.apply", label: "تنفيذ الاستيراد المعتمد (مقفل ما لم يُفعَّل بيئياً)" },
    { key: "datacenter.export.patients", label: "تصدير الحقول الإدارية للمراجعين" },
    { key: "datacenter.export.personnel", label: "تصدير سجلات الموظفين والأطباء" },
    { key: "datacenter.export.users", label: "تصدير قائمة المستخدمين دون أسرار" },
    { key: "datacenter.export.reference", label: "تصدير قوائم الفروع والمراكز" },
    { key: "datacenter.export.appointments", label: "تصدير ملخص المواعيد والجلسات" },
    { key: "datacenter.export.pharmacy", label: "تصدير مخزون وحركات صيدلية الفرع" },
    { key: "datacenter.export.finance", label: "تصدير الملخصات المالية التشغيلية" },
  ]},
  { section: "settings", title: "الإعدادات", items: [
    { key: "settings.view", label: "عرض الإعدادات" },
    { key: "settings.edit", label: "تعديل وحفظ الإعدادات" },
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
  { section: "collaboration", title: "مركز التعاون", items: [
    { key: "collaboration.view", label: "عرض مركز التعاون" },
    { key: "chat.create", label: "إنشاء محادثة أو مجموعة" },
    { key: "chat.send", label: "إرسال رسائل ومرفقات" },
    { key: "chat.manage.members", label: "إدارة أعضاء وقنوات التعاون" },
    { key: "chat.moderate", label: "تثبيت وحذف رسائل بصفة مشرف" },
    { key: "files.view", label: "عرض مركز الملفات" },
    { key: "files.upload", label: "رفع ملفات التعاون" },
    { key: "files.download", label: "تنزيل ومعاينة الملفات" },
    { key: "files.edit", label: "تعديل بيانات الملفات وإصداراتها" },
    { key: "files.share", label: "مشاركة وإلغاء مشاركة الملفات" },
    { key: "files.delete", label: "نقل الملفات إلى السلة" },
    { key: "files.restore", label: "استرجاع الملفات من السلة" },
    { key: "files.delete.permanent", label: "حذف نهائي للملفات (أدمن فقط)", adminOnly: true },
    { key: "files.audit", label: "عرض سجل عمليات الملفات" },
    { key: "files.admin", label: "إدارة خدمة التعاون والفحص والحصص", adminOnly: true },
  ]},
  { section: "users", title: "المستخدمون والنظام", items: [
    { key: "users.view", label: "عرض المستخدمين" },
    { key: "employees.view", label: "عرض سجلات الموظفين (ضمن فرع المستخدم)" },
    { key: "employees.edit", label: "تعديل بيانات سجلات الموظفين (ضمن فرع المستخدم)" },
    { key: "users.manage", label: "إضافة/تعطيل/تغيير كلمة سر (أدمن فقط)", adminOnly: true },
    { key: "users.permissions", label: "إدارة الصلاحيات (أدمن فقط)", adminOnly: true },
    { key: "audit.view", label: "سجل التدقيق (أدمن فقط)", adminOnly: true },
  ]},
];

// كل المفاتيح
export const ALL_PERMS: string[] = PERM_GROUPS.flatMap((g) => g.items.map((i) => i.key));

// ===== الافتراضيات لكل دور =====
const COLLABORATION_DEFAULT = [
  "collaboration.view", "chat.create", "chat.send",
  "files.view", "files.upload", "files.download", "files.edit", "files.share",
];
const COLLABORATION_SUPERVISOR_DEFAULT = [
  ...COLLABORATION_DEFAULT,
  "chat.manage.members", "chat.moderate", "files.delete", "files.restore", "files.audit",
];
const VIEWER_DEFAULT = [
  "dashboard.view", "patients.view", "clinical.view",
  "appointments.view", "queue.view", "visits.view", "reports.view",
  "tasks.view", "tasks.create", "tasks.complete",
  "shifts.view",
  "journey.view", "journey.confirm",
  "officialdocs.view",
  "approvals.view", "approvals.create",
  "sickleave.view",
  ...COLLABORATION_DEFAULT,
];
const THERAPIST_DEFAULT = [
  ...VIEWER_DEFAULT,
  "handoff.send", "handoff.receive",
  "patients.edit", "patients.print",
  "clinical.session", "clinical.metrics", "clinical.plan", "clinical.report", "clinical.wound", "clinical.care",
  "therapy.view", "therapy.session.record", "therapy.improvement.update",
  "centers.view", "centers.sessions.record",
  "reports.official", "reports.print",
];
// الطبيب يملك القرار الطبي والمراجعة، وليس أعمال التسجيل أو الاستقبال أو المخزون.
// لا نرث قائمة المعالج هنا حتى لا تصل للطبيب صلاحيات الجلسات التنفيذية أو المواعيد
// الإدارية بالصدفة.
const DOCTOR_DEFAULT = [
  "clinical.review.accept", "centers.programs.medicalConfirm",
  ...VIEWER_DEFAULT,
  "handoff.send", "handoff.receive",
  "patients.view", "patients.edit", "patients.print",
  "clinical.diagnosis", "clinical.prescription", "clinical.admission",
  "clinical.wound", "clinical.care", "clinical.report", "clinical.metrics", "clinical.plan",
  "reports.print", // approved 2026-10: treating doctor/consultant may print a patient's medical report (scope still per patient)
  "therapy.view", "therapy.plan.finalize", "therapy.specialist.assign",
  "centers.view", "centers.central.view", "centers.programs.finalize", "centers.psych.sensitive",
  "beds.view", "beds.manage", "beds.assign",
  "journey.manage", "sickleave.manage",
  "referrals.view", "referrals.create", "referrals.updateStatus", "referrals.reviewResult", "referrals.accept", "referrals.cancel",
];
const MANAGER_DEFAULT = [
  ...DOCTOR_DEFAULT.filter((permission) => !permission.startsWith("referrals.") && !permission.startsWith("clinical.review.") && permission !== "centers.programs.medicalConfirm"),
  "reports.medical.approve", // only the authorized manager (and ADMIN) approves a printed medical report
  "pharmacy.view", "pharmacy.dispense", "pharmacy.batch", "pharmacy.print",
  "pharmacy.dispense.partial", "pharmacy.purchase.view", "pharmacy.purchase.create", "pharmacy.purchase.approve", "pharmacy.purchase.receive", "pharmacy.purchase.prices",
  "devices.view", "devices.create", "devices.maintain", 
  "attendance.view", "attendance.manage", "analytics.view",
  "inventory.view", "inventory.manage", "workload.view",
  "officialdocs.manage", "approvals.review", "sickleave.manage",
  "finance.view", "finance.receipt", "finance.report",
  "expenses.view", "expenses.approve", "expenses.amounts", "expenses.print", "expenses.reports", "expenses.correct",
  "shifts.manage", "shifts.approve", "reports.approve", "journey.manage",
  "approvals.approve", "approvals.execute",
  "referrals.view", "referrals.print", "referrals.updateStatus",
  "handoff.manage",
  "centers.view", "centers.central.view", "centers.memberships.manage", "centers.resources.manage", "centers.programs.manage", "centers.programs.finalize", "centers.psych.sensitive",
  ...COLLABORATION_SUPERVISOR_DEFAULT,
];
const ACCOUNTANT_DEFAULT = [
  "dashboard.view", "patients.view", "reports.view",
  "tasks.view", "tasks.create", "tasks.complete",
  "finance.view", "finance.invoice", "finance.payment", "finance.receipt", "finance.report",
  "expenses.view", "expenses.create", "expenses.submit", "expenses.pay", "expenses.amounts", "expenses.print", "expenses.reports", "expenses.correct",
  "reports.official",
  ...COLLABORATION_DEFAULT,
];
const PHARMACIST_DEFAULT = [
  "dashboard.view", "patients.view",
  "tasks.view", "tasks.create", "tasks.complete",
  "pharmacy.view", "pharmacy.dispense", "pharmacy.batch", "pharmacy.print",
  "pharmacy.dispense.partial", "pharmacy.purchase.view", "pharmacy.purchase.create", "pharmacy.purchase.receive",
  "inventory.view", "inventory.manage",
  ...COLLABORATION_DEFAULT,
];

const STATION_BASE = [
  "dashboard.view", "patients.view", "clinical.view",
  "queue.view", "visits.view", "appointments.view", "reports.view",
  "tasks.view", "tasks.create", "tasks.complete",
  "journey.view", "journey.confirm",
  "officialdocs.view",
  "approvals.view", "approvals.create",
  "sickleave.view",
  ...COLLABORATION_DEFAULT,
];
// الاستقبال ليس محطة سريرية عامة: عمله يقتصر على الملف الإداري الموجود،
// المواعيد، الحضور والطابور، ثم تسليم المراجع إلى المحطة التالية عند الحاجة.
const RECEPTION_DEFAULT = [
  "dashboard.view",
  "patients.view", "patients.edit", "patients.print",
  "appointments.view", "appointments.create", "appointments.edit",
  "visits.view", "visits.manage",
  "queue.view", "queue.manage",
  "handoff.send", "handoff.receive",
  ...COLLABORATION_DEFAULT,
];
const LAB_DEFAULT = [...STATION_BASE, "clinical.report"];
const RADIOLOGY_DEFAULT = [...STATION_BASE, "clinical.report"];
const DRESSING_DEFAULT = [...STATION_BASE, "clinical.wound", "clinical.care"];
const PROSTHETICS_DEFAULT = [...STATION_BASE, "devices.view", "devices.create", "devices.maintain"];
// مدخل البيانات يجهّز الملف والإحالة إدارياً؛ لا يشارك الاستقبال الحضور أو الطابور،
// ولا يرث صلاحيات محطة سريرية أو عامة لا يحتاجها لإنجاز هذه المهمة.
const DATA_ENTRY_DEFAULT = [
  "dashboard.view",
  "patients.view", "patients.create", "patients.edit", "patients.print",
  "appointments.view", "appointments.create", "appointments.edit",
  "visits.view", "queue.view",
  "referrals.view", "referrals.print", "referrals.updateStatus", "referrals.recordResult",
  "handoff.send", "handoff.receive",
  ...COLLABORATION_DEFAULT,
];
// السكرتارية تتابع الملفات والمواعيد والإحالات إدارياً بين الأقسام،
// ولا تنشئ ملفاً ولا تنفذ حضوراً أو طابوراً أو إجراءً طبياً.
const SECRETARY_DEFAULT = [
  "dashboard.view",
  "patients.view", "patients.edit", "patients.print",
  "reports.print", // approved 2026-10: medical secretary prints reports of patients inside her/his branch scope
  "appointments.view", "appointments.create", "appointments.edit",
  "visits.view", "queue.view",
  "referrals.view", "referrals.print", "referrals.updateStatus",
  "handoff.send", "handoff.receive",
  ...COLLABORATION_DEFAULT,
];
const HEAD_THERAPIST_DEFAULT = [...STATION_BASE,
  "handoff.send", "handoff.receive",
  "patients.edit", "patients.print",
  "clinical.session", "clinical.plan", "clinical.metrics", "clinical.report",
  "therapy.view", "therapy.plan.manage", "therapy.plan.finalize",
  "therapy.evaluation.periodic", "therapy.improvement.update", "therapy.specialist.assign", "therapy.schedule.reschedule",
  "centers.view", "centers.resources.manage", "centers.programs.manage", "centers.programs.finalize", "centers.psych.sensitive",
  "workload.view", "journey.manage", "shifts.view", "referrals.view", "referrals.accept",
  ...COLLABORATION_SUPERVISOR_DEFAULT,
];

// الطبيب المقيم محطة سريرية أولية: يشخّص وينشئ/يتابع الإحالة، ثم يسلّم القرار
// للطبيب. لا ينشئ ملفاً ولا يحجز موعداً ولا يراجع النتيجة طبياً.
const RESIDENT_DEFAULT = [
  ...VIEWER_DEFAULT,
  "handoff.send", "handoff.receive",
  "patients.view", "patients.edit", "patients.print",
  "clinical.session", "clinical.metrics", "clinical.plan", "clinical.report", "clinical.wound", "clinical.care",
  "therapy.view", "centers.view", "centers.sessions.record",
  "meds.view", "reports.official", "reports.print",
  "clinical.diagnosis",
  "referrals.view", "referrals.create", "referrals.updateStatus", "referrals.recordResult", "referrals.cancel",
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
  SECRETARY: SECRETARY_DEFAULT,
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
