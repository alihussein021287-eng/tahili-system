import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/Ui";
import { currentPerms, requirePerm, requireSession } from "@/lib/access";
import { currentUserBranch } from "@/lib/branch-context";
import { accessibleCenterIds } from "@/lib/center-access";
import { prisma } from "@/lib/db";
import {
  dedupeWorkItems,
  derivePriority,
  filterWorkItems,
  normalizeWorkFilters,
  paginateWorkItems,
  sortWorkItems,
  waitLabel,
  type WorkItem,
  type WorkItemType,
} from "@/lib/my-work";

export const dynamic = "force-dynamic";

type SearchParams = {
  type?: string;
  status?: string;
  priority?: string;
  center?: string;
  date?: string;
  page?: string;
};

const TYPE_LABELS: Record<WorkItemType, string> = {
  task: "مهمة",
  appointment: "موعد",
  queue: "طابور",
  stage: "محطة رعاية",
  referral: "إحالة",
  plan: "خطة علاج",
  session: "جلسة",
  prescription: "وصفة",
  stock: "مخزون",
  purchase: "شراء واستلام",
  expense: "صرفية",
  approval: "موافقة",
};

const PRIORITY_LABELS = { urgent: "عاجل", high: "مرتفع", normal: "اعتيادي", low: "منخفض" } as const;
const PRIORITY_CLASS = {
  urgent: "bg-red-50 text-red-700",
  high: "bg-amber-50 text-amber-700",
  normal: "bg-sky-50 text-sky-700",
  low: "bg-gray-100 text-gray-600",
} as const;

function patientLabel(row: any) {
  return row.patient?.fullName ?? null;
}

function branchFields(row: any) {
  return {
    branchId: row.patient?.branch?.id ?? null,
    branchName: row.patient?.branch?.name ?? null,
  };
}

function nextAction(type: WorkItemType, status: string) {
  const actions: Partial<Record<WorkItemType, Record<string, string>>> = {
    task: { OPEN: "فتح المهمة", IN_PROGRESS: "متابعة المهمة" },
    appointment: { SCHEDULED: "فتح الموعد" },
    queue: { WAITING: "متابعة الطابور", CALLED: "متابعة الاستدعاء", IN_SESSION: "فتح الجلسة الحالية" },
    stage: { WAITING: "فتح محطة الرعاية", IN_PROGRESS: "متابعة المحطة" },
    referral: { DRAFT: "إكمال المسودة", PENDING_PRINT: "تجهيز الكتاب", READY: "متابعة الإرسال", SENT: "انتظار النتيجة", RESULT_RECEIVED: "مراجعة النتيجة", REVIEWED: "متابعة القرار", ACCEPTED: "فتح المسار المحال" },
    plan: { ACTIVE: "فتح الخطة العلاجية", PAUSED: "مراجعة توقف الخطة" },
    session: { SCHEDULED: "تسجيل نتيجة الجلسة", NO_SHOW: "فتح سجل الجلسة" },
    prescription: { PENDING: "تجهيز الوصفة", PARTIAL: "إكمال التجهيز" },
    purchase: { DRAFT: "إكمال أمر الشراء", PENDING_APPROVAL: "مراجعة الاعتماد", APPROVED: "تأكيد الطلب", ORDERED: "متابعة الاستلام", PARTIALLY_RECEIVED: "إكمال الاستلام" },
    expense: { SUBMITTED: "فتح قرار الاعتماد", APPROVED: "تجهيز للصرف", READY_FOR_PAYMENT: "تنفيذ الصرف", DRAFT: "فتح المسودة" },
    approval: { PENDING_REVIEW: "فتح المراجعة", PENDING_APPROVAL: "فتح الموافقة", APPROVED: "متابعة التنفيذ" },
  };
  return actions[type]?.[status] ?? "فتح التفاصيل";
}

