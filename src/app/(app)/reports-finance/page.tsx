import Link from "next/link";
import { redirect } from "next/navigation";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, StatCard } from "@/components/AdminPageSections";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { REPORTS_FINANCE_MOVED, REPORTS_FINANCE_NAV, movedTabUrl } from "@/lib/hub-nav";
import { TableEmptyRow } from "@/components/Ui";
import { currentPerms, requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { APPROVAL_STATUS, APPROVAL_TYPE, DOC_DIRECTION, DOC_TYPE, INVOICE_STATUS, fmtDate, fmtDateTime, fmtMoney } from "@/lib/labels";
import { invoiceViewWhere } from "@/lib/patient-guard";

export const dynamic = "force-dynamic";

type ReportsFinanceTab = "overview" | "official" | "patients" | "exports";

// Invoices (/finance), wounded expenses (/finance/expenses), approvals (/approvals) and the
// official documents archive (/official-docs) are their own pages; see REPORTS_FINANCE_NAV.
const TABS: { key: ReportsFinanceTab; title: string; description: string; perms: string[] }[] = [
  { key: "overview", title: "لوحة التقارير والمالية", description: "ملخص التقارير والفواتير والصرفيات والاعتمادات، وما يحتاج متابعة.", perms: ["reports.view", "reports.official", "finance.view", "finance.report", "expenses.view", "expenses.reports", "approvals.view", "officialdocs.view", "analytics.view", "patients.export"] },
  { key: "official", title: "التقارير الرسمية", description: "حالة التقرير الرسمي الشهري والإحصائي، وروابط التقارير.", perms: ["reports.view", "reports.official"] },
  { key: "patients", title: "التقارير الطبية", description: "التقارير الطبية المسجلة للمراجعين حسب التاريخ، النوع، الحالة، والمراجع.", perms: ["reports.view", "patients.print", "clinical.report"] },
  { key: "exports", title: "الصادرات والملفات", description: "روابط التصدير المتاحة حسب الصلاحيات، مع سجل الصادرات إذا كان التدقيق متاحاً.", perms: ["patients.export", "patients.view", "expenses.reports", "officialdocs.view", "audit.view"] },
];

const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

const MEDICAL_REPORT_TYPE: Record<string, string> = { PRELIMINARY: "أولي", FINAL: "نهائي" };
const MEDICAL_REPORT_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "مسودة", cls: "bg-gray-100 text-gray-600" },
  READY_TO_PRINT: { label: "جاهز للطباعة", cls: "bg-amber-50 text-amber-700" },
  PRINTED_APPROVED: { label: "مطبوع ومعتمد", cls: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "ملغى", cls: "bg-red-50 text-red-700" },
};
const EXPENSE_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "مسودة", cls: "bg-gray-100 text-gray-600" },
  SUBMITTED: { label: "بانتظار الاعتماد", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "معتمدة", cls: "bg-sky-50 text-sky-700" },
  REJECTED: { label: "مرفوضة", cls: "bg-red-50 text-red-700" },
  READY_FOR_PAYMENT: { label: "جاهزة للصرف", cls: "bg-brand-50 text-brand-700" },
  PAID: { label: "مصروفة", cls: "bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "ملغاة", cls: "bg-gray-100 text-gray-500" },
};
const INVOICE_STATUS_STYLE: Record<string, string> = {
  UNPAID: "bg-red-50 text-red-700",
  PARTIAL: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700",
};
const APPROVAL_STYLE: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-100 text-amber-700",
  PENDING_APPROVAL: "bg-sky-100 text-sky-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  EXECUTED: "bg-brand-100 text-brand-700",
};

type Search = Record<string, string | undefined>;

function hasAny(perms: Set<string>, keys: string[]) {
  return keys.some((key) => perms.has(key));
}

function normalizeTab(raw: string | undefined, visible: typeof TABS): ReportsFinanceTab {
  return (visible.some((tab) => tab.key === raw) ? raw : visible[0]?.key) as ReportsFinanceTab;
}

function tabHref(key: ReportsFinanceTab) {
  return `/reports-finance?tab=${key}`;
}

function localDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateStart(value?: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function dateEnd(value?: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function dateRange(sp: Search) {
  const from = dateStart(sp.from);
  const to = dateEnd(sp.to);
  return from || to ? { gte: from ?? undefined, lte: to ?? undefined } : undefined;
}

function optionEntries(record: Record<string, string>) {
  return Object.entries(record).map(([value, label]) => ({ value, label }));
}

function moneyFromDecimal(value: unknown, currency = "IQD") {
  return `${new Intl.NumberFormat("ar-IQ").format(Number(value ?? 0))} ${currency}`;
}

function buildParams(sp: Search, keys: string[]) {
  const params = new URLSearchParams();
  for (const key of keys) if (sp[key]) params.set(key, sp[key]!);
  return params.toString();
}

function badge(text: string, cls: string) {
  return <span className={`badge ${cls}`}>{text}</span>;
}

function emptyRow(colSpan: number, text = "لا توجد نتائج مطابقة.") {
  return <TableEmptyRow colSpan={colSpan} title={text} description="غيّر الفلاتر أو ستظهر السجلات هنا عند توفرها ضمن صلاحياتك." />;
}

export default async function ReportsFinancePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireSession();
  const sp = await searchParams;
  const moved = sp.tab ? movedTabUrl(REPORTS_FINANCE_MOVED, sp.tab, sp) : null;
  if (moved) redirect(moved);
  const perms = await currentPerms();

  const canReports = perms.has("reports.view");
  const canOfficialReports = perms.has("reports.official");
  const canReportApprove = perms.has("reports.approve");
  const canReportPrint = perms.has("reports.print");
  const canPatientReportRows = canReports && perms.has("patients.view");
  const canFinance = perms.has("finance.view");
  const canFinanceReport = perms.has("finance.report");
  const canFinanceAmounts = canFinance || canFinanceReport;
  const canExpenses = perms.has("expenses.view");
  const canExpenseReports = perms.has("expenses.reports");
  const canExpenseAmounts = perms.has("expenses.amounts");
  const canExpenseCreate = perms.has("expenses.create");
  const canExpenseApprove = perms.has("expenses.approve");
  const canExpensePay = perms.has("expenses.pay");
  const canApprovals = perms.has("approvals.view");
  const canOfficialDocs = perms.has("officialdocs.view");
  const canAudit = perms.has("audit.view");
  const canPatientsExport = perms.has("patients.export");

  const visibleTabs = TABS.filter((tab) => hasAny(perms, tab.perms));
  if (!visibleTabs.length) redirect("/");
  const activeTab = normalizeTab(sp.tab, visibleTabs);
  const requestedTab = sp.tab && TABS.some((tab) => tab.key === sp.tab) ? sp.tab : activeTab;
  if (requestedTab !== activeTab) redirect(tabHref(activeTab));

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const monthStart = new Date(currentYear, currentMonth, 1);
  const nextMonth = new Date(currentYear, currentMonth + 1, 1);
  const range = dateRange(sp);
  const activeInfo = TABS.find((tab) => tab.key === activeTab)!;

  const reportWhere: any = {};
  if (range) reportWhere.date = range;
  if (sp.reportStatus && sp.reportStatus !== "all") reportWhere.status = sp.reportStatus;
  if (sp.reportType && sp.reportType !== "all") reportWhere.reportType = sp.reportType;
  if (sp.reportPatient) {
    reportWhere.patient = { fullName: { contains: sp.reportPatient.trim(), mode: "insensitive" } };
  }

  const invoiceWhere: any = { AND: [await invoiceViewWhere()] };
  if (range) invoiceWhere.issuedAt = range;
  if (sp.invoiceStatus && sp.invoiceStatus !== "all") invoiceWhere.status = sp.invoiceStatus;
  if (sp.financePatient) invoiceWhere.patientId = sp.financePatient;
  if (sp.financeQ) {
    invoiceWhere.OR = [
      { patient: { fullName: { contains: sp.financeQ.trim(), mode: "insensitive" } } },
      { description: { contains: sp.financeQ.trim(), mode: "insensitive" } },
    ];
  }

  const expenseWhere: any = {};
  if (range) expenseWhere.requestDate = range;
  if (sp.expenseStatus && sp.expenseStatus !== "all") expenseWhere.status = sp.expenseStatus;
  if (sp.expensePatient) expenseWhere.patientId = sp.expensePatient;
  if (sp.expenseType) expenseWhere.expenseType = { contains: sp.expenseType.trim(), mode: "insensitive" };
  if (sp.expenseEntity) expenseWhere.beneficiaryEntity = { contains: sp.expenseEntity.trim(), mode: "insensitive" };

  const approvalWhere: any = {};
  if (range) approvalWhere.createdAt = range;
  if (sp.approvalStatus && sp.approvalStatus !== "all") approvalWhere.status = sp.approvalStatus;
  if (sp.approvalType && sp.approvalType !== "all") approvalWhere.reqType = sp.approvalType;

  const docWhere: any = {};
  if (range) docWhere.docDate = range;
  if (sp.docType && sp.docType !== "all") docWhere.docType = sp.docType;
  if (sp.docDirection && sp.docDirection !== "all") docWhere.direction = sp.docDirection;
  if (sp.docQ) {
    const q = sp.docQ.trim();
    docWhere.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { entity: { contains: q, mode: "insensitive" } },
      { patient: { fullName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [
    patients,
    reportsThisMonth,
    officialDocsThisMonth,
    readyMedicalReports,
    officialApprovals,
    medicalReports,
    recentReportApprovals,
    invoices,
    invoiceAgg,
    unpaidInvoices,
    paymentsThisMonth,
    expenses,
    expenseAgg,
    submittedExpenses,
    readyExpenses,
    overdueExpenses,
    approvalRequests,
    pendingApprovals,
    officialDocs,
    exportLogs,
  ] = await Promise.all([
    Promise.resolve([] as any[]),
    canReports ? prisma.medicalReport.count({ where: { date: { gte: monthStart, lt: nextMonth } } }) : Promise.resolve(0),
    canOfficialDocs ? prisma.officialDocument.count({ where: { docDate: { gte: monthStart, lt: nextMonth } } }) : Promise.resolve(0),
    canReports ? prisma.medicalReport.count({ where: { status: "READY_TO_PRINT" } }) : Promise.resolve(0),
    canOfficialReports || canReports
      ? prisma.reportApproval.findMany({ where: { OR: [{ kind: "official-monthly", refKey: `${currentYear}-${currentMonth}` }, { kind: "official-stat", refKey: `m-${currentYear}-${currentMonth}` }] } })
      : Promise.resolve([]),
    canPatientReportRows && activeTab === "patients"
      ? prisma.medicalReport.findMany({
          where: reportWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true, branch: { select: { name: true } } } } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 200,
        })
      : Promise.resolve([]),
    canOfficialReports || canReports || canReportApprove
      ? prisma.reportApproval.findMany({ where: { kind: { in: ["official-monthly", "official-stat", "patient-report"] } }, orderBy: { approvedAt: "desc" }, take: 10 })
      : Promise.resolve([]),
    Promise.resolve([] as any[]),
    canFinanceAmounts ? prisma.invoice.aggregate({ where: invoiceWhere, _sum: { amount: true, paidAmount: true }, _count: { _all: true } }) : Promise.resolve(null),
    canFinance ? prisma.invoice.count({ where: { status: { in: ["UNPAID", "PARTIAL"] }, AND: [await invoiceViewWhere()] } }) : Promise.resolve(0),
    canFinanceAmounts ? prisma.payment.aggregate({ where: { paidAt: { gte: monthStart, lt: nextMonth } }, _sum: { amount: true }, _count: { _all: true } }) : Promise.resolve(null),
    Promise.resolve([] as any[]),
    canExpenseAmounts && (canExpenses || canExpenseReports)
      ? prisma.woundedExpense.aggregate({ where: expenseWhere, _sum: { amount: true }, _count: { _all: true } })
      : Promise.resolve(null),
    canExpenses || canExpenseApprove ? prisma.woundedExpense.count({ where: { status: "SUBMITTED" } }) : Promise.resolve(0),
    canExpenses || canExpensePay ? prisma.woundedExpense.count({ where: { status: "READY_FOR_PAYMENT" } }) : Promise.resolve(0),
    canExpenses || canExpenseApprove || canExpensePay
      ? prisma.woundedExpense.count({ where: { dueDate: { lt: now }, status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "READY_FOR_PAYMENT"] } } })
      : Promise.resolve(0),
    Promise.resolve([] as any[]),
    canApprovals ? prisma.approvalRequest.count({ where: { status: { in: ["PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED"] } } }) : Promise.resolve(0),
    Promise.resolve([] as any[]),
    canAudit
      ? prisma.auditLog.findMany({ where: { tableName: "wounded_expenses", recordId: "REPORT" }, orderBy: { createdAt: "desc" }, take: 8 })
      : Promise.resolve([]),
  ]);

  const monthlyOfficialApproved = officialApprovals.some((row: any) => row.kind === "official-monthly");
  const monthlyStatApproved = officialApprovals.some((row: any) => row.kind === "official-stat");
  const pendingOfficialReports = (canOfficialReports && !monthlyOfficialApproved ? 1 : 0) + (canReports && !monthlyStatApproved ? 1 : 0);
  const reportsPendingApproval = pendingOfficialReports + readyMedicalReports;
  const invoiceTotal = Number((invoiceAgg as any)?._sum?.amount ?? 0);
  const invoiceCollected = Number((invoiceAgg as any)?._sum?.paidAmount ?? 0);
  const invoiceOutstanding = invoiceTotal - invoiceCollected;
  const expenseTotal = Number((expenseAgg as any)?._sum?.amount ?? 0);
  const expenseCount = Number((expenseAgg as any)?._count?._all ?? 0);
  const monthPayments = Number((paymentsThisMonth as any)?._sum?.amount ?? 0);
  const reportsCount = reportsThisMonth + officialDocsThisMonth;
  const expenseExportQs = buildParams(sp, ["from", "to", "expensePatient", "expenseType", "expenseStatus", "expenseEntity"])
    .replace("expensePatient=", "patientId=")
    .replace("expenseType=", "type=")
    .replace("expenseStatus=", "status=")
    .replace("expenseEntity=", "entity=");

  const alertRows = [
    canOfficialReports && !monthlyOfficialApproved ? { label: "التقرير الرسمي الشهري غير معتمد", detail: `${MONTHS[currentMonth]} ${currentYear}`, href: `/reports/official?year=${currentYear}&month=${currentMonth}`, tone: "warning" } : null,
    canReports && !monthlyStatApproved ? { label: "التقرير الإحصائي الرسمي غير معتمد", detail: `${MONTHS[currentMonth]} ${currentYear}`, href: `/reports/statistical?ptype=month&year=${currentYear}&month=${currentMonth}`, tone: "warning" } : null,
    canReports && readyMedicalReports > 0 ? { label: "تقارير مراجع جاهزة للطباعة", detail: `${readyMedicalReports} تقرير`, href: "/reports-finance?tab=patients&reportStatus=READY_TO_PRINT", tone: "warning" } : null,
    (canExpenses || canExpenseApprove) && submittedExpenses > 0 ? { label: "صرفيات بانتظار الاعتماد", detail: `${submittedExpenses} صرفية`, href: "/finance/expenses?status=SUBMITTED", tone: "danger" } : null,
    (canExpenses || canExpensePay) && readyExpenses > 0 ? { label: "صرفيات جاهزة للصرف", detail: `${readyExpenses} صرفية`, href: "/finance/expenses?status=READY_FOR_PAYMENT", tone: "warning" } : null,
    (canExpenses || canExpenseApprove || canExpensePay) && overdueExpenses > 0 ? { label: "صرفيات متأخرة", detail: `${overdueExpenses} صرفية بتاريخ استحقاق سابق`, href: "/finance/expenses?status=overdue", tone: "danger" } : null,
    canFinance && unpaidInvoices > 0 ? { label: "فواتير غير مكتملة التحصيل", detail: `${unpaidInvoices} فاتورة`, href: "/finance?status=UNPAID", tone: "warning" } : null,
    canApprovals && pendingApprovals > 0 ? { label: "طلبات موافقة تحتاج متابعة", detail: `${pendingApprovals} طلب`, href: "/approvals", tone: "warning" } : null,
  ].filter(Boolean) as { label: string; detail: string; href: string; tone: string }[];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="التقارير والمالية" subtitle="صفحة جامعة للتقارير، الفواتير، الصرفيات، الاعتمادات، والتصدير" icon="📊" />
      <HubTabs nav={REPORTS_FINANCE_NAV} active={activeTab} label="تبويبات التقارير والمالية" perms={perms} />
      <AdminIntro title={activeInfo.title} description={activeInfo.description}>
        {activeTab === "overview" ? (
          <div className="flex flex-wrap gap-2">
            {canOfficialReports ? <Link href="/reports/official" className="btn-ghost btn-sm">إنشاء/فتح تقرير رسمي</Link> : null}
            {canReports ? <Link href="/reports" className="btn-ghost btn-sm">فتح تقارير المراجعين</Link> : null}
            {canPatientsExport ? <a href="/api/export/full" className="btn-ghost btn-sm">تصدير شامل</a> : null}
          </div>
        ) : null}
      </AdminIntro>

      {activeTab === "overview" ? (
        <section className="space-y-3" aria-labelledby="reports-summary-title">
          <h2 id="reports-summary-title" className="font-semibold text-gray-900">ملخص التقارير والمالية</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {canReports || canOfficialDocs ? <StatCard label="تقارير ووثائق هذا الشهر" value={reportsCount} /> : null}
            {canReports || canOfficialReports ? <StatCard label="تقارير تحتاج اعتماد" value={reportsPendingApproval} tone="text-amber-700" /> : null}
            {canExpenses || canExpenseApprove ? <StatCard label="صرفيات قيد الاعتماد" value={submittedExpenses} tone="text-amber-700" /> : null}
            {canExpenses || canExpensePay ? <StatCard label="جاهزة للصرف" value={readyExpenses} tone="text-brand-700" /> : null}
            {canExpenses || canExpenseReports ? <StatCard label="المصروف/المعلق" value={canExpenseAmounts ? moneyFromDecimal(expenseTotal) : "مخفي"} description={canExpenseAmounts ? `${expenseCount} سجل ضمن الفلتر` : "يتطلب صلاحية عرض المبالغ"} /> : null}
            {canAudit ? <StatCard label="صادرات حديثة" value={exportLogs.length} description="من سجل التدقيق المتاح" /> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <AdminSection id="overview-finance" title="ملخص مالي وتشغيلي" description="المبالغ تظهر فقط لمن يملك صلاحيات المالية أو مبالغ الصرفيات.">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="فواتير ضمن الفلتر" value={canFinanceAmounts ? String((invoiceAgg as any)?._count?._all ?? 0) : "—"} />
              <Metric label="المتبقي للتحصيل" value={canFinanceAmounts ? fmtMoney(invoiceOutstanding) : "مخفي"} tone={invoiceOutstanding > 0 ? "text-red-700" : "text-gray-900"} />
              <Metric label="تحصيل الشهر" value={canFinanceAmounts ? fmtMoney(monthPayments) : "مخفي"} tone="text-emerald-700" />
            </div>
            <div className="flex flex-wrap gap-2">
              {canFinance ? <Link href="/finance" className="btn-ghost btn-sm">الفواتير</Link> : null}
              {canFinanceReport ? <Link href="/finance/report" className="btn-ghost btn-sm">التقرير السنوي</Link> : null}
              {canFinance ? <Link href="/finance/payments" className="btn-ghost btn-sm">سجل المدفوعات</Link> : null}
            </div>
          </AdminSection>

          <AdminSection id="overview-alerts" title="أولويات المتابعة" description="أبرز السجلات التي تحتاج إجراء أو مراجعة.">
            <AlertList rows={alertRows} />
          </AdminSection>
        </div>
      ) : null}

      {activeTab === "official" ? (
        <div className="space-y-5">
          <AdminSection id="official-reports" title="حالة تقارير الشهر" description="حالة التقرير الرسمي الشهري والتقرير الإحصائي الرسمي للفترة الحالية.">
            <div className="grid gap-3 md:grid-cols-2">
              {canOfficialReports ? <ReportStatusCard title="التقرير الرسمي الشهري" approved={monthlyOfficialApproved} href={`/reports/official?year=${currentYear}&month=${currentMonth}`} /> : null}
              {canReports ? <ReportStatusCard title="التقرير الإحصائي الرسمي" approved={monthlyStatApproved} href={`/reports/statistical?ptype=month&year=${currentYear}&month=${currentMonth}`} /> : null}
            </div>
          </AdminSection>

          <AdminSection id="official-links" title="التقارير" description="فتح التقارير لإعدادها أو طباعتها.">
            <div className="flex flex-wrap gap-2">
              {canOfficialReports ? <Link href="/reports/official" className="btn-ghost btn-sm">التقرير الرسمي الشهري</Link> : null}
              {canReports ? <Link href="/reports/statistical" className="btn-ghost btn-sm">التقرير الإحصائي</Link> : null}
              {canReports ? <Link href="/reports" className="btn-ghost btn-sm">إحصاءات المراجعين</Link> : null}
              {canReports ? <Link href="/reports/daily" className="btn-ghost btn-sm">تقرير العمليات اليومي</Link> : null}
            </div>
          </AdminSection>
        </div>
      ) : null}

      {activeTab === "patients" ? (
        <AdminSection id="patient-reports" title="تقارير المراجعين الطبية" description="تظهر القائمة التفصيلية فقط لمن يملك صلاحية عرض المراجعين إضافة إلى التقارير." className="overflow-hidden">
          {canPatientReportRows ? (
            <>
              <FilterBar action="/reports-finance" queryName="reportPatient" query={sp.reportPatient} placeholder="اسم المراجع…" activeCount={[sp.reportStatus && sp.reportStatus !== "all" ? 1 : null, sp.reportType && sp.reportType !== "all" ? 1 : null, sp.from, sp.to].filter(Boolean).length} clearHref="/reports-finance?tab=patients" hidden={<input type="hidden" name="tab" value="patients" />}>
                <Combobox name="reportStatus" label="الحالة" allowFree={false} defaultValue={sp.reportStatus ?? "all"} options={[{ value: "all", label: "كل الحالات" }, ...Object.entries(MEDICAL_REPORT_STATUS).map(([value, item]) => ({ value, label: item.label }))]} />
                <Combobox name="reportType" label="النوع" allowFree={false} defaultValue={sp.reportType ?? "all"} options={[{ value: "all", label: "كل الأنواع" }, ...optionEntries(MEDICAL_REPORT_TYPE)]} />
                <div><label className="label">من</label><input name="from" type="date" className="input" defaultValue={sp.from ?? ""} /></div>
                <div><label className="label">إلى</label><input name="to" type="date" className="input" defaultValue={sp.to ?? ""} /></div>
              </FilterBar>
              <div className="-mx-5 -mb-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">المراجع</th><th className="th">النوع</th><th className="th">الحالة</th><th className="th">الطبيب</th><th className="th">التاريخ</th><th className="th">إجراءات</th></tr></thead>
                  <tbody>
                    {medicalReports.map((report: any) => (
                      <tr key={report.id} className={report.status === "READY_TO_PRINT" ? "bg-amber-50/40 hover:bg-amber-50" : "hover:bg-gray-50"}>
                        <td className="td"><Link href={`/patients/${report.patientId}`} className="font-medium text-brand-700 hover:underline">{report.patient.fullName} #{report.patient.fileNumber}</Link><div className="text-xs text-gray-400">{report.patient.branch?.name || "بدون فرع"}</div></td>
                        <td className="td">{MEDICAL_REPORT_TYPE[report.reportType] || "قديم"}</td>
                        <td className="td">{badge(MEDICAL_REPORT_STATUS[report.status]?.label || "قديم", MEDICAL_REPORT_STATUS[report.status]?.cls || "bg-gray-100 text-gray-600")}</td>
                        <td className="td">{report.doctor || "—"}</td>
                        <td className="td">{fmtDate(report.date)}</td>
                        <td className="td"><div className="flex flex-wrap gap-2"><Link href={`/patients/${report.patientId}`} className="text-xs text-brand-700 hover:underline">ملف المراجع</Link>{report.status === "READY_TO_PRINT" && canReportPrint ? <Link href={`/patients/${report.patientId}/medical-report/${report.id}`} className="text-xs text-emerald-700 hover:underline">طباعة رسمية</Link> : null}</div></td>
                      </tr>
                    ))}
                    {medicalReports.length === 0 ? emptyRow(6) : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">يعرض هذا التبويب الإحصاءات والروابط فقط لحسابك الحالي. القائمة التفصيلية لتقارير المراجعين تتطلب صلاحية عرض المراجعين.</div>
          )}
        </AdminSection>
      ) : null}

      {activeTab === "exports" ? (
        <div className="space-y-5">
          <AdminSection id="exports" title="الصادرات المتاحة" description="كل رابط يبقى محمياً من route التصدير نفسه، ولا تظهر روابط لا تملك صلاحيتها.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {canPatientsExport ? <ExportCard title="تصدير شامل Excel" description="ملف متعدد الأوراق حسب صلاحياتك الحالية." href="/api/export/full" /> : null}
              {canPatientsExport ? <ExportCard title="تصدير المراجعين CSV" description="قائمة المراجعين حسب صلاحية تصدير المراجعين." href="/api/export/patients" /> : null}
              {perms.has("patients.view") ? <ExportCard title="جودة بيانات المراجعين CSV" description="سجلات ناقصة أو تحتاج مراجعة." href="/api/export/data-quality" /> : null}
              {canExpenseReports && canExpenseAmounts ? <ExportCard title="صرفيات الجرحى CSV" description="كل الصرفيات؛ للتصدير حسب فلتر استخدم صفحة الصرفيات." href={`/api/export/wounded-expenses${expenseExportQs ? `?${expenseExportQs}` : ""}`} /> : null}
              {canOfficialDocs ? <ExportCard title="أرشيف الوثائق الرسمية" description="فتح الأرشيف للبحث والطباعة والمرفقات." href="/official-docs" /> : null}
              {canReports ? <ExportCard title="تقرير العمليات اليومي" description="تقرير قابل للطباعة ليوم محدد." href="/reports/daily" /> : null}
            </div>
          </AdminSection>

          {canAudit ? (
            <AdminSection id="export-log" title="صادرات حديثة" description="يعرض ما يسجله النظام حالياً من عمليات تصدير.">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">النوع</th><th className="th">الوقت</th><th className="th">المستخدم</th></tr></thead>
                  <tbody>
                    {exportLogs.map((log: any) => <tr key={log.id}><td className="td">تقرير صرفيات الجرحى</td><td className="td">{fmtDateTime(log.createdAt)}</td><td className="td">{log.actorName || log.actorUsername || log.userId || "—"}</td></tr>)}
                    {exportLogs.length === 0 ? emptyRow(3, "لا توجد صادرات مسجلة في سجل التدقيق الحالي.") : null}
                  </tbody>
                </table>
              </div>
            </AdminSection>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}

function Metric({ label, value, tone = "text-gray-900" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className={`text-xl font-bold ${tone}`}>{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}

function ReportStatusCard({ title, approved, href }: { title: string; approved: boolean; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-gray-200 bg-white p-4 transition hover:border-brand-200 hover:bg-brand-50/40">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-gray-800">{title}</div>
        {approved ? badge("معتمد", "bg-emerald-50 text-emerald-700") : badge("بانتظار اعتماد", "bg-amber-50 text-amber-700")}
      </div>
      <div className="mt-2 text-sm text-gray-500">فتح التقرير</div>
    </Link>
  );
}

function ActionCard({ title, value, href }: { title: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-gray-200 bg-white p-4 transition hover:border-brand-200 hover:bg-brand-50/40">
      <div className={`text-2xl font-bold ${value > 0 ? "text-amber-700" : "text-gray-800"}`}>{value}</div>
      <div className="text-sm text-gray-500">{title}</div>
    </Link>
  );
}

function ExportCard({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <a href={href} className="rounded-lg border border-gray-200 bg-white p-4 transition hover:border-brand-200 hover:bg-brand-50/40">
      <div className="font-medium text-gray-800">{title}</div>
      <div className="mt-1 text-sm text-gray-500">{description}</div>
      <div className="mt-3 text-xs font-medium text-brand-700">فتح/تصدير</div>
    </a>
  );
}

function AlertList({ rows }: { rows: { label: string; detail: string; href: string; tone: string }[] }) {
  if (!rows.length) return <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">لا توجد تنبيهات ضمن صلاحياتك الحالية.</div>;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <Link key={`${row.label}-${row.href}`} href={row.href} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
          <span className={`font-medium ${row.tone === "danger" ? "text-red-700" : row.tone === "warning" ? "text-amber-700" : "text-gray-800"}`}>{row.label}</span>
          <span className="text-gray-500">{row.detail}</span>
        </Link>
      ))}
    </div>
  );
}
