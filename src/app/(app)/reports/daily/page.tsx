import { prisma } from "@/lib/db";
import { requirePerm, currentPerms } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/PrintButton";
import { getOrg } from "@/lib/org";
import { APPT_STATUS, DEVICE_STATUS, QUEUE_STATUS, fmtDate } from "@/lib/labels";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";
import Link from "next/link";

export const dynamic = "force-dynamic";

const dayMs = 86400000;
const soonDays = 60;

function localISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function asDay(value?: string) {
  if (!value) return new Date(new Date().toDateString());
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return new Date(new Date().toDateString());
  return new Date(y, m - 1, d);
}

function countOf(rows: any[], key: string) {
  return rows.find((r) => r.status === key)?._count ?? 0;
}

function sumRows(rows: { value: number }[]) {
  return rows.reduce((sum, r) => sum + r.value, 0);
}

export default async function DailyReport({ searchParams }: { searchParams: Promise<{ date?: string; branch?: string }> }) {
  await requirePerm("reports.view");
  const perms = await currentPerms();
  const userBranch = await currentUserBranch();
  const canPrint = perms.has("reports.print");
  const canPharmacy = perms.has("pharmacy.view");
  const canDevices = perms.has("devices.view");
  const sp = await searchParams;
  const branchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const branchFilter = branchId ? { branchId } : {};
  const dayStart = asDay(sp.date);
  const dayEnd = new Date(dayStart.getTime() + dayMs);
  const inDay = { gte: dayStart, lt: dayEnd };
  const now = new Date();
  const soon = new Date(dayStart.getTime() + soonDays * dayMs);
  const org = await getOrg();

  const [
    visitsToday,
    visitRows,
    appts,
    apptRows,
    queueAgg,
    queueRows,
    taskOpen,
    taskOverdue,
    taskDone,
    taskRows,
    admittedList,
    admissionRows,
    pharmacyAgg,
    lowMeds,
    expiringBatches,
    deviceDue,
    deviceReplaced,
    deviceMaintained,
    deviceRows,
    branches,
  ] = await Promise.all([
    prisma.visit.count({ where: { visitDate: inDay, patient: branchFilter } }),
    prisma.visit.findMany({ where: { visitDate: inDay, patient: branchFilter }, include: { patient: { select: { id: true, fullName: true, fileNumber: true } } }, orderBy: { visitDate: "desc" }, take: 8 }),
    prisma.appointment.groupBy({ by: ["status"], _count: true, where: { scheduledAt: inDay, patient: branchFilter } }),
    prisma.appointment.findMany({ where: { scheduledAt: inDay, patient: branchFilter }, include: { patient: { select: { id: true, fullName: true, fileNumber: true } } }, orderBy: { scheduledAt: "asc" }, take: 10 }),
    prisma.queueEntry.groupBy({ by: ["status"], _count: true, where: { createdAt: inDay, patient: branchFilter } }),
    prisma.queueEntry.findMany({ where: { createdAt: inDay, patient: branchFilter }, include: { patient: { select: { id: true, fullName: true, fileNumber: true } } }, orderBy: { createdAt: "asc" }, take: 10 }),
    prisma.task.count({ where: { createdAt: inDay, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.task.count({ where: { dueDate: { lt: dayEnd }, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.task.count({ where: { completedAt: inDay, status: "DONE" } }),
    prisma.task.findMany({ where: { OR: [{ createdAt: inDay }, { completedAt: inDay }, { dueDate: inDay }], ...(branchId ? { patient: branchFilter } : {}) }, include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, assignedTo: { select: { fullName: true } } }, orderBy: [{ priority: "desc" }, { dueDate: "asc" }], take: 10 }),
    prisma.admission.findMany({ where: { admissionDate: { lt: dayEnd }, OR: [{ dischargeDate: null }, { dischargeDate: { gte: dayStart } }], status: "ADMITTED", patient: branchFilter }, select: { admissionDate: true, durationDays: true } }),
    prisma.admission.findMany({ where: { admissionDate: { lt: dayEnd }, OR: [{ dischargeDate: null }, { dischargeDate: { gte: dayStart } }], status: "ADMITTED", patient: branchFilter }, include: { patient: { select: { id: true, fullName: true, fileNumber: true } }, center: true }, orderBy: { admissionDate: "asc" }, take: 8 }),
    canPharmacy ? Promise.all([
      prisma.prescription.count({ where: { status: "PENDING", prescribedAt: { lt: dayEnd }, patient: branchFilter } }),
      prisma.prescription.count({ where: { status: "DISPENSED", dispensedAt: inDay, patient: branchFilter } }),
      prisma.prescription.count({ where: { status: "PARTIAL", prescribedAt: { lt: dayEnd }, patient: branchFilter } }),
    ]) : Promise.resolve([0, 0, 0]),
    canPharmacy ? prisma.medication.findMany({ orderBy: { name: "asc" }, take: 500 }) : Promise.resolve([]),
    canPharmacy ? prisma.medicationBatch.findMany({ where: { quantity: { gt: 0 }, expiryDate: { not: null, gte: dayStart, lte: soon } }, include: { medication: true }, orderBy: { expiryDate: "asc" }, take: 8 }) : Promise.resolve([]),
    canDevices ? prisma.device.count({ where: { nextMaintenanceAt: { lte: dayEnd }, status: { not: "REPLACED" }, patient: branchFilter } }) : Promise.resolve(0),
    canDevices ? prisma.device.count({ where: { status: "REPLACED", patient: branchFilter } }) : Promise.resolve(0),
    canDevices ? prisma.device.count({ where: { status: "MAINTAINED", patient: branchFilter } }) : Promise.resolve(0),
    canDevices ? prisma.device.findMany({ where: { nextMaintenanceAt: { lte: dayEnd }, status: { not: "REPLACED" }, patient: branchFilter }, include: { patient: { select: { id: true, fullName: true, fileNumber: true } } }, orderBy: { nextMaintenanceAt: "asc" }, take: 8 }) : Promise.resolve([]),
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const apptScheduled = countOf(appts, "SCHEDULED");
  const apptCompleted = countOf(appts, "COMPLETED");
  const apptCancelled = countOf(appts, "CANCELLED");
  const apptNoShow = countOf(appts, "NOSHOW");
  const queueWaiting = countOf(queueAgg, "WAITING");
  const queueCalled = countOf(queueAgg, "CALLED");
  const queueInSession = countOf(queueAgg, "IN_SESSION");
  const queueDone = countOf(queueAgg, "DONE");
  const [rxPending, rxDispensed, rxPartial] = pharmacyAgg;
  const lowStock = lowMeds.filter((m: any) => (m.quantity ?? 0) <= (m.minQuantity ?? 0));
  const emptyStock = lowStock.filter((m: any) => (m.quantity ?? 0) <= 0);
  const admOver = admittedList.filter((a) => a.durationDays && dayEnd >= new Date(new Date(a.admissionDate).getTime() + a.durationDays * dayMs)).length;

  const prevDay = localISO(new Date(dayStart.getTime() - dayMs));
  const nextDay = localISO(new Date(dayStart.getTime() + dayMs));
  const selected = localISO(dayStart);
  const today = localISO(new Date());

  const kpis = [
    { label: "زيارات اليوم", value: visitsToday, href: "/patients-care?tab=visits" },
    { label: "مواعيد اليوم", value: apptScheduled + apptCompleted + apptCancelled + apptNoShow, href: "/patients-care?tab=appointments" },
    { label: "بالطابور", value: queueWaiting + queueCalled + queueInSession, href: "/patients-care?tab=queue" },
    { label: "مهام متأخرة", value: taskOverdue, href: "/staff?tab=tasks&taskStatus=overdue" },
    ...(canPharmacy ? [{ label: "وصفات معلقة", value: rxPending, href: "/pharmacy-inventory?tab=dispense" }] : []),
    ...(canDevices ? [{ label: "أجهزة تحتاج صيانة", value: deviceDue, href: "/devices?due=1" }] : []),
    { label: "راقدون حالياً", value: admittedList.length, href: "/therapy-centers?tab=beds" },
    { label: "انتهت مدة رقودهم", value: admOver, href: "/therapy-centers?tab=beds" },
  ];

  const Summary = ({ title, rows, href }: { title: string; rows: { label: string; value: number; tone?: string; href?: string }[]; href?: string }) => (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-brand-900">{title}</h2>
        {href && <Link href={href} className="no-print text-xs text-brand-700 hover:underline">تفاصيل</Link>}
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <Link key={r.label} href={r.href || href || "#"} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
            <span className="text-gray-600">{r.label}</span>
            <span className={`font-bold ${r.tone === "danger" ? "text-red-700" : r.tone === "warning" ? "text-amber-700" : "text-gray-900"}`}>{r.value}</span>
          </Link>
        ))}
      </div>
    </div>
  );

  const MiniTable = ({ title, empty, children, href }: { title: string; empty: boolean; children: React.ReactNode; href?: string }) => (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        {href && <Link href={href} className="no-print text-xs text-brand-700 hover:underline">فتح</Link>}
      </div>
      {empty ? <div className="px-4 py-5 text-center text-sm text-gray-400">لا توجد بيانات ضمن هذا اليوم.</div> : <div className="overflow-x-auto">{children}</div>}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="تقرير العمليات اليومي" subtitle="ملخص إداري ليوم محدد قابل للطباعة" icon="📋" />
      {userBranch?.branch?.name && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800 print:hidden">
          {branchId ? `التقرير مفلتر افتراضياً حسب فرعك: ${userBranch.branch.name}` : "يعرض التقرير كل الفروع حالياً"}
        </div>
      )}

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/reports/daily?date=${prevDay}`} className="badge-neutral">→ السابق</Link>
          <form action="/reports/daily" className="flex flex-wrap items-center gap-1">
            <input type="date" name="date" defaultValue={selected} className="input !py-1 text-sm" />
            {branches.length > 0 && (
              <select name="branch" defaultValue={sp.branch ?? (branchId ? String(branchId) : "")} className="input !py-1 text-sm">
                <option value="all">كل الفروع</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button className="btn-ghost btn-sm" type="submit">عرض</button>
          </form>
          <Link href={`/reports/daily?date=${nextDay}`} className="badge-neutral">التالي ←</Link>
          {selected !== today && <Link href="/reports/daily" className="badge-brand">اليوم</Link>}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/reports-finance?tab=overview" className="btn-ghost btn-sm">التقارير</Link>
          {canPrint && <PrintButton />}
        </div>
      </div>

      <div id="daily-report" className="card mx-auto max-w-6xl p-5 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <div className="print-header border-b-2 border-brand-700 pb-4 text-center">
          {(org.officialHeader1 || org.officialHeader2 || org.officialHeader3) && <div className="text-sm font-semibold text-gray-700">{[org.officialHeader1, org.officialHeader2, org.officialHeader3].filter(Boolean).join(" - ")}</div>}
          <div className="text-2xl font-bold text-brand-900">{org.officialHeader4 || org.name}</div>
          {org.subtitle && <div className="text-sm text-gray-600">{org.subtitle}</div>}
          <div className="mt-1 text-xs text-gray-500">{[org.officialAddress || org.address, org.officialPhone || org.phone].filter(Boolean).join(" — ")}</div>
        </div>

        <div className="my-4 text-center">
          <div className="text-xl font-bold text-gray-900">التقرير اليومي للإدارة</div>
          <div className="text-sm text-gray-500">ليوم {fmtDate(dayStart)}</div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 print:grid-cols-4">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-center hover:bg-brand-50 print:bg-white">
              <div className={`text-2xl font-bold ${k.value > 0 && (k.label.includes("متأخرة") || k.label.includes("صيانة") || k.label.includes("انتهت")) ? "text-red-700" : "text-gray-900"}`}>{k.value}</div>
              <div className="text-xs text-gray-500">{k.label}</div>
            </Link>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
          <Summary title="الزيارات والمواعيد" href="/patients-care?tab=appointments" rows={[
            { label: "زيارات اليوم", value: visitsToday, href: "/patients-care?tab=visits" },
            { label: "مواعيد مجدولة", value: apptScheduled },
            { label: "مواعيد مكتملة", value: apptCompleted },
            { label: "مواعيد ملغاة", value: apptCancelled, tone: "warning" },
            { label: "لم يحضر", value: apptNoShow, tone: "danger" },
          ]} />
          <Summary title="الطابور" href="/patients-care?tab=queue" rows={[
            { label: QUEUE_STATUS.WAITING, value: queueWaiting },
            { label: QUEUE_STATUS.CALLED, value: queueCalled },
            { label: QUEUE_STATUS.IN_SESSION, value: queueInSession },
            { label: QUEUE_STATUS.DONE, value: queueDone },
          ]} />
          <Summary title="المهام" href="/staff?tab=tasks" rows={[
            { label: "مفتوحة أنشئت اليوم", value: taskOpen },
            { label: "متأخرة حتى نهاية اليوم", value: taskOverdue, tone: "danger", href: "/staff?tab=tasks&taskStatus=overdue" },
            { label: "مكتملة اليوم", value: taskDone },
          ]} />
          {canPharmacy && <Summary title="الصيدلية والمخزون" href="/pharmacy-inventory?tab=overview" rows={[
            { label: "وصفات معلقة", value: rxPending, tone: rxPending ? "warning" : undefined },
            { label: "وصفات مصروفة اليوم", value: rxDispensed },
            { label: "وصفات جزئية", value: rxPartial, tone: rxPartial ? "warning" : undefined },
            { label: "مواد منخفضة/نافدة", value: lowStock.length, tone: lowStock.length ? "danger" : undefined, href: "/pharmacy-inventory?tab=stock&stockState=low" },
            { label: "نافدة بالكامل", value: emptyStock.length, tone: emptyStock.length ? "danger" : undefined, href: "/pharmacy-inventory?tab=stock&stockState=out" },
            { label: `دفعات قرب النفاذ (${soonDays} يوم)`, value: expiringBatches.length, tone: expiringBatches.length ? "warning" : undefined, href: "/pharmacy-inventory?tab=batches&batchState=soon" },
          ]} />}
          {canDevices && <Summary title="الأجهزة والرقود" href="/devices" rows={[
            { label: "أجهزة تحتاج صيانة", value: deviceDue, tone: deviceDue ? "danger" : undefined, href: "/devices?due=1" },
            { label: "أجهزة مستبدلة", value: deviceReplaced },
            { label: "أجهزة تمت صيانتها", value: deviceMaintained },
            { label: "راقدون حالياً", value: admittedList.length, href: "/therapy-centers?tab=beds" },
            { label: "انتهت مدة رقودهم", value: admOver, tone: admOver ? "danger" : undefined, href: "/therapy-centers?tab=beds" },
          ]} />}
        </div>

        <div className="mt-5 grid gap-4 print:grid-cols-2">
          <MiniTable title="زيارات اليوم" href="/patients-care?tab=visits" empty={visitRows.length === 0}>
            <table className="w-full text-sm">
              <thead><tr><th className="th">المراجع</th><th className="th">رقم الملف</th><th className="th">ملاحظات</th></tr></thead>
              <tbody>{visitRows.map((v) => <tr key={v.id}><td className="td"><Link href={`/patients/${v.patientId}`} className="text-brand-700 hover:underline">{v.patient.fullName}</Link></td><td className="td">{v.patient.fileNumber}</td><td className="td">{v.notes || "—"}</td></tr>)}</tbody>
            </table>
          </MiniTable>

          <MiniTable title="مواعيد اليوم" href="/patients-care?tab=appointments" empty={apptRows.length === 0}>
            <table className="w-full text-sm">
              <thead><tr><th className="th">المراجع</th><th className="th">النوع</th><th className="th">الحالة</th><th className="th">المسؤول</th></tr></thead>
              <tbody>{apptRows.map((a) => <tr key={a.id}><td className="td"><Link href={`/patients/${a.patientId}`} className="text-brand-700 hover:underline">{a.patient.fullName}</Link></td><td className="td">{a.type || "—"}</td><td className="td">{APPT_STATUS[a.status as keyof typeof APPT_STATUS]}</td><td className="td">{a.assignedTo || "—"}</td></tr>)}</tbody>
            </table>
          </MiniTable>

          <MiniTable title="حركة الطابور" href="/patients-care?tab=queue" empty={queueRows.length === 0}>
            <table className="w-full text-sm">
              <thead><tr><th className="th">المراجع</th><th className="th">الحالة</th><th className="th">القاعة</th></tr></thead>
              <tbody>{queueRows.map((q) => <tr key={q.id}><td className="td"><Link href={`/patients/${q.patientId}`} className="text-brand-700 hover:underline">{q.patient.fullName}</Link></td><td className="td">{QUEUE_STATUS[q.status as keyof typeof QUEUE_STATUS]}</td><td className="td">{q.hall || "—"}</td></tr>)}</tbody>
            </table>
          </MiniTable>

          <MiniTable title="مهام اليوم" href="/staff?tab=tasks" empty={taskRows.length === 0}>
            <table className="w-full text-sm">
              <thead><tr><th className="th">العنوان</th><th className="th">الحالة</th><th className="th">المراجع</th><th className="th">المسند إليه</th></tr></thead>
              <tbody>{taskRows.map((t) => <tr key={t.id}><td className="td"><Link href="/staff?tab=tasks" className="text-brand-700 hover:underline">{t.title}</Link></td><td className="td">{t.status}</td><td className="td">{t.patient ? <Link href={`/patients/${t.patientId}`} className="text-brand-700 hover:underline">{t.patient.fullName}</Link> : "—"}</td><td className="td">{t.assignedTo?.fullName || t.assignedRole || "—"}</td></tr>)}</tbody>
            </table>
          </MiniTable>

          {canDevices && (
            <MiniTable title="أجهزة تحتاج صيانة" href="/devices?due=1" empty={deviceRows.length === 0}>
              <table className="w-full text-sm">
                <thead><tr><th className="th">الجهاز</th><th className="th">المراجع</th><th className="th">الصيانة</th><th className="th">الحالة</th></tr></thead>
                <tbody>{deviceRows.map((d) => <tr key={d.id}><td className="td">{d.type}</td><td className="td"><Link href={`/patients/${d.patientId}`} className="text-brand-700 hover:underline">{d.patient.fullName}</Link></td><td className="td text-red-700">{fmtDate(d.nextMaintenanceAt)}</td><td className="td">{DEVICE_STATUS[d.status as keyof typeof DEVICE_STATUS]}</td></tr>)}</tbody>
              </table>
            </MiniTable>
          )}

          <MiniTable title="الرقود الحالي" href="/therapy-centers?tab=beds" empty={admissionRows.length === 0}>
            <table className="w-full text-sm">
              <thead><tr><th className="th">المراجع</th><th className="th">المركز</th><th className="th">تاريخ الدخول</th><th className="th">الحالة</th></tr></thead>
              <tbody>{admissionRows.map((a) => {
                const over = a.durationDays && dayEnd >= new Date(new Date(a.admissionDate).getTime() + a.durationDays * dayMs);
                return <tr key={a.id}><td className="td"><Link href={`/patients/${a.patientId}`} className="text-brand-700 hover:underline">{a.patient.fullName}</Link></td><td className="td">{a.center?.name || "—"}</td><td className="td">{fmtDate(a.admissionDate)}</td><td className={`td ${over ? "font-semibold text-red-700" : ""}`}>{over ? "انتهت مدة الرقود" : "راقد"}</td></tr>;
              })}</tbody>
            </table>
          </MiniTable>

          {canPharmacy && (
            <MiniTable title="دفعات قرب النفاذ" href="/pharmacy-inventory?tab=batches&batchState=soon" empty={expiringBatches.length === 0}>
              <table className="w-full text-sm">
                <thead><tr><th className="th">المادة</th><th className="th">الدفعة</th><th className="th">الكمية</th><th className="th">النفاذية</th></tr></thead>
                <tbody>{expiringBatches.map((b) => <tr key={b.id}><td className="td">{b.medication.name}</td><td className="td">{b.batchNo || "—"}</td><td className="td">{b.quantity}</td><td className="td">{fmtDate(b.expiryDate)}</td></tr>)}</tbody>
              </table>
            </MiniTable>
          )}
        </div>

        <div className="mt-8 flex justify-between border-t border-gray-200 pt-4 text-sm text-gray-600">
          <div>أُعدّ بتاريخ: {fmtDate(new Date())}</div>
          <div>التوقيع: ......................</div>
        </div>
      </div>
    </div>
  );
}
