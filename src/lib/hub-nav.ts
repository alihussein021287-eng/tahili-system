// One place per feature: each section ("hub") has one tab bar, and each tab opens exactly one page.
// A tab whose feature has a full page of its own links straight to that page (and that page shows
// the same tab bar), instead of the hub repeating a second, partial copy of it.
export type HubNavItem = { key: string; label: string; href: string; perms: readonly string[] };

export const PATIENTS_CARE_NAV: readonly HubNavItem[] = [
  { key: "overview", label: "نظرة عامة", href: "/patients-care?tab=overview", perms: ["patients.view", "visits.view", "queue.view", "journey.view", "referrals.view", "appointments.view"] },
  { key: "patients", label: "المراجعون", href: "/patients", perms: ["patients.view"] },
  { key: "new", label: "تسجيل جديد", href: "/patients/new", perms: ["patients.create"] },
  { key: "visits", label: "الزيارات", href: "/visits", perms: ["visits.view"] },
  { key: "queue", label: "الطابور", href: "/queue", perms: ["queue.view"] },
  { key: "journey", label: "مسار الرعاية", href: "/care-board", perms: ["journey.view"] },
  { key: "referrals", label: "الفحوص والإحالات", href: "/referrals", perms: ["referrals.view"] },
  { key: "appointments", label: "المواعيد", href: "/appointments", perms: ["appointments.view"] },
  { key: "relatives", label: "مرافقون وملاحظات", href: "/patients-care?tab=relatives", perms: ["patients.view"] },
  { key: "alerts", label: "تنبيهات ومتابعة", href: "/patients-care?tab=alerts", perms: ["patients.view", "queue.view", "journey.view", "referrals.view"] },
];

/** Old hub tabs that now live on their own page: where to send an old link, keeping its filters. */
export const PATIENTS_CARE_MOVED: Record<string, { path: string; params: Record<string, string> }> = {
  patients: { path: "/patients", params: { q: "q", patientStatus: "status", branch: "branch", gov: "gov", district: "district", injury: "injury", caseType: "caseType", lastVisitFrom: "lastVisitFrom", lastVisitTo: "lastVisitTo" } },
  new: { path: "/patients/new", params: {} },
  visits: { path: "/visits", params: { visitDate: "date", branch: "branch" } },
  queue: { path: "/queue", params: { branch: "branch" } },
  journey: { path: "/care-board", params: { branch: "branch" } },
  referrals: { path: "/referrals", params: { q: "q", referralStatus: "status", referralType: "type", branch: "branch" } },
  appointments: { path: "/appointments", params: { appointmentDate: "date", appointmentStatus: "status", q: "q", branch: "branch" } },
};

export function movedTabUrl(moved: Record<string, { path: string; params: Record<string, string> }>, tab: string, sp: Record<string, string | undefined>) {
  const target = moved[tab];
  if (!target) return null;
  const out = new URLSearchParams();
  for (const [from, to] of Object.entries(target.params)) {
    const value = sp[from];
    if (value) out.set(to, value);
  }
  const query = out.toString();
  return query ? `${target.path}?${query}` : target.path;
}

export function visibleHubTabs(nav: readonly HubNavItem[], perms: ReadonlySet<string>) {
  return nav.filter((item) => item.perms.some((key) => perms.has(key))).map(({ key, label, href }) => ({ key, label, href }));
}

export const THERAPY_CENTERS_NAV: readonly HubNavItem[] = [
  { key: "overview", label: "نظرة عامة", href: "/therapy-centers?tab=overview", perms: ["therapy.view", "therapy.session.record", "centers.view", "centers.sessions.record", "beds.view", "meds.view"] },
  { key: "plans", label: "الخطط العلاجية", href: "/therapy", perms: ["therapy.view"] },
  { key: "sessions", label: "الجلسات العلاجية", href: "/therapy-centers?tab=sessions", perms: ["therapy.view", "therapy.session.record"] },
  { key: "today", label: "جلساتي اليوم", href: "/therapy/today", perms: ["therapy.session.record", "centers.sessions.record"] },
  { key: "centers", label: "المراكز والبرامج", href: "/centers", perms: ["centers.view"] },
  { key: "beds", label: "الرقود والفندقة", href: "/beds", perms: ["beds.view"] },
  { key: "meds", label: "أدوية الراقدين", href: "/meds", perms: ["meds.view"] },
  { key: "followup", label: "المتابعة والتقييمات", href: "/therapy-centers?tab=followup", perms: ["therapy.view", "centers.view"] },
];

