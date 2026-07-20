import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { currentPerms, requirePerm } from "@/lib/access";
import { APPT_STATUS, CASE_TYPE, DEVICE_STATUS, PATIENT_STATUS, RX_STATUS, THERAPY, fmtDate } from "@/lib/labels";
import { BarChart, Donut, HBars } from "@/components/charts";
import { TrendChart } from "@/components/TrendChart";
import { Combobox } from "@/components/Combobox";
import { PrintButton } from "@/components/PrintButton";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";
import Link from "next/link";

export const dynamic = "force-dynamic";

const dayMs = 86400000;
const monthNames = ["كانون2", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين1", "تشرين2", "كانون1"];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function clampDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : startOfDay(d);
}

function dayKey(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return isoDate(startOfDay(x));
}

function rangeDays(from: Date, toExclusive: Date) {
  const days: string[] = [];
  for (let t = from.getTime(); t < toExclusive.getTime(); t += dayMs) days.push(isoDate(new Date(t)));
  return days.slice(-45);
}

function percent(part: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function Stat({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const inner = (
    <div className="card p-4 transition hover:ring-1 hover:ring-brand-200">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-400">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-gray-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export default async function Analytics({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; caseType?: string; centerId?: string; branch?: string }> }) {
  await requirePerm("analytics.view");
  const perms = await currentPerms();
  const userBranch = await currentUserBranch();
  const canPharmacy = perms.has("pharmacy.view");
  const sp = await searchParams;
  const now = new Date();
  const defaultFrom = startOfDay(new Date(now.getTime() - 29 * dayMs));
  const from = clampDate(sp.from, defaultFrom);
  const toDay = clampDate(sp.to, startOfDay(now));
  const toExclusive = new Date(toDay.getTime() + dayMs);
  const caseType = sp.caseType || "";
  const centerId = sp.centerId ? Number(sp.centerId) : null;
  const branchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const caseFilter = caseType ? { caseType: caseType as any } : {};
  const branchFilter = branchId ? { branchId } : {};
  const sessionCenterFilter = centerId ? { centerId } : {};
  const admissionCenterFilter = centerId ? { centerId } : {};
  const dateRange = { gte: from, lt: toExclusive };

  const patientBaseWhere = { archivedAt: null, ...caseFilter, ...branchFilter };
  const newPatientWhere = { registrationDate: dateRange, ...caseFilter, ...branchFilter };

  const [
    centers,
    branches,
    totalPatients,
    newPatients,
    activePatients,
    visitsCount,
    apptsCount,
    sessionsCount,
    devicesDue,
    byGov,
    byInjury,
    byStatus,
    byCase,
    govs,
    injuries,
    visits,
    apptByStatus,
    sessionByTherapist,
    sessionByType,
    deviceByStatus,
    prescriptionsByStatus,
    lowMeds,
    stockDispense,
    admittedNow,
    admissionsInRange,
  ] = await Promise.all([
    prisma.center.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.patient.count({ where: patientBaseWhere }),
    prisma.patient.count({ where: newPatientWhere }),
    prisma.patient.count({ where: { ...patientBaseWhere, status: "ACTIVE" } }),
    prisma.visit.count({ where: { visitDate: dateRange, patient: { ...patientBaseWhere } } }),
    prisma.appointment.count({ where: { scheduledAt: dateRange, patient: { ...patientBaseWhere } } }),
    prisma.therapySession.count({ where: { createdAt: dateRange, ...sessionCenterFilter, patient: { ...patientBaseWhere } } }),
    prisma.device.count({ where: { nextMaintenanceAt: { lte: now }, status: { not: "REPLACED" }, patient: { ...patientBaseWhere } } }),
    prisma.patient.groupBy({ by: ["governorateId"], where: patientBaseWhere, _count: { _all: true } }),
    prisma.patient.groupBy({ by: ["injuryTypeId"], where: patientBaseWhere, _count: { _all: true } }),
    prisma.patient.groupBy({ by: ["status"], where: patientBaseWhere, _count: { _all: true } }),
    prisma.patient.groupBy({ by: ["caseType"], where: { archivedAt: null, ...branchFilter }, _count: { _all: true } }),
    prisma.governorate.findMany({ select: { id: true, name: true } }),
    prisma.injuryType.findMany({ select: { id: true, name: true } }),
    prisma.visit.findMany({ where: { visitDate: dateRange, patient: { ...patientBaseWhere } }, select: { visitDate: true }, take: 5000, orderBy: { visitDate: "asc" } }),
    prisma.appointment.groupBy({ by: ["status"], where: { scheduledAt: dateRange, patient: { ...patientBaseWhere } }, _count: { _all: true } }),
    prisma.therapySession.groupBy({ by: ["therapist"], where: { createdAt: dateRange, ...sessionCenterFilter, patient: { ...patientBaseWhere } }, _count: { _all: true }, orderBy: { _count: { therapist: "desc" } }, take: 12 }),
    prisma.therapySession.groupBy({ by: ["therapyType"], where: { createdAt: dateRange, ...sessionCenterFilter, patient: { ...patientBaseWhere } }, _count: { _all: true } }),
    prisma.device.groupBy({ by: ["status"], where: { patient: { ...patientBaseWhere } }, _count: { _all: true } }),
    canPharmacy ? prisma.prescription.groupBy({ by: ["status"], where: { prescribedAt: dateRange, patient: { ...patientBaseWhere } }, _count: { _all: true } }) : Promise.resolve([]),
    canPharmacy ? prisma.medication.findMany({ where: { quantity: { lte: prisma.medication.fields.minQuantity } }, select: { name: true, quantity: true, minQuantity: true }, orderBy: { quantity: "asc" }, take: 10 }) : Promise.resolve([]),
    canPharmacy ? prisma.stockMovement.aggregate({ _sum: { quantity: true }, where: { type: "DISPENSE", createdAt: dateRange } }) : Promise.resolve({ _sum: { quantity: 0 } }),
    prisma.admission.count({ where: { status: "ADMITTED", ...admissionCenterFilter, patient: { ...patientBaseWhere } } }),
    prisma.admission.count({ where: { admissionDate: dateRange, ...admissionCenterFilter, patient: { ...patientBaseWhere } } }),
  ]);

  const govName = (id: number | null) => govs.find((g) => g.id === id)?.name ?? "غير محدد";
  const injName = (id: number | null) => injuries.find((i) => i.id === id)?.name ?? "غير محدد";
  const govData = byGov.map((r: any) => ({ label: govName(r.governorateId), value: r._count._all })).sort((a, b) => b.value - a.value).slice(0, 12);
  const injuryData = byInjury.map((r: any) => ({ label: injName(r.injuryTypeId), value: r._count._all })).sort((a, b) => b.value - a.value).slice(0, 12);
  const statusData = byStatus.map((r: any) => ({ label: PATIENT_STATUS[r.status as keyof typeof PATIENT_STATUS] ?? r.status, value: r._count._all }));
  const caseData = byCase.map((r: any) => ({ label: r.caseType ? CASE_TYPE[r.caseType as keyof typeof CASE_TYPE] : "غير محدد", value: r._count._all }));

  const days = rangeDays(from, toExclusive);
  const visitMap = new Map(days.map((d) => [d, 0]));
  for (const v of visits) {
    const key = dayKey(v.visitDate);
    if (visitMap.has(key)) visitMap.set(key, (visitMap.get(key) ?? 0) + 1);
  }
  const visitTrend = Array.from(visitMap.entries()).map(([label, value]) => ({ label: label.slice(5), value }));
  const apptStatusData = apptByStatus.map((r: any) => ({ label: APPT_STATUS[r.status as keyof typeof APPT_STATUS] ?? r.status, value: r._count._all }));
  const therapistData = sessionByTherapist.map((r: any) => ({ label: r.therapist || "غير محدد", value: r._count._all })).sort((a, b) => b.value - a.value);
  const therapyTypeData = sessionByType.map((r: any) => ({ label: THERAPY[r.therapyType as keyof typeof THERAPY] ?? r.therapyType, value: r._count._all }));
  const deviceData = deviceByStatus.map((r: any) => ({ label: DEVICE_STATUS[r.status as keyof typeof DEVICE_STATUS] ?? r.status, value: r._count._all }));
  const rxData = prescriptionsByStatus.map((r: any) => ({ label: RX_STATUS[r.status as keyof typeof RX_STATUS] ?? r.status, value: r._count._all }));
  const lowMedData = lowMeds.map((m: any) => ({ label: m.name, value: m.quantity ?? 0 }));

  const periodLabel = `${fmtDate(from)} - ${fmtDate(new Date(toExclusive.getTime() - dayMs))}`;

  return (
    <div className="space-y-5">
      <PageHeader title="التحليلات والإحصاء" subtitle={`مؤشرات إدارية للفترة ${periodLabel}`} icon="📊" />
      {userBranch?.branch?.name && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800">
          {branchId ? `التحليلات مفلترة افتراضياً حسب فرعك: ${userBranch.branch.name}` : "تعرض تحليلات كل الفروع حالياً"}
        </div>
      )}
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/reports-finance?tab=official" className="btn-ghost">التقرير الإحصائي الرسمي</Link>
        <PrintButton />
      </div>

      <form action="/analytics" className="no-print card grid gap-3 p-4 md:grid-cols-5">
        <div><label className="label">من تاريخ</label><input name="from" type="date" className="input" defaultValue={isoDate(from)} /></div>
        <div><label className="label">إلى تاريخ</label><input name="to" type="date" className="input" defaultValue={isoDate(toDay)} /></div>
        <Combobox name="caseType" label="نوع الحالة" allowFree={false} defaultValue={caseType} placeholder="الكل" options={[{ value: "", label: "الكل" }, ...Object.entries(CASE_TYPE).map(([value, label]: any) => ({ value, label }))]} />
        {branches.length > 0 && <Combobox name="branch" label="الفرع" allowFree={false} defaultValue={sp.branch ?? (branchId ? String(branchId) : "")} placeholder="كل الفروع" options={[{ value: "all", label: "كل الفروع" }, ...branches.map((b: any) => ({ value: String(b.id), label: b.name }))]} />}
        <Combobox name="centerId" label="المركز" allowFree={false} defaultValue={centerId ? String(centerId) : ""} placeholder="كل المراكز" options={[{ value: "", label: "كل المراكز" }, ...centers.map((c: any) => ({ value: String(c.id), label: c.name }))]} />
        <div className="flex items-end gap-2">
          <button className="btn-primary" type="submit">تحديث</button>
          <Link href="/analytics" className="btn-ghost">إعادة</Link>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="إجمالي المراجعين" value={totalPatients} hint={`${activePatients} نشط - ${percent(activePatients, totalPatients)}`} href="/patients-care?tab=patients" />
        <Stat label="مراجعون جدد" value={newPatients} hint="ضمن الفترة المحددة" href="/patients-care?tab=patients" />
        <Stat label="زيارات الفترة" value={visitsCount} hint="حضور واستقبال" href="/patients-care?tab=visits" />
        <Stat label="مواعيد الفترة" value={apptsCount} hint="كل الحالات" href="/patients-care?tab=appointments" />
        <Stat label="جلسات الفترة" value={sessionsCount} hint={centerId ? "حسب المركز المختار" : "كل المراكز"} />
        <Stat label="راقدون حالياً" value={admittedNow} hint={`${admissionsInRange} رقود جديد بالفترة`} href="/therapy-centers?tab=beds" />
        <Stat label="أجهزة تحتاج صيانة" value={devicesDue} href="/devices?due=1" />
        {canPharmacy && <Stat label="صرف الصيدلية" value={stockDispense._sum.quantity ?? 0} hint="كمية مصروفة بالفترة" href="/pharmacy-inventory?tab=dispense" />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="المراجعون حسب المحافظة" subtitle="أعلى 12 محافظة للمراجعين النشطين وغير المؤرشفين">
          <HBars data={govData} />
        </ChartCard>
        <ChartCard title="المراجعون حسب نوع الإصابة" subtitle="أعلى 12 نوع إصابة">
          <HBars data={injuryData} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="المراجعون حسب الحالة">
          <Donut data={statusData} />
        </ChartCard>
        <ChartCard title="نوع الحالة">
          <Donut data={caseData} />
        </ChartCard>
        <ChartCard title="الأجهزة حسب الحالة">
          <Donut data={deviceData} />
        </ChartCard>
      </div>

      <ChartCard title="زيارات حسب الأيام" subtitle="آخر 45 يوماً كحد أقصى ضمن الفترة المحددة">
        <TrendChart points={visitTrend} height={170} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="المواعيد حسب الحالة">
          <BarChart data={apptStatusData} height={180} />
        </ChartCard>
        <ChartCard title="الجلسات حسب المعالج" subtitle="أعلى 12 معالجاً ضمن الفترة">
          <HBars data={therapistData} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="الجلسات حسب المسار العلاجي">
          <HBars data={therapyTypeData} />
        </ChartCard>
        {canPharmacy ? (
          <ChartCard title="الصيدلية والمخزون" subtitle="يظهر فقط لمن يملك pharmacy.view">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-gray-600">الوصفات حسب الحالة</div>
                <Donut data={rxData} size={128} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-gray-600">مواد منخفضة/نافدة</div>
                <HBars data={lowMedData} />
              </div>
            </div>
          </ChartCard>
        ) : (
          <ChartCard title="الصيدلية والمخزون">
            <p className="text-sm text-gray-400">بيانات الصيدلية مخفية لعدم توفر صلاحية pharmacy.view.</p>
          </ChartCard>
        )}
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-6 text-sky-800">
        تستخدم هذه الصفحة تجميعات محدودة ونتائج مختصرة حتى تبقى خفيفة. فلاتر المركز تطبق على الجلسات والرقود، أما توزيع المراجعين فيعتمد على بيانات ملف المراجع.
      </div>
    </div>
  );
}
