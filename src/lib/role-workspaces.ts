export type WorkspaceCard = {
  title: string;
  description: string;
  href: string;
  permission?: string;
  priority: number;
};

export type RoleWorkspace = {
  key: string;
  title: string;
  description: string;
  cards: WorkspaceCard[];
};

export const roleWorkspaces: RoleWorkspace[] = [
  {
    key: "reception",
    title: "الاستقبال",
    description: "تسجيل المراجعين، البحث، المواعيد، والطابور.",
    cards: [
      { title: "بحث عن مراجع", description: "الوصول السريع لملف المراجع.", href: "/search", permission: "patients.view", priority: 10 },
      { title: "المراجعين", description: "تسجيل وتحديث بيانات المراجعين.", href: "/patients-care?tab=patients", permission: "patients.view", priority: 20 },
      { title: "المواعيد", description: "إنشاء ومتابعة المواعيد.", href: "/patients-care?tab=appointments", permission: "appointments.view", priority: 30 },
      { title: "الطابور", description: "متابعة حركة المراجعين اليوم.", href: "/patients-care?tab=queue", permission: "queue.view", priority: 40 },
      { title: "استعلامات وحضور المراجعين", description: "تسجيل حضور مراجع والاستعلام عن سجل زياراته.", href: "/patients-care?tab=visits", permission: "visits.view", priority: 50 },
      { title: "محطات المركز", description: "توزيع المراجعين على محطات العمل.", href: "/station-kpis", permission: "reports.view", priority: 60 },
    ],
  },
  {
    key: "doctor",
    title: "الطبيب",
    description: "ملف المراجع، التقارير، الاعتمادات، والخطة الطبية.",
    cards: [
      { title: "ملفات المراجعين", description: "قراءة الملف الطبي والتأهيلي.", href: "/patients-care?tab=patients", permission: "patients.view", priority: 10 },
      { title: "التقارير", description: "التقارير الطبية والإدارية.", href: "/reports-finance?tab=patients", permission: "reports.view", priority: 20 },
      { title: "الاعتمادات", description: "متابعة واعتماد الإجراءات.", href: "/reports-finance?tab=approvals", permission: "approvals.view", priority: 30 },
      { title: "لوحة الرعاية", description: "متابعة الحالة والخطة.", href: "/patients-care?tab=journey", permission: "patients.view", priority: 40 },
      { title: "محطة التشخيص", description: "المراجعين المنتظرين أو قيد التشخيص.", href: "/patients-care?tab=journey", permission: "journey.view", priority: 50 },
    ],
  },
  {
    key: "therapist",
    title: "المعالج",
    description: "جلسات اليوم، المهام، متابعة التقدم، والمرفقات.",
    cards: [
      { title: "جلساتي اليوم", description: "تسجيل حضور ونتائج الجلسات المسندة.", href: "/therapy-centers?tab=today", permission: "therapy.session.record", priority: 5 },
      { title: "مساحات المراكز", description: "برامج المركز والجلسات والموارد.", href: "/therapy-centers?tab=centers", permission: "centers.view", priority: 6 },
      { title: "لوحة الرعاية", description: "متابعة خطة العلاج.", href: "/patients-care?tab=journey", permission: "patients.view", priority: 10 },
      { title: "المهام", description: "مهام وجلسات اليوم.", href: "/staff?tab=tasks", permission: "tasks.view", priority: 20 },
      { title: "عبء العمل", description: "توزيع العمل على الكادر.", href: "/workload", permission: "reports.view", priority: 30 },
      { title: "مؤشرات المحطات", description: "أداء المحطات العلاجية.", href: "/station-kpis", permission: "reports.view", priority: 40 },
    ],
  },
  {
    key: "pharmacy",
    title: "الصيدلية",
    description: "الوصفات، الصرف، المخزون، والانتهاء.",
    cards: [
      { title: "الصيدلية", description: "صرف ومتابعة الوصفات.", href: "/pharmacy-inventory?tab=dispense", permission: "pharmacy.view", priority: 10 },
      { title: "الأدوية", description: "إدارة الأدوية.", href: "/pharmacy-inventory?tab=stock", permission: "pharmacy.view", priority: 20 },
      { title: "المخزون", description: "إدارة الكميات والتنبيهات.", href: "/pharmacy-inventory?tab=stock", permission: "inventory.view", priority: 30 },
      { title: "تقارير الصيدلية", description: "تقرير صرف ومخزون.", href: "/pharmacy-inventory?tab=reports", permission: "pharmacy.view", priority: 40 },
      { title: "محطة الصيدلية", description: "مراجعين ينتظرون صرف الوصفات.", href: "/patients-care?tab=journey", permission: "journey.view", priority: 50 },
    ],
  },
  {
    key: "finance",
    title: "المالية",
    description: "الفواتير، الدفعات، الصندوق، والتقارير.",
    cards: [
      { title: "المالية", description: "الفواتير والمدفوعات.", href: "/reports-finance?tab=finance", permission: "finance.view", priority: 10 },
      { title: "صرفيات الجرحى", description: "طلبات الصرف والاعتماد والسندات.", href: "/reports-finance?tab=wounded", permission: "expenses.view", priority: 11 },
      { title: "محطة المالية", description: "المراجعين المحولين للمالية.", href: "/patients-care?tab=journey", permission: "journey.view", priority: 15 },
      { title: "التقارير", description: "تقارير مالية وإدارية.", href: "/reports-finance?tab=overview", permission: "reports.view", priority: 20 },
      { title: "المراجعين", description: "مراجعة ملف المراجع المالي.", href: "/patients-care?tab=patients", permission: "patients.view", priority: 30 },
    ],
  },
  {
    key: "admin",
    title: "الإدارة",
    description: "المؤشرات، المستخدمين، الصلاحيات، التدقيق، والنسخ الاحتياطي.",
    cards: [
      { title: "التحليلات", description: "مؤشرات عامة للنظام.", href: "/analytics", permission: "reports.view", priority: 10 },
      { title: "مؤشرات المحطات", description: "ازدحام المحطات وإنجاز اليوم.", href: "/station-kpis", permission: "reports.view", priority: 15 },
      { title: "المستخدمين", description: "إدارة حسابات المستخدمين.", href: "/users", permission: "users.manage", priority: 20 },
      { title: "الصلاحيات", description: "إدارة الأدوار والصلاحيات.", href: "/permissions", permission: "users.permissions", priority: 30 },
      { title: "سجل التدقيق", description: "مراجعة العمليات الحساسة.", href: "/audit", permission: "audit.view", priority: 40 },
      { title: "النسخ الاحتياطي", description: "تصدير واستعادة النسخ.", href: "/backup", permission: "settings.backup", priority: 50 },
    ],
  },
];

export function cardsForPermissions(perms: Set<string>) {
  return roleWorkspaces.map((workspace) => ({
    ...workspace,
    cards: workspace.cards
      .filter((card) => !card.permission || perms.has(card.permission))
      .sort((a, b) => a.priority - b.priority),
  })).filter((workspace) => workspace.cards.length > 0);
}
