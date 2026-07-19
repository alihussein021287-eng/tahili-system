import Link from "next/link";
import { redirect } from "next/navigation";
import { Combobox } from "@/components/Combobox";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, AdminSectionTabs, StatCard } from "@/components/AdminPageSections";
import { currentPerms, requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { APPROVAL_STATUS, APPROVAL_TYPE, DOC_DIRECTION, DOC_TYPE, INVOICE_STATUS, fmtDate, fmtDateTime, fmtMoney } from "@/lib/labels";

export const dynamic = "force-dynamic";

type ReportsFinanceTab = "overview" | "official" | "patients" | "finance" | "wounded" | "approvals" | "exports" | "alerts";

const TABS: { key: ReportsFinanceTab; label: string; title: string; description: string; perms: string[] }[] = [
  { key: "overview", label: "نظرة عامة", title: "لوحة التقارير والمالية", description: "ملخص موحد للتقارير الرسمية، تقارير المراجعين، الفواتير، صرفيات الجرحى، والاعتمادات.", perms: ["reports.view", "reports.official", "finance.view", "finance.report", "expenses.view", "expenses.reports", "approvals.view", "officialdocs.view", "analytics.view", "patients.export"] },
  { key: "official", label: "التقارير الرسمية", title: "التقارير الرسمية والوثائق", description: "متابعة التقارير الرسمية الشهرية والإحصائية وأرشيف الوثائق الرسمية عند توفر الصلاحية.", perms: ["reports.view", "reports.official", "officialdocs.view"] },
  { key: "patients", label: "تقارير المراجعين", title: "تقارير المراجعين", description: "فلترة التقارير الطبية المسجلة للمراجعين حسب التاريخ، النوع، الحالة، والمراجع.", perms: ["reports.view", "patients.print", "clinical.report"] },
  { key: "finance", label: "المالية", title: "الفواتير والمدفوعات", description: "ملخص الفواتير والتحصيل مع فلترة واضحة وروابط للتقرير السنوي وسجل المدفوعات.", perms: ["finance.view", "finance.report"] },
  { key: "wounded", label: "صرفيات الجرحى", title: "صرفيات الجرحى", description: "متابعة مسودات وطلبات الصرف والاعتماد والتنفيذ دون إظهار مبالغ إلا لصلاحية المبالغ.", perms: ["expenses.view", "expenses.reports", "expenses.approve", "expenses.pay"] },
  { key: "approvals", label: "الموافقات والاعتمادات", title: "الموافقات والاعتمادات", description: "طلبات الموافقة العامة وصرفيات الجرحى التي تحتاج قراراً أو تنفيذ صرف.", perms: ["approvals.view", "expenses.approve", "expenses.pay", "reports.approve"] },
  { key: "exports", label: "الصادرات والملفات", title: "الصادرات والملفات", description: "روابط التصدير المتاحة حسب الصلاحيات، مع سجل الصادرات إذا كان التدقيق متاحاً.", perms: ["patients.export", "patients.view", "expenses.reports", "officialdocs.view", "audit.view"] },
  { key: "alerts", label: "تنبيهات ومتابعة", title: "تنبيهات ومتابعة", description: "سجلات تحتاج متابعة: تقارير غير معتمدة، صرفيات متأخرة، فواتير معلقة، وطلبات موافقة.", perms: ["reports.view", "reports.official", "finance.view", "expenses.view", "expenses.approve", "expenses.pay", "approvals.view"] },
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
  return <tr><td className="td text-center text-gray-400" colSpan={colSpan}>{text}</td></tr>;
}

export default async function ReportsFinancePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireSession();
  const sp = await searchParams;
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
  const navTabs = visibleTabs.map((tab) => ({ key: tab.key, label: tab.label, href: tabHref(tab.key) }));

  const reportWhere: any = {};
  if (range) reportWhere.date = range;
  if (sp.reportStatus && sp.reportStatus !== "all") reportWhere.status = sp.reportStatus;
  if (sp.reportType && sp.reportType !== "all") reportWhere.reportType = sp.reportType;
  if (sp.reportPatient) {
    reportWhere.patient = { fullName: { contains: sp.reportPatient.trim(), mode: "insensitive" } };
  }

  const invoiceWhere: any = {};
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
    canPatientReportRows || canFinance || canExpenses || canExpenseReports
      ? prisma.patient.findMany({ where: { archivedAt: null }, select: { id: true, fullName: true, fileNumber: true }, orderBy: { fullName: "asc" }, take: 400 })
      : Promise.resolve([]),
    canReports ? prisma.medicalReport.count({ where: { date: { gte: monthStart, lt: nextMonth } } }) : Promise.resolve(0),
    canOfficialDocs ? prisma.officialDocument.count({ where: { docDate: { gte: monthStart, lt: nextMonth } } }) : Promise.resolve(0),
    canReports ? prisma.medicalReport.count({ where: { status: "READY_TO_PRINT" } }) : Promise.resolve(0),
    canOfficialReports || canReports
      ? prisma.reportApproval.findMany({ where: { OR: [{ kind: "official-monthly", refKey: `${currentYear}-${currentMonth}` }, { kind: "official-stat", refKey: `m-${currentYear}-${currentMonth}` }] } })
      : Promise.resolve([]),
    canPatientReportRows
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
    canFinance
      ? prisma.invoice.findMany({ where: invoiceWhere, include: { patient: { select: { id: true, fullName: true, fileNumber: true } } }, orderBy: { issuedAt: "desc" }, take: 200 })
      : Promise.resolve([]),
    canFinanceAmounts ? prisma.invoice.aggregate({ where: invoiceWhere, _sum: { amount: true, paidAmount: true }, _count: { _all: true } }) : Promise.resolve(null),
    canFinance ? prisma.invoice.count({ where: { status: { in: ["UNPAID", "PARTIAL"] } } }) : Promise.resolve(0),
    canFinanceAmounts ? prisma.payment.aggregate({ where: { paidAt: { gte: monthStart, lt: nextMonth } }, _sum: { amount: true }, _count: { _all: true } }) : Promise.resolve(null),
    canExpenses || canExpenseReports
      ? prisma.woundedExpense.findMany({
          where: expenseWhere,
          include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, createdBy: { select: { fullName: true } } },
          orderBy: [{ status: "asc" }, { dueDate: "asc" }, { requestDate: "desc" }],
          take: 200,
        })
      : Promise.resolve([]),
    canExpenseAmounts && (canExpenses || canExpenseReports)
      ? prisma.woundedExpense.aggregate({ where: expenseWhere, _sum: { amount: true }, _count: { _all: true } })
      : Promise.resolve(null),
    canExpenses || canExpenseApprove ? prisma.woundedExpense.count({ where: { status: "SUBMITTED" } }) : Promise.resolve(0),
    canExpenses || canExpensePay ? prisma.woundedExpense.count({ where: { status: "READY_FOR_PAYMENT" } }) : Promise.resolve(0),
    canExpenses || canExpenseApprove || canExpensePay
      ? prisma.woundedExpense.count({ where: { dueDate: { lt: now }, status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "READY_FOR_PAYMENT"] } } })
      : Promise.resolve(0),
    canApprovals
      ? prisma.approvalRequest.findMany({ where: approvalWhere, include: { patient: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "desc" }, take: 100 })
      : Promise.resolve([]),
    canApprovals ? prisma.approvalRequest.count({ where: { status: { in: ["PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED"] } } }) : Promise.resolve(0),
    canOfficialDocs
      ? prisma.officialDocument.findMany({ where: docWhere, include: { patient: { select: { id: true, fullName: true, fileNumber: true } } }, orderBy: [{ docDate: "desc" }, { createdAt: "desc" }], take: 120 })
      : Promise.resolve([]),
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
    (canExpenses || canExpenseApprove) && submittedExpenses > 0 ? { label: "صرفيات بانتظار الاعتماد", detail: `${submittedExpenses} صرفية`, href: "/reports-finance?tab=wounded&expenseStatus=SUBMITTED", tone: "danger" } : null,
    (canExpenses || canExpensePay) && readyExpenses > 0 ? { label: "صرفيات جاهزة للصرف", detail: `${readyExpenses} صرفية`, href: "/reports-finance?tab=wounded&expenseStatus=READY_FOR_PAYMENT", tone: "warning" } : null,
    (canExpenses || canExpenseApprove || canExpensePay) && overdueExpenses > 0 ? { label: "صرفيات متأخرة", detail: `${overdueExpenses} صرفية بتاريخ استحقاق سابق`, href: "/reports-finance?tab=alerts", tone: "danger" } : null,
    canFinance && unpaidInvoices > 0 ? { label: "فواتير غير مكتملة التحصيل", detail: `${unpaidInvoices} فاتورة`, href: "/reports-finance?tab=finance&invoiceStatus=UNPAID", tone: "warning" } : null,
    canApprovals && pendingApprovals > 0 ? { label: "طلبات موافقة تحتاج متابعة", detail: `${pendingApprovals} طلب`, href: "/reports-finance?tab=approvals", tone: "warning" } : null,
  ].filter(Boolean) as { label: string; detail: string; href: string; tone: string }[];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="التقارير والمالية" subtitle="صفحة جامعة للتقارير، الفواتير، الصرفيات، الاعتمادات، والتصدير" icon="📊" />
      <AdminSectionTabs tabs={navTabs} active={activeTab} label="تبويبات التقارير والمالية" />
      <AdminIntro title={activeInfo.title} description={activeInfo.description}>
        <div className="flex flex-wrap gap-2">
          {canOfficialReports ? <Link href="/reports/official" className="btn-ghost btn-sm">إنشاء/فتح تقرير رسمي</Link> : null}
          {canReports ? <Link href="/reports" className="btn-ghost btn-sm">فتح تقارير المراجعين</Link> : null}
          {canExpenseCreate ? <Link href="/finance/expenses" className="btn-ghost btn-sm">صرفية جديدة</Link> : null}
          {canFinance ? <Link href="/finance" className="btn-ghost btn-sm">فتح المالية</Link> : null}
          {canPatientsExport ? <a href="/api/export/full" className="btn-ghost btn-sm">تصدير شامل</a> : null}
        </div>
      </AdminIntro>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="تقارير ووثائق هذا الشهر" value={canReports || canOfficialDocs ? reportsCount : "—"} />
        <StatCard label="تقارير تحتاج اعتماد" value={canReports || canOfficialReports ? reportsPendingApproval : "—"} tone="text-amber-700" />
        <StatCard label="صرفيات قيد الاعتماد" value={canExpenses || canExpenseApprove ? submittedExpenses : "—"} tone="text-amber-700" />
        <StatCard label="جاهزة للصرف" value={canExpenses || canExpensePay ? readyExpenses : "—"} tone="text-brand-700" />
        <StatCard label="المصروف/المعلق" value={canExpenseAmounts && (canExpenses || canExpenseReports) ? moneyFromDecimal(expenseTotal) : "مخفي"} description={!canExpenseAmounts && (canExpenses || canExpenseReports) ? "يتطلب صلاحية عرض المبالغ" : `${expenseCount} سجل ضمن الفلتر`} />
        <StatCard label="صادرات حديثة" value={canAudit ? exportLogs.length : "—"} description={canAudit ? "من سجل التدقيق المتاح" : undefined} />
      </section>

      {activeTab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <AdminSection id="overview-finance" title="ملخص مالي وتشغيلي" description="المبالغ تظهر فقط لمن يملك صلاحيات المالية أو مبالغ الصرفيات.">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="فواتير ضمن الفلتر" value={canFinanceAmounts ? String((invoiceAgg as any)?._count?._all ?? 0) : "—"} />
              <Metric label="المتبقي للتحصيل" value={canFinanceAmounts ? fmtMoney(invoiceOutstanding) : "مخفي"} tone={invoiceOutstanding > 0 ? "text-red-700" : "text-gray-900"} />
              <Metric label="تحصيل الشهر" value={canFinanceAmounts ? fmtMoney(monthPayments) : "مخفي"} tone="text-emerald-700" />
            </div>
            <div className="flex flex-wrap gap-2">
              {canFinance ? <Link href="/reports-finance?tab=finance" className="btn-ghost btn-sm">لوحة المالية</Link> : null}
              {canFinanceReport ? <Link href="/finance/report" className="btn-ghost btn-sm">التقرير السنوي</Link> : null}
              {canFinance ? <Link href="/finance/payments" className="btn-ghost btn-sm">سجل المدفوعات</Link> : null}
            </div>
          </AdminSection>

          <AdminSection id="overview-alerts" title="أولويات المتابعة" description="أبرز السجلات التي تحتاج إجراء أو مراجعة.">
            <AlertList rows={alertRows.slice(0, 6)} />
            {alertRows.length > 6 ? <Link href="/reports-finance?tab=alerts" className="btn-ghost btn-sm">عرض كل التنبيهات</Link> : null}
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

          {canOfficialDocs ? (
            <AdminSection id="official-docs" title="أرشيف الوثائق الرسمية" description="فلترة الوثائق الرسمية المسجلة في الأرشيف." className="overflow-hidden">
              <form action="/reports-finance" className="grid gap-3 md:grid-cols-5">
                <input type="hidden" name="tab" value="official" />
                <div className="md:col-span-2"><label className="label">بحث</label><input name="docQ" className="input" defaultValue={sp.docQ ?? ""} placeholder="رقم، موضوع، جهة، مراجع" /></div>
                <Combobox name="docType" label="النوع" allowFree={false} defaultValue={sp.docType ?? "all"} options={[{ value: "all", label: "كل الأنواع" }, ...optionEntries(DOC_TYPE as any)]} />
                <Combobox name="docDirection" label="الاتجاه" allowFree={false} defaultValue={sp.docDirection ?? "all"} options={[{ value: "all", label: "كل الاتجاهات" }, ...optionEntries(DOC_DIRECTION as any)]} />
                <div><label className="label">من</label><input name="from" type="date" className="input" defaultValue={sp.from ?? ""} /></div>
                <div><label className="label">إلى</label><input name="to" type="date" className="input" defaultValue={sp.to ?? ""} /></div>
                <div className="flex flex-wrap items-end gap-2 md:col-span-4"><button className="btn-primary" type="submit">تصفية</button><Link href="/reports-finance?tab=official" className="btn-ghost">مسح</Link><Link href="/official-docs" className="btn-ghost">فتح الأرشيف</Link></div>
              </form>
              <div className="-mx-5 -mb-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">الوثيقة</th><th className="th">العدد</th><th className="th">التاريخ</th><th className="th">الجهة</th><th className="th">المراجع</th><th className="th">إجراءات</th></tr></thead>
                  <tbody>
                    {officialDocs.map((doc: any) => (
                      <tr key={doc.id} className={!doc.attachmentUrl ? "bg-amber-50/40 hover:bg-amber-50" : "hover:bg-gray-50"}>
                        <td className="td"><div className="font-medium text-gray-800">{doc.subject}</div><div className="mt-1 flex flex-wrap gap-1">{badge(DOC_TYPE[doc.docType as keyof typeof DOC_TYPE], "bg-gray-100 text-gray-600")}{badge(DOC_DIRECTION[doc.direction as keyof typeof DOC_DIRECTION], doc.direction === "OUTGOING" ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700")}{!doc.attachmentUrl ? badge("بلا مرفق", "bg-amber-50 text-amber-700") : null}</div></td>
                        <td className="td">{doc.number}</td>
                        <td className="td">{fmtDate(doc.docDate)}</td>
                        <td className="td">{doc.entity || "—"}</td>
                        <td className="td">{doc.patient ? <Link href={`/patients/${doc.patient.id}`} className="text-brand-700 hover:underline">{doc.patient.fullName} #{doc.patient.fileNumber}</Link> : "وثيقة عامة"}</td>
                        <td className="td"><Link href={`/official-docs/${doc.id}`} className="text-xs text-brand-700 hover:underline">عرض/طباعة</Link></td>
                      </tr>
                    ))}
                    {officialDocs.length === 0 ? emptyRow(6) : null}
                  </tbody>
                </table>
              </div>
            </AdminSection>
          ) : null}
        </div>
      ) : null}

      {activeTab === "patients" ? (
        <AdminSection id="patient-reports" title="تقارير المراجعين الطبية" description="تظهر القائمة التفصيلية فقط لمن يملك صلاحية عرض المراجعين إضافة إلى التقارير." className="overflow-hidden">
          {canPatientReportRows ? (
            <>
              <form action="/reports-finance" className="grid gap-3 md:grid-cols-6">
                <input type="hidden" name="tab" value="patients" />
                <div className="md:col-span-2"><label className="label">المراجع</label><input name="reportPatient" className="input" defaultValue={sp.reportPatient ?? ""} placeholder="اسم المراجع" /></div>
                <Combobox name="reportStatus" label="الحالة" allowFree={false} defaultValue={sp.reportStatus ?? "all"} options={[{ value: "all", label: "كل الحالات" }, ...Object.entries(MEDICAL_REPORT_STATUS).map(([value, item]) => ({ value, label: item.label }))]} />
                <Combobox name="reportType" label="النوع" allowFree={false} defaultValue={sp.reportType ?? "all"} options={[{ value: "all", label: "كل الأنواع" }, ...optionEntries(MEDICAL_REPORT_TYPE)]} />
                <div><label className="label">من</label><input name="from" type="date" className="input" defaultValue={sp.from ?? ""} /></div>
                <div><label className="label">إلى</label><input name="to" type="date" className="input" defaultValue={sp.to ?? ""} /></div>
                <div className="flex flex-wrap items-end gap-2 md:col-span-6"><button className="btn-primary" type="submit">تصفية</button><Link href="/reports-finance?tab=patients" className="btn-ghost">مسح</Link><Link href="/reports" className="btn-ghost">التقرير الإحصائي</Link></div>
              </form>
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

      {activeTab === "finance" ? (
        <AdminSection id="finance" title="الفواتير والمدفوعات" description="المبالغ هنا هي نفس نطاق صفحة المالية والتقرير السنوي." className="overflow-hidden">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="إجمالي الفواتير" value={canFinanceAmounts ? fmtMoney(invoiceTotal) : "مخفي"} />
            <Metric label="المحصّل" value={canFinanceAmounts ? fmtMoney(invoiceCollected) : "مخفي"} tone="text-emerald-700" />
            <Metric label="المتبقّي" value={canFinanceAmounts ? fmtMoney(invoiceOutstanding) : "مخفي"} tone={invoiceOutstanding > 0 ? "text-red-700" : "text-gray-900"} />
          </div>
          {canFinance ? (
            <>
              <form action="/reports-finance" className="grid gap-3 md:grid-cols-6">
                <input type="hidden" name="tab" value="finance" />
                <Combobox name="invoiceStatus" label="الحالة" allowFree={false} defaultValue={sp.invoiceStatus ?? "all"} options={[{ value: "all", label: "كل الحالات" }, ...optionEntries(INVOICE_STATUS as any)]} />
                <Combobox name="financePatient" label="المراجع" allowFree={false} defaultValue={sp.financePatient ?? ""} placeholder="كل المراجعين" options={[{ value: "", label: "كل المراجعين" }, ...patients.map((patient: any) => ({ value: patient.id, label: `${patient.fullName} (#${patient.fileNumber})` }))]} />
                <div className="md:col-span-2"><label className="label">بحث</label><input name="financeQ" className="input" defaultValue={sp.financeQ ?? ""} placeholder="اسم أو بيان" /></div>
                <div><label className="label">من</label><input name="from" type="date" className="input" defaultValue={sp.from ?? ""} /></div>
                <div><label className="label">إلى</label><input name="to" type="date" className="input" defaultValue={sp.to ?? ""} /></div>
                <div className="flex flex-wrap items-end gap-2 md:col-span-6"><button className="btn-primary" type="submit">تصفية</button><Link href="/reports-finance?tab=finance" className="btn-ghost">مسح</Link><Link href="/finance" className="btn-ghost">إدارة الفواتير</Link><Link href="/finance/payments" className="btn-ghost">سجل المدفوعات</Link>{canFinanceReport ? <Link href="/finance/report" className="btn-ghost">التقرير السنوي</Link> : null}</div>
              </form>
              <div className="-mx-5 -mb-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">المراجع</th><th className="th">البيان</th><th className="th">المبلغ</th><th className="th">المدفوع</th><th className="th">المتبقي</th><th className="th">الحالة</th><th className="th">التاريخ</th><th className="th">إجراءات</th></tr></thead>
                  <tbody>
                    {invoices.map((invoice: any) => {
                      const outstanding = invoice.amount - invoice.paidAmount;
                      return (
                        <tr key={invoice.id} className={outstanding > 0 ? "bg-amber-50/30 hover:bg-amber-50" : "hover:bg-gray-50"}>
                          <td className="td"><Link href={`/patients/${invoice.patientId}`} className="font-medium text-brand-700 hover:underline">{invoice.patient.fullName} #{invoice.patient.fileNumber}</Link></td>
                          <td className="td">{invoice.description || "—"}</td>
                          <td className="td">{fmtMoney(invoice.amount)}</td>
                          <td className="td text-emerald-700">{fmtMoney(invoice.paidAmount)}</td>
                          <td className={`td ${outstanding > 0 ? "font-semibold text-red-700" : ""}`}>{fmtMoney(outstanding)}</td>
                          <td className="td">{badge(INVOICE_STATUS[invoice.status as keyof typeof INVOICE_STATUS], INVOICE_STATUS_STYLE[invoice.status])}</td>
                          <td className="td">{fmtDate(invoice.issuedAt)}</td>
                          <td className="td"><Link href="/finance" className="text-xs text-brand-700 hover:underline">فتح المالية</Link></td>
                        </tr>
                      );
                    })}
                    {invoices.length === 0 ? emptyRow(8) : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">لديك صلاحية التقرير المالي السنوي فقط؛ استخدم الرابط لفتح التقرير دون عرض جدول الفواتير التشغيلي هنا.</div>
          )}
        </AdminSection>
      ) : null}

      {activeTab === "wounded" ? (
        <AdminSection id="wounded-expenses" title="صرفيات الجرحى" description="فلترة حسب الحالة، النوع، المراجع، والجهة. المبالغ محمية بصلاحية منفصلة." className="overflow-hidden">
          <form action="/reports-finance" className="grid gap-3 md:grid-cols-6">
            <input type="hidden" name="tab" value="wounded" />
            <Combobox name="expenseStatus" label="الحالة" allowFree={false} defaultValue={sp.expenseStatus ?? "all"} options={[{ value: "all", label: "كل الحالات" }, ...Object.entries(EXPENSE_STATUS).map(([value, item]) => ({ value, label: item.label }))]} />
            <Combobox name="expensePatient" label="المراجع" allowFree={false} defaultValue={sp.expensePatient ?? ""} placeholder="كل المراجعين" options={[{ value: "", label: "كل المراجعين" }, ...patients.map((patient: any) => ({ value: patient.id, label: `${patient.fullName} (#${patient.fileNumber})` }))]} />
            <div><label className="label">النوع</label><input name="expenseType" className="input" defaultValue={sp.expenseType ?? ""} /></div>
            <div><label className="label">الجهة</label><input name="expenseEntity" className="input" defaultValue={sp.expenseEntity ?? ""} /></div>
            <div><label className="label">من</label><input name="from" type="date" className="input" defaultValue={sp.from ?? ""} /></div>
            <div><label className="label">إلى</label><input name="to" type="date" className="input" defaultValue={sp.to ?? ""} /></div>
            <div className="flex flex-wrap items-end gap-2 md:col-span-6"><button className="btn-primary" type="submit">تصفية</button><Link href="/reports-finance?tab=wounded" className="btn-ghost">مسح</Link>{canExpenses ? <Link href="/finance/expenses" className="btn-ghost">فتح الصرفيات</Link> : null}{canExpenseReports ? <Link href="/finance/expenses/reports" className="btn-ghost">تقرير الصرفيات</Link> : null}{canExpenseReports && canExpenseAmounts ? <a href={`/api/export/wounded-expenses${expenseExportQs ? `?${expenseExportQs}` : ""}`} className="btn-ghost">تصدير CSV</a> : null}</div>
          </form>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="عدد الصرفيات" value={String(expenses.length)} />
            <Metric label="إجمالي ضمن الفلتر" value={canExpenseAmounts ? moneyFromDecimal(expenseTotal) : "مخفي"} />
            <Metric label="متأخرة" value={String(overdueExpenses)} tone={overdueExpenses > 0 ? "text-red-700" : "text-gray-900"} />
          </div>
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">السند</th><th className="th">المراجع</th><th className="th">المستفيد</th><th className="th">النوع/الجهة</th>{canExpenseAmounts ? <th className="th">المبلغ</th> : null}<th className="th">الحالة</th><th className="th">الاستحقاق</th><th className="th">إجراءات</th></tr></thead>
              <tbody>
                {expenses.map((expense: any) => {
                  const isOverdue = expense.dueDate && new Date(expense.dueDate) < now && !["PAID", "CANCELLED", "REJECTED"].includes(expense.status);
                  return (
                    <tr key={expense.id} className={isOverdue ? "bg-red-50/40 hover:bg-red-50" : "hover:bg-gray-50"}>
                      <td className="td font-medium">{canExpenses ? <Link href={`/finance/expenses/${expense.id}`} className="text-brand-700 hover:underline">{expense.voucherNo}</Link> : expense.voucherNo}</td>
                      <td className="td">{expense.patient.fullName} #{expense.patient.fileNumber}</td>
                      <td className="td">{expense.beneficiary}<div className="text-xs text-gray-400">أنشأها: {expense.createdBy?.fullName || "—"}</div></td>
                      <td className="td"><div>{expense.expenseType}</div><div className="text-xs text-gray-400">{expense.beneficiaryEntity || "—"}</div></td>
                      {canExpenseAmounts ? <td className="td">{moneyFromDecimal(expense.amount, expense.currency)}</td> : null}
                      <td className="td">{badge(EXPENSE_STATUS[expense.status]?.label || expense.status, EXPENSE_STATUS[expense.status]?.cls || "bg-gray-100 text-gray-600")}</td>
                      <td className={`td ${isOverdue ? "font-semibold text-red-700" : ""}`}>{fmtDate(expense.dueDate)}{isOverdue ? <div className="text-xs">متأخرة</div> : null}</td>
                      <td className="td">{canExpenses ? <Link href={`/finance/expenses/${expense.id}`} className="text-xs text-brand-700 hover:underline">تفاصيل</Link> : "—"}</td>
                    </tr>
                  );
                })}
                {expenses.length === 0 ? emptyRow(canExpenseAmounts ? 8 : 7) : null}
              </tbody>
            </table>
          </div>
        </AdminSection>
      ) : null}

      {activeTab === "approvals" ? (
        <div className="space-y-5">
          {canApprovals ? (
            <AdminSection id="approval-requests" title="سير الموافقات العام" description="طلبات الموافقة العامة حسب الحالة والنوع." className="overflow-hidden">
              <form action="/reports-finance" className="grid gap-3 md:grid-cols-4">
                <input type="hidden" name="tab" value="approvals" />
                <Combobox name="approvalStatus" label="الحالة" allowFree={false} defaultValue={sp.approvalStatus ?? "all"} options={[{ value: "all", label: "كل الحالات" }, ...optionEntries(APPROVAL_STATUS as any)]} />
                <Combobox name="approvalType" label="النوع" allowFree={false} defaultValue={sp.approvalType ?? "all"} options={[{ value: "all", label: "كل الأنواع" }, ...optionEntries(APPROVAL_TYPE as any)]} />
                <div><label className="label">من</label><input name="from" type="date" className="input" defaultValue={sp.from ?? ""} /></div>
                <div><label className="label">إلى</label><input name="to" type="date" className="input" defaultValue={sp.to ?? ""} /></div>
                <div className="flex flex-wrap items-end gap-2 md:col-span-4"><button className="btn-primary" type="submit">تصفية</button><Link href="/reports-finance?tab=approvals" className="btn-ghost">مسح</Link><Link href="/approvals" className="btn-ghost">فتح سير الموافقات</Link></div>
              </form>
              <div className="-mx-5 -mb-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">الطلب</th><th className="th">النوع</th><th className="th">المراجع</th><th className="th">المبلغ</th><th className="th">الحالة</th><th className="th">آخر تحديث</th></tr></thead>
                  <tbody>
                    {approvalRequests.map((request: any) => (
                      <tr key={request.id} className={["PENDING_REVIEW", "PENDING_APPROVAL"].includes(request.status) ? "bg-amber-50/30 hover:bg-amber-50" : "hover:bg-gray-50"}>
                        <td className="td"><div className="font-medium text-gray-800">{request.title}</div><div className="text-xs text-gray-400">{request.requestedByName || "—"}</div></td>
                        <td className="td">{APPROVAL_TYPE[request.reqType as keyof typeof APPROVAL_TYPE]}</td>
                        <td className="td">{request.patient ? <Link href={`/patients/${request.patient.id}`} className="text-brand-700 hover:underline">{request.patient.fullName}</Link> : "—"}</td>
                        <td className="td">{request.amount != null && canFinanceAmounts ? fmtMoney(request.amount) : "—"}</td>
                        <td className="td">{badge(APPROVAL_STATUS[request.status as keyof typeof APPROVAL_STATUS], APPROVAL_STYLE[request.status])}</td>
                        <td className="td">{fmtDateTime(request.updatedAt)}</td>
                      </tr>
                    ))}
                    {approvalRequests.length === 0 ? emptyRow(6) : null}
                  </tbody>
                </table>
              </div>
            </AdminSection>
          ) : null}

          {(canExpenseApprove || canExpensePay || canReportApprove) ? (
            <AdminSection id="approval-shortcuts" title="اعتمادات مالية ورسمية" description="روابط مباشرة للطلبات التي تحتاج قراراً من صلاحياتك.">
              <div className="grid gap-3 sm:grid-cols-3">
                {canExpenseApprove ? <ActionCard title="صرفيات بانتظار الاعتماد" value={submittedExpenses} href="/reports-finance?tab=wounded&expenseStatus=SUBMITTED" /> : null}
                {canExpensePay ? <ActionCard title="صرفيات جاهزة للصرف" value={readyExpenses} href="/reports-finance?tab=wounded&expenseStatus=READY_FOR_PAYMENT" /> : null}
                {canReportApprove ? <ActionCard title="تقارير رسمية غير معتمدة" value={pendingOfficialReports} href="/reports-finance?tab=official" /> : null}
              </div>
            </AdminSection>
          ) : null}
        </div>
      ) : null}

      {activeTab === "exports" ? (
        <div className="space-y-5">
          <AdminSection id="exports" title="الصادرات المتاحة" description="كل رابط يبقى محمياً من route التصدير نفسه، ولا تظهر روابط لا تملك صلاحيتها.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {canPatientsExport ? <ExportCard title="تصدير شامل Excel" description="ملف متعدد الأوراق حسب صلاحياتك الحالية." href="/api/export/full" /> : null}
              {canPatientsExport ? <ExportCard title="تصدير المراجعين CSV" description="قائمة المراجعين حسب صلاحية تصدير المراجعين." href="/api/export/patients" /> : null}
              {perms.has("patients.view") ? <ExportCard title="جودة بيانات المراجعين CSV" description="سجلات ناقصة أو تحتاج مراجعة." href="/api/export/data-quality" /> : null}
              {canExpenseReports && canExpenseAmounts ? <ExportCard title="صرفيات الجرحى CSV" description="يحترم فلاتر التاريخ والحالة من الصفحة الجامعة." href={`/api/export/wounded-expenses${expenseExportQs ? `?${expenseExportQs}` : ""}`} /> : null}
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

      {activeTab === "alerts" ? (
        <AdminSection id="alerts" title="تنبيهات ومتابعة" description="قائمة عملية مختصرة مبنية من البيانات الحالية ولا تنشئ حالات جديدة.">
          <AlertList rows={alertRows} />
        </AdminSection>
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