export default async function MyWorkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePerm("dashboard.view");
  const [session, perms, userBranch, rawCenterIds, rawParams] = await Promise.all([
    requireSession(),
    currentPerms(),
    currentUserBranch(),
    accessibleCenterIds(),
    searchParams,
  ]);
  const filters = normalizeWorkFilters(rawParams);
  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  const userName = session.user?.name ?? "";
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrow = new Date(todayStart.getTime() + 86_400_000);
  const weekEnd = new Date(todayStart.getTime() + 7 * 86_400_000);
  const branchId = userBranch?.branchId ?? null;
  const centerIds = rawCenterIds;
  const centerScopedRole = role === "HEAD_THERAPIST" || role === "THERAPIST";
  const scopedCenterIds = centerScopedRole ? centerIds : null;
  const sourceLimit = 80;
  const canPatients = perms.has("patients.view");
  const patientSelect = canPatients
    ? { patient: { select: { fullName: true, branch: { select: { id: true, name: true } } } } }
    : {};
  const branchPatientWhere = branchId ? { patient: { branchId } } : {};
  const centerWhere = scopedCenterIds ? { centerId: { in: scopedCenterIds } } : {};
  const wants = (type: WorkItemType) => filters.type === "all" || filters.type === type;

  const queries: Promise<{ type: WorkItemType; rows: any[] }>[] = [];
  if (wants("task") && perms.has("tasks.view")) {
    queries.push(prisma.task.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, OR: [{ assignedToId: userId }, { assignedRole: role as any }] },
      select: { id: true, title: true, status: true, priority: true, dueDate: true, createdAt: true, assignedTo: { select: { fullName: true } }, assignedRole: true, patientId: true, ...patientSelect },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: sourceLimit,
    }).then((rows) => ({ type: "task" as const, rows })));
  }
  if (wants("appointment") && perms.has("appointments.view")) {
    queries.push(prisma.appointment.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lt: weekEnd }, ...branchPatientWhere, ...centerWhere },
      select: { id: true, patientId: true, type: true, status: true, scheduledAt: true, createdAt: true, assignedTo: true, centerId: true, center: { select: { name: true } }, ...patientSelect },
      orderBy: { scheduledAt: "asc" },
      take: sourceLimit,
    }).then((rows) => ({ type: "appointment" as const, rows })));
  }
  if (wants("queue") && perms.has("queue.view")) {
    queries.push(prisma.queueEntry.findMany({
      where: { status: { in: ["WAITING", "CALLED", "IN_SESSION"] }, createdAt: { gte: todayStart, lt: tomorrow }, ...branchPatientWhere, ...centerWhere },
      select: { id: true, patientId: true, status: true, createdAt: true, updatedAt: true, hall: true, centerId: true, center: { select: { name: true } }, ...patientSelect },
      orderBy: { createdAt: "asc" },
      take: sourceLimit,
    }).then((rows) => ({ type: "queue" as const, rows })));
  }
  if (wants("stage") && perms.has("journey.view")) {
    queries.push(prisma.careStage.findMany({
      where: { responsibleRole: role as any, status: { in: ["WAITING", "IN_PROGRESS"] }, patient: { archivedAt: null, ...(branchId ? { branchId } : {}) } },
      select: { id: true, patientId: true, station: true, status: true, responsibleRole: true, createdAt: true, updatedAt: true, referralRequest: { select: { id: true } }, ...patientSelect },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: sourceLimit,
    }).then((rows) => ({ type: "stage" as const, rows })));
  }
  if (wants("referral") && perms.has("referrals.view")) {
    const destinationScope = centerScopedRole && centerIds
      ? { OR: [{ destinationCenterId: null }, { destinationCenterId: { in: centerIds } }] }
      : {};
    queries.push(prisma.referralRequest.findMany({
      where: { status: { in: ["DRAFT", "PENDING_PRINT", "READY", "SENT", "RESULT_RECEIVED", "REVIEWED", "ACCEPTED"] }, ...branchPatientWhere, ...destinationScope },
      select: { id: true, patientId: true, requestedService: true, status: true, createdAt: true, updatedAt: true, assignedReviewer: { select: { fullName: true } }, destinationCenterId: true, destinationCenter: { select: { name: true } }, ...patientSelect },
      orderBy: { updatedAt: "asc" },
      take: sourceLimit,
    }).then((rows) => ({ type: "referral" as const, rows })));
  }
  if (wants("plan") && (perms.has("therapy.view") || perms.has("therapy.plan.manage"))) {
    queries.push(prisma.treatmentPlan.findMany({
      where: {
        status: { in: ["ACTIVE", "PAUSED"] },
        ...(role === "THERAPIST" ? { therapistId: userId } : {}),
        ...centerWhere,
        ...branchPatientWhere,
      },
      select: { id: true, patientId: true, title: true, status: true, expectedEndDate: true, createdAt: true, therapist: { select: { fullName: true } }, centerId: true, center: { select: { name: true } }, ...patientSelect },
      orderBy: [{ expectedEndDate: "asc" }, { createdAt: "asc" }],
      take: sourceLimit,
    }).then((rows) => ({ type: "plan" as const, rows })));
  }
  if (wants("session") && perms.has("therapy.session.record")) {
    queries.push(prisma.appointment.findMany({
      where: { status: { in: ["SCHEDULED", "NOSHOW"] }, sessionId: { not: null }, scheduledAt: { gte: todayStart, lt: tomorrow }, OR: [{ assignedToId: userId }, { assignedTo: userName }], ...centerWhere, ...branchPatientWhere },
      select: { id: true, patientId: true, status: true, scheduledAt: true, createdAt: true, assignedTo: true, centerId: true, center: { select: { name: true } }, ...patientSelect },
      orderBy: { scheduledAt: "asc" },
      take: sourceLimit,
    }).then((rows) => ({ type: "session" as const, rows })));
  }
  if (wants("prescription") && perms.has("pharmacy.view")) {
    queries.push(prisma.prescription.findMany({
      where: { prescriptionType: "INTERNAL", eligibilityDecision: "ELIGIBLE", status: { in: ["PENDING", "PARTIAL"] }, ...branchPatientWhere },
      select: { id: true, patientId: true, status: true, prescribedAt: true, dispensedBy: true, ...patientSelect },
      orderBy: { prescribedAt: "asc" },
      take: sourceLimit,
    }).then((rows) => ({ type: "prescription" as const, rows })));
  }
  if (wants("stock") && (perms.has("pharmacy.batch") || perms.has("inventory.view"))) {
    queries.push(prisma.medicationBatch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: new Date(now.getTime() + 60 * 86_400_000) } },
      select: { id: true, batchNo: true, quantity: true, expiryDate: true, createdAt: true, medication: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
      take: sourceLimit,
    }).then((rows) => ({ type: "stock" as const, rows })));
  }
  if (wants("purchase") && perms.has("pharmacy.purchase.view")) {
    queries.push(prisma.purchaseOrder.findMany({
      where: { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] } },
      select: { id: true, orderNo: true, status: true, orderDate: true, expectedDeliveryDate: true, createdAt: true, supplier: { select: { name: true } } },
      orderBy: [{ expectedDeliveryDate: "asc" }, { createdAt: "asc" }],
      take: sourceLimit,
    }).then((rows) => ({ type: "purchase" as const, rows })));
  }
  if (wants("expense") && perms.has("expenses.view")) {
    const statuses = perms.has("expenses.pay")
      ? ["READY_FOR_PAYMENT"]
      : perms.has("expenses.approve")
        ? ["SUBMITTED", "APPROVED"]
        : ["DRAFT", "SUBMITTED", "APPROVED", "READY_FOR_PAYMENT"];
    queries.push(prisma.woundedExpense.findMany({
      where: { status: { in: statuses as any }, ...branchPatientWhere },
      select: { id: true, patientId: true, voucherNo: true, expenseType: true, status: true, requestDate: true, dueDate: true, createdAt: true, createdBy: { select: { fullName: true } }, ...patientSelect },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: sourceLimit,
    }).then((rows) => ({ type: "expense" as const, rows })));
  }
  if (wants("approval") && perms.has("approvals.view")) {
    queries.push(prisma.approvalRequest.findMany({
      where: { status: { in: ["PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED"] }, ...(branchId ? { patient: { branchId } } : {}) },
      select: { id: true, patientId: true, title: true, status: true, requestedByName: true, createdAt: true, updatedAt: true, ...patientSelect },
      orderBy: { createdAt: "asc" },
      take: sourceLimit,
    }).then((rows) => ({ type: "approval" as const, rows })));
  }

  const sourceRows = await Promise.all(queries);
  const items: WorkItem[] = sourceRows.flatMap(({ type, rows }) => rows.map((row: any) => {
    const status = String(row.status);
    const waitingSince = row.createdAt ?? row.orderDate ?? row.requestDate ?? row.prescribedAt ?? row.scheduledAt ?? now;
    const dueAt = row.dueDate ?? row.expectedDeliveryDate ?? row.expectedEndDate ?? row.expiryDate ?? row.scheduledAt ?? null;
    const patientName = patientLabel(row);
    const base = {
      key: `${type}:${row.id}`,
      dedupeKey: row.referralRequest?.id ? `referral:${row.referralRequest.id}` : `${type}:${row.id}`,
      type,
      patientName,
      status,
      priority: derivePriority({ dueAt, explicit: row.priority, waitingSince, now }),
      assignee: row.assignedTo?.fullName ?? row.assignedTo ?? row.assignedReviewer?.fullName ?? row.therapist?.fullName ?? row.createdBy?.fullName ?? row.assignedRole ?? row.responsibleRole ?? null,
      waitingSince,
      dueAt,
      centerId: row.centerId ?? row.destinationCenterId ?? null,
      centerName: row.center?.name ?? row.destinationCenter?.name ?? null,
      ...branchFields(row),
    };
    if (type === "task") return { ...base, title: row.title, nextAction: nextAction(type, status), href: "/staff?tab=tasks", requiredPermission: "tasks.view" };
    if (type === "appointment") return { ...base, title: row.type || "موعد مجدول", nextAction: nextAction(type, status), href: patientName ? `/patients/${row.patientId}?tab=overview` : "/patients-care?tab=appointments", requiredPermission: "appointments.view" };
    if (type === "queue") return { ...base, title: row.hall ? `طابور ${row.hall}` : "الطابور الحالي", nextAction: nextAction(type, status), href: "/patients-care?tab=queue", requiredPermission: "queue.view" };
    if (type === "stage") return { ...base, title: row.station, nextAction: nextAction(type, status), href: patientName ? `/patients/${row.patientId}?tab=journey` : "/patients-care?tab=journey", requiredPermission: "journey.view" };
    if (type === "referral") return { ...base, title: row.requestedService, nextAction: nextAction(type, status), href: patientName ? `/patients/${row.patientId}?tab=referrals` : "/patients-care?tab=referrals", requiredPermission: "referrals.view" };
    if (type === "plan") return { ...base, title: row.title, nextAction: nextAction(type, status), href: patientName ? `/patients/${row.patientId}?tab=therapyProgram` : "/therapy-centers?tab=plans", requiredPermission: perms.has("therapy.view") ? "therapy.view" : "therapy.plan.manage" };
    if (type === "session") return { ...base, title: "جلسة علاجية اليوم", nextAction: nextAction(type, status), href: patientName ? `/patients/${row.patientId}?tab=sessions` : "/therapy-centers?tab=today", requiredPermission: "therapy.session.record" };
    if (type === "prescription") return { ...base, title: "وصفة داخلية مؤهلة", nextAction: nextAction(type, status), href: patientName ? `/patients/${row.patientId}?tab=rx` : "/pharmacy-inventory?tab=dispense", requiredPermission: "pharmacy.view" };
    if (type === "stock") return { ...base, title: `${row.medication.name}${row.batchNo ? ` · ${row.batchNo}` : ""}`, nextAction: "فتح الدفعات", href: "/pharmacy-inventory?tab=batches&batchState=soon", requiredPermission: perms.has("inventory.view") ? "inventory.view" : "pharmacy.batch" };
    if (type === "purchase") return { ...base, title: `${row.orderNo} · ${row.supplier.name}`, nextAction: nextAction(type, status), href: `/pharmacy/purchases/${row.id}`, requiredPermission: "pharmacy.purchase.view" };
    if (type === "expense") return { ...base, title: `${row.voucherNo} · ${row.expenseType}`, nextAction: nextAction(type, status), href: `/finance/expenses/${row.id}`, requiredPermission: "expenses.view" };
    return { ...base, title: row.title, nextAction: nextAction(type, status), href: "/reports-finance?tab=approvals", requiredPermission: "approvals.view" };
  }));

  const visible = items.filter((item) => perms.has(item.requiredPermission));
  const filtered = filterWorkItems(sortWorkItems(dedupeWorkItems(visible)), filters, now);
  const page = paginateWorkItems(filtered, filters.page);
  const centers = await prisma.center.findMany({
    where: { active: true, ...(centerIds ? { id: { in: centerIds } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  const queryWithoutPage = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) if (value && key !== "page") queryWithoutPage.set(key, value);
  const pageHref = (number: number) => {
    const query = new URLSearchParams(queryWithoutPage);
    query.set("page", String(number));
    return `/my-work?${query}`;
  };

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader title="قائمة عملي" subtitle="حالات موجودة فعلياً تنتظر دورك، مرتبة حسب الاستحقاق والأولوية" icon="☑">
        <Link href="/workspaces" className="btn-ghost bg-white text-brand-700">مساحاتي</Link>
      </PageHeader>

      <form className="card grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6" autoComplete="off">
        <label className="label">النوع<select name="type" className="input mt-1" defaultValue={filters.type}><option value="all">الكل</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="label">الحالة<input name="status" className="input mt-1" defaultValue={filters.status === "all" ? "" : filters.status} placeholder="كل الحالات" /></label>
        <label className="label">الأولوية<select name="priority" className="input mt-1" defaultValue={filters.priority}><option value="all">الكل</option>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="label">المركز<select name="center" className="input mt-1" defaultValue={filters.centerId ?? ""}><option value="">كل المتاح</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
        <label className="label">التاريخ<select name="date" className="input mt-1" defaultValue={filters.date}><option value="all">الكل</option><option value="overdue">متأخر</option><option value="today">اليوم</option><option value="week">خلال أسبوع</option></select></label>
        <div className="flex items-end gap-2"><button className="btn-primary" type="submit">تطبيق</button><Link href="/my-work" className="btn-ghost">مسح</Link></div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
        <span>{page.total} عنصر مطابق · صفحة {page.page} من {page.pageCount}</span>
        <span>{branchId && userBranch?.branch ? `النطاق الافتراضي: ${userBranch.branch.name}` : "النطاق حسب صلاحيات الحساب وعضويات المراكز"}</span>
      </div>

      {page.items.length === 0 ? (
        <EmptyState title="لا توجد حالات تنتظر دورك" description="لا توجد عناصر مطابقة للصلاحيات والفلاتر الحالية. جرّب مسح الفلاتر أو افتح مساحتك اليومية." />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50"><tr><th className="th">الأولوية</th><th className="th">العمل</th><th className="th">المراجع</th><th className="th">الحالة</th><th className="th">المسؤول</th><th className="th">الانتظار/الاستحقاق</th><th className="th">النطاق</th><th className="th">التالي</th></tr></thead>
              <tbody>{page.items.map((item) => <WorkRow key={item.key} item={item} now={now} />)}</tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {page.items.map((item) => <WorkCard key={item.key} item={item} now={now} />)}
          </div>
        </>
      )}

      {page.pageCount > 1 ? (
        <nav className="flex items-center justify-center gap-2" aria-label="صفحات قائمة عملي">
          {page.page > 1 ? <Link href={pageHref(page.page - 1)} className="btn-ghost">السابق</Link> : null}
          <span className="px-3 text-sm text-gray-500">{page.page} / {page.pageCount}</span>
          {page.page < page.pageCount ? <Link href={pageHref(page.page + 1)} className="btn-ghost">التالي</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}

function WorkRow({ item, now }: { item: WorkItem; now: Date }) {
  return (
    <tr className={item.priority === "urgent" ? "bg-red-50/35" : ""}>
      <td className="td"><Priority item={item} /></td>
      <td className="td"><div className="font-medium text-gray-900">{TYPE_LABELS[item.type]} · {item.title}</div></td>
      <td className="td">{item.patientName ?? "محجوب/غير مرتبط"}</td>
      <td className="td">{item.status}</td>
      <td className="td">{item.assignee ?? "حسب الدور"}</td>
      <td className="td"><div>{waitLabel(item.waitingSince, now)}</div>{item.dueAt ? <div className="text-xs text-gray-400">{item.dueAt.toLocaleString("ar-IQ")}</div> : null}</td>
      <td className="td">{item.centerName ?? item.branchName ?? "عام"}</td>
      <td className="td"><Link href={item.href} className="text-brand-700 hover:underline">{item.nextAction} ←</Link></td>
    </tr>
  );
}

function WorkCard({ item, now }: { item: WorkItem; now: Date }) {
  return (
    <article className={`card p-4 ${item.priority === "urgent" ? "ring-1 ring-red-200" : ""}`}>
      <div className="flex items-start justify-between gap-3"><div><div className="text-xs text-gray-500">{TYPE_LABELS[item.type]}</div><h2 className="mt-1 font-semibold text-gray-900">{item.title}</h2></div><Priority item={item} /></div>
      {item.patientName ? <div className="mt-2 text-sm text-gray-700">{item.patientName}</div> : null}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500"><span>الحالة: {item.status}</span><span>الانتظار: {waitLabel(item.waitingSince, now)}</span><span>المسؤول: {item.assignee ?? "حسب الدور"}</span><span>النطاق: {item.centerName ?? item.branchName ?? "عام"}</span></div>
      <Link href={item.href} className="btn-primary mt-4 inline-flex">{item.nextAction}</Link>
    </article>
  );
}

function Priority({ item }: { item: WorkItem }) {
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${PRIORITY_CLASS[item.priority]}`}>{PRIORITY_LABELS[item.priority]}</span>;
}