export const THERAPY_CENTERS_MOVED: Record<string, { path: string; params: Record<string, string> }> = {
  plans: { path: "/therapy", params: { q: "q", planStatus: "status", therapyType: "type", center: "center", therapist: "therapist", headTherapist: "headTherapist", hall: "hall" } },
  program: { path: "/therapy", params: {} },
  today: { path: "/therapy/today", params: {} },
  centers: { path: "/centers", params: { center: "center", serviceType: "service", programStatus: "status", q: "q" } },
  beds: { path: "/beds", params: {} },
  meds: { path: "/meds", params: {} },
};

export const PHARMACY_NAV: readonly HubNavItem[] = [
  { key: "overview", label: "نظرة عامة", href: "/pharmacy-inventory?tab=overview", perms: ["pharmacy.view", "inventory.view", "pharmacy.purchase.view"] },
  { key: "dispense", label: "صرف الوصفات", href: "/pharmacy", perms: ["pharmacy.view"] },
  { key: "stock", label: "الأدوية والمخزون", href: "/pharmacy/stock", perms: ["pharmacy.view", "inventory.view"] },
  { key: "batches", label: "الدفعات والصلاحية", href: "/pharmacy-inventory?tab=batches", perms: ["pharmacy.view", "inventory.view"] },
  { key: "purchases", label: "أوامر الشراء", href: "/pharmacy/purchases", perms: ["pharmacy.purchase.view"] },
  { key: "receipts", label: "الاستلام", href: "/pharmacy-inventory?tab=receipts", perms: ["pharmacy.purchase.view"] },
  { key: "movements", label: "سجل الحركة", href: "/pharmacy-inventory?tab=movements", perms: ["pharmacy.view", "inventory.view"] },
  { key: "reports", label: "التقارير", href: "/pharmacy/reports", perms: ["pharmacy.view", "inventory.view", "pharmacy.purchase.view"] },
];

export const PHARMACY_MOVED: Record<string, { path: string; params: Record<string, string> }> = {
  dispense: { path: "/pharmacy", params: { rxQ: "q", rxState: "state" } },
  stock: { path: "/pharmacy/stock", params: { medQ: "q", stockState: "state" } },
  purchases: { path: "/pharmacy/purchases", params: { purchaseQ: "q", purchaseStatus: "status", purchaseSupplier: "supplier", purchaseFrom: "from", purchaseTo: "to" } },
  alerts: { path: "/pharmacy-inventory?tab=overview", params: {} },
  reports: { path: "/pharmacy/reports", params: {} },
};

export const REPORTS_FINANCE_NAV: readonly HubNavItem[] = [
  { key: "overview", label: "نظرة عامة", href: "/reports-finance?tab=overview", perms: ["reports.view", "reports.official", "finance.view", "finance.report", "expenses.view", "expenses.reports", "approvals.view", "officialdocs.view", "analytics.view", "patients.export"] },
  { key: "official", label: "التقارير الرسمية", href: "/reports-finance?tab=official", perms: ["reports.view", "reports.official"] },
  { key: "docs", label: "الوثائق الرسمية", href: "/official-docs", perms: ["officialdocs.view"] },
  { key: "patients", label: "التقارير الطبية", href: "/reports-finance?tab=patients", perms: ["reports.view", "patients.print", "clinical.report"] },
  { key: "finance", label: "الفواتير والمدفوعات", href: "/finance", perms: ["finance.view"] },
  { key: "wounded", label: "صرفيات الجرحى", href: "/finance/expenses", perms: ["expenses.view", "expenses.reports", "expenses.approve", "expenses.pay"] },
  { key: "approvals", label: "الموافقات", href: "/approvals", perms: ["approvals.view", "expenses.approve", "expenses.pay", "reports.approve"] },
  { key: "exports", label: "الصادرات", href: "/reports-finance?tab=exports", perms: ["patients.export", "patients.view", "expenses.reports", "officialdocs.view", "audit.view"] },
];

export const REPORTS_FINANCE_MOVED: Record<string, { path: string; params: Record<string, string> }> = {
  finance: { path: "/finance", params: { financeQ: "q", invoiceStatus: "status", financePatient: "patientId", from: "from", to: "to" } },
  wounded: { path: "/finance/expenses", params: { expenseStatus: "status", expensePatient: "patientId", expenseType: "type", expenseEntity: "entity", from: "from", to: "to" } },
  approvals: { path: "/approvals", params: { approvalStatus: "status", approvalType: "type" } },
  alerts: { path: "/reports-finance?tab=overview", params: {} },
};
