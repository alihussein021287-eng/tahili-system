import { currentPerms, requirePerm } from "@/lib/access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import {
  APPT_STATUS,
  DEVICE_STATUS,
  DOC_DIRECTION,
  DOC_TYPE,
  fmtDate,
  fmtDateTime,
  fmtTime,
  PATIENT_STATUS,
  RX_STATUS,
} from "@/lib/labels";
import { receptionCheckIn } from "../visits/actions";

export const dynamic = "force-dynamic";

type Tab = "all" | "patients" | "docs" | "appointments" | "tasks" | "devices" | "pharmacy";
type Params = {
  tab?: Tab;
  q?: string;
  from?: string;
  to?: string;
  branch?: string;
  status?: string;
  saved?: string;
};

const TABS: { key: Tab; label: string; perm?: string }[] = [
  { key: "all", label: "الكل" },
  { key: "patients", label: "المرضى", perm: "patients.view" },
  { key: "docs", label: "الوثائق", perm: "officialdocs.view" },
  { key: "appointments", label: "المواعيد", perm: "appointments.view" },
  { key: "tasks", label: "المهام", perm: "tasks.view" },
  { key: "devices", label: "الأجهزة", perm: "devices.view" },
  { key: "pharmacy", label: "الصيدلية", perm: "pharmacy.view" },
];

const STATUS_OPTIONS = [
  { value: "", label: "كل الحالات" },
  { value: "ACTIVE", label: "مريض نشط" },
  { value: "COMPLETED", label: "مكتمل/منجز" },
  { value: "INACTIVE", label: "مريض غير نشط" },
  { value: "SCHEDULED", label: "موعد مجدول" },
  { value: "CANCELLED", label: "ملغى" },
  { value: "NOSHOW", label: "لم يحضر" },
  { value: "OPEN", label: "مهمة مفتوحة" },
  { value: "IN_PROGRESS", label: "مهمة قيد التنفيذ" },
  { value: "DELIVERED", label: "جهاز مسلّم" },
  { value: "DUE", label: "جهاز يحتاج صيانة" },
  { value: "MAINTAINED", label: "تمت الصيانة" },
  { value: "REPLACED", label: "جهاز مستبدل" },
  { value: "PENDING", label: "وصفة معلقة" },
  { value: "DISPENSED", label: "وصفة مصروفة" },
  { value: "PARTIAL", label: "وصفة جزئية" },
  { value: "REJECTED", label: "وصفة مرفوضة" },
  { value: "INCOMING", label: "وثيقة وارد" },
  { value: "OUTGOING", label: "وثيقة صادر" },
];

const allowed = (perms: Set<string>, perm?: string) => !perm || perms.has(perm);
const selectedTab = (value?: string): Tab => TABS.some((t) => t.key === value) ? value as Tab : "all";
const wants = (active: Tab, key: Tab) => active === "all" || active === key;
const text = (value?: string) => (value ?? "").trim();
const dateOnly = (value?: string) => value ? new Date(value) : null;
const plusDay = (d: Date) => new Date(d.getTime() + 86400000);
const limitFor = (active: Tab, key: Tab) => active === key ? 60 : 12;

function dateRange(field: string, from?: Date | null, to?: Date | null) {
  if (!from && !to) return null;
  return { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lt: plusDay(to) } : {}) } };
}

function patientBranch(branchId?: number) {
  return branchId ? { patient: { branchId } } : null;
}

function queryString(base: Params, patch: Record<string, string>) {
  const params = new URLSearchParams();
  Object.entries({ ...base, ...patch }).forEach(([k, v]) => {
    if (v) params.set(k, String(v));
  });
  return `/search${params.toString() ? `?${params.toString()}` : ""}`;
}

function Section({ title, n, href, children }: { title: string; n: number; href: string; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-3">
        <div className="font-semibold text-gray-700">{title} <span className="text-gray-400">({n})</span></div>
        <Link href={href} className="text-xs font-medium text-brand-700 hover:underline">عرض هذا القسم</Link>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge bg-gray-100 text-gray-700">{children}</span>;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePerm("patients.view");
  const perms = await currentPerms();
  const sp = await searchParams;
  const tab = selectedTab(sp.tab);
  const q = text(sp.q);
  const from = dateOnly(sp.from);
  const to = dateOnly(sp.to);
  const status = text(sp.status);
  const branchId = sp.branch ? Number(sp.branch) : undefined;
  const hasBranch = Boolean(branchId && !Number.isNaN(branchId));
  const hasFilters = Boolean(q || from || to || status || hasBranch);
  const asNum = Number(q);
  const isNum = q !== "" && !Number.isNaN(asNum);
  const canVisit = perms.has("visits.manage");
  const canQueue = perms.has("queue.manage");
  const availableTabs = TABS.filter((t) => allowed(perms, t.perm));
  const cleanSp: Params = { q, from: sp.from, to: sp.to, branch: sp.branch, status, tab };

  const [branches, patients, officialDocs, appointments, tasks, devices, prescriptions] = await Promise.all([
    prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } }),
    hasFilters && wants(tab, "patients") && perms.has("patients.view")
      ? prisma.patient.findMany({
          where: {
            AND: [
              q ? { OR: [
                { fullName: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
                { motherName: { contains: q, mode: "insensitive" } },
                { referralBookNo: { contains: q, mode: "insensitive" } },
                ...(isNum ? [{ fileNumber: asNum }] : []),
              ] } : {},
              hasBranch ? { branchId } : {},
              status && ["ACTIVE", "COMPLETED", "INACTIVE"].includes(status) ? { status: status as any } : {},
              dateRange("registrationDate", from, to) ?? {},
            ],
          },
          include: {
            branch: { select: { name: true } },
            governorate: { select: { name: true } },
            injuryType: { select: { name: true } },
            visits: { orderBy: { visitDate: "desc" }, take: 1 },
            appointments: { orderBy: { scheduledAt: "desc" }, take: 1 },
          },
          orderBy: { updatedAt: "desc" },
          take: limitFor(tab, "patients"),
        })
      : Promise.resolve([]),
    hasFilters && wants(tab, "docs") && perms.has("officialdocs.view")
      ? prisma.officialDocument.findMany({
          where: {
            AND: [
              q ? { OR: [
                { number: { contains: q, mode: "insensitive" } },
                { subject: { contains: q, mode: "insensitive" } },
                { entity: { contains: q, mode: "insensitive" } },
                { body: { contains: q, mode: "insensitive" } },
                { patient: { fullName: { contains: q, mode: "insensitive" } } },
                ...(isNum ? [{ patient: { fileNumber: asNum } }] : []),
              ] } : {},
              hasBranch ? { patient: { branchId } } : {},
              status && ["INCOMING", "OUTGOING"].includes(status) ? { direction: status as any } : {},
              dateRange("docDate", from, to) ?? {},
            ],
          },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true, branch: { select: { name: true } } } } },
          orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
          take: limitFor(tab, "docs"),
        })
      : Promise.resolve([]),
    hasFilters && wants(tab, "appointments") && perms.has("appointments.view")
      ? prisma.appointment.findMany({
          where: {
            AND: [
              q ? { OR: [
                { type: { contains: q, mode: "insensitive" } },
                { assignedTo: { contains: q, mode: "insensitive" } },
                { notes: { contains: q, mode: "insensitive" } },
                { patient: { fullName: { contains: q, mode: "insensitive" } } },
                ...(isNum ? [{ patient: { fileNumber: asNum } }] : []),
              ] } : {},
              patientBranch(hasBranch ? branchId : undefined) ?? {},
              status && ["SCHEDULED", "COMPLETED", "CANCELLED", "NOSHOW"].includes(status) ? { status: status as any } : {},
              dateRange("scheduledAt", from, to) ?? {},
            ],
          },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true, branch: { select: { name: true } } } } },
          orderBy: { scheduledAt: "desc" },
          take: limitFor(tab, "appointments"),
        })
      : Promise.resolve([]),
    hasFilters && wants(tab, "tasks") && perms.has("tasks.view")
      ? prisma.task.findMany({
          where: {
            AND: [
              q ? { OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { patient: { fullName: { contains: q, mode: "insensitive" } } },
                { assignedTo: { fullName: { contains: q, mode: "insensitive" } } },
                ...(isNum ? [{ patient: { fileNumber: asNum } }] : []),
              ] } : {},
              patientBranch(hasBranch ? branchId : undefined) ?? {},
              status && ["OPEN", "IN_PROGRESS", "COMPLETED"].includes(status) ? { status: status as any } : {},
              from || to ? { OR: [dateRange("createdAt", from, to), dateRange("dueDate", from, to)].filter(Boolean) } : {},
            ],
          },
          include: {
            patient: { select: { id: true, fullName: true, fileNumber: true, branch: { select: { name: true } } } },
            assignedTo: { select: { fullName: true } },
          },
          orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
          take: limitFor(tab, "tasks"),
        })
      : Promise.resolve([]),
    hasFilters && wants(tab, "devices") && perms.has("devices.view")
      ? prisma.device.findMany({
          where: {
            AND: [
              q ? { OR: [
                { type: { contains: q, mode: "insensitive" } },
                { serialNo: { contains: q, mode: "insensitive" } },
                { notes: { contains: q, mode: "insensitive" } },
                { patient: { fullName: { contains: q, mode: "insensitive" } } },
                ...(isNum ? [{ patient: { fileNumber: asNum } }] : []),
              ] } : {},
              patientBranch(hasBranch ? branchId : undefined) ?? {},
              status && ["DELIVERED", "DUE", "MAINTAINED", "REPLACED"].includes(status) ? { status: status as any } : {},
              from || to ? { OR: [dateRange("deliveredAt", from, to), dateRange("nextMaintenanceAt", from, to)].filter(Boolean) } : {},
            ],
          },
          include: { patient: { select: { id: true, fullName: true, fileNumber: true, branch: { select: { name: true } } } } },
          orderBy: [{ nextMaintenanceAt: "asc" }, { deliveredAt: "desc" }],
          take: limitFor(tab, "devices"),
        })
      : Promise.resolve([]),
    hasFilters && wants(tab, "pharmacy") && perms.has("pharmacy.view")
      ? prisma.prescription.findMany({
          where: {
            AND: [
              q ? { OR: [
                { doctor: { contains: q, mode: "insensitive" } },
                { materialName: { contains: q, mode: "insensitive" } },
                { usage: { contains: q, mode: "insensitive" } },
                { medication: { name: { contains: q, mode: "insensitive" } } },
                { patient: { fullName: { contains: q, mode: "insensitive" } } },
                ...(isNum ? [{ patient: { fileNumber: asNum } }] : []),
              ] } : {},
              patientBranch(hasBranch ? branchId : undefined) ?? {},
              status && ["PENDING", "DISPENSED", "PARTIAL", "REJECTED"].includes(status) ? { status: status as any } : {},
              from || to ? { OR: [dateRange("prescribedAt", from, to), dateRange("dispensedAt", from, to)].filter(Boolean) } : {},
            ],
          },
          include: {
            patient: { select: { id: true, fullName: true, fileNumber: true, branch: { select: { name: true } } } },
            medication: { select: { name: true } },
          },
          orderBy: { prescribedAt: "desc" },
          take: limitFor(tab, "pharmacy"),
        })
      : Promise.resolve([]),
  ]);

  const counts: Record<Tab, number> = {
    all: patients.length + officialDocs.length + appointments.length + tasks.length + devices.length + prescriptions.length,
    patients: patients.length,
    docs: officialDocs.length,
    appointments: appointments.length,
    tasks: tasks.length,
    devices: devices.length,
    pharmacy: prescriptions.length,
  };
  const empty = hasFilters && counts.all === 0;
  const returnQuery = new URLSearchParams();
  Object.entries(sp).forEach(([key, value]) => {
    if (value && key !== "saved") returnQuery.set(key, String(value));
  });
  const returnTo = `/search${returnQuery.toString() ? `?${returnQuery.toString()}` : ""}`;

  return (
    <div className="space-y-5">
      <PageHeader title="البحث الموحد" subtitle="نتائج منظمة من المراجعين، الوثائق، المواعيد، المهام، الأجهزة، والصيدلية حسب الصلاحيات" icon="🔍" />
      {sp.saved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{sp.saved}</div>}

      <form action="/search" className="card grid gap-3 p-4 lg:grid-cols-6">
        <input type="hidden" name="tab" value={tab} />
        <div className="lg:col-span-2">
          <label className="label">النص</label>
          <input name="q" className="input" defaultValue={q} placeholder="اسم، رقم ملف، رقم كتاب، موعد، مهمة، جهاز، وصفة..." autoFocus />
        </div>
        <div>
          <label className="label">من تاريخ</label>
          <input name="from" type="date" className="input" defaultValue={sp.from ?? ""} />
        </div>
        <div>
          <label className="label">إلى تاريخ</label>
          <input name="to" type="date" className="input" defaultValue={sp.to ?? ""} />
        </div>
        <div>
          <label className="label">الفرع</label>
          <select name="branch" className="input" defaultValue={sp.branch ?? ""}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isActive ? "" : " - معطل"}</option>)}
          </select>
        </div>
        <div>
          <label className="label">الحالة</label>
          <select name="status" className="input" defaultValue={status}>
            {STATUS_OPTIONS.map((s) => <option key={s.value || "all"} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2 lg:col-span-6">
          <button className="btn-primary" type="submit">بحث</button>
          <Link href="/search" className="btn-ghost">مسح</Link>
          <span className="text-xs text-gray-400">الحد الافتراضي 12 نتيجة لكل قسم، و60 عند فتح تبويب محدد.</span>
        </div>
      </form>

      <nav className="card flex flex-wrap gap-2 p-3">
        {availableTabs.map((t) => (
          <Link
            key={t.key}
            href={queryString(cleanSp, { tab: t.key === "all" ? "" : t.key })}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === t.key ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {t.label} <span className={tab === t.key ? "text-white/80" : "text-gray-400"}>{counts[t.key]}</span>
          </Link>
        ))}
      </nav>

      {!hasFilters && <p className="text-sm text-gray-400">اكتب نصاً أو اختر تاريخاً/فرعاً/حالة لبدء البحث الموحد.</p>}
      {empty && <p className="text-sm text-gray-400">لا توجد نتائج مطابقة ضمن الصلاحيات والفلاتر الحالية.</p>}

      {patients.length > 0 && (
        <Section title="المرضى" n={patients.length} href={queryString(cleanSp, { tab: "patients" })}>
          <table className="w-full text-sm">
            <thead><tr><th className="th">رقم الملف</th><th className="th">الاسم</th><th className="th">الحالة</th><th className="th">الفرع</th><th className="th">آخر زيارة/موعد</th><th className="th">إجراء</th></tr></thead>
            <tbody>
              {patients.map((p: any) => (
                <tr key={p.id} className={`hover:bg-gray-50 ${p.archivedAt ? "bg-red-50/40" : ""}`}>
                  <td className="td font-medium">#{p.fileNumber}</td>
                  <td className="td">
                    <Link href={`/patients/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.fullName}</Link>
                    <div className="text-xs text-gray-400">{p.phone ?? "بدون هاتف"} · {p.governorate?.name ?? "—"} · {p.injuryType?.name ?? "—"}</div>
                  </td>
                  <td className="td"><Badge>{PATIENT_STATUS[p.status as keyof typeof PATIENT_STATUS] ?? p.status}</Badge></td>
                  <td className="td">{p.branch?.name ?? "—"}</td>
                  <td className="td">
                    <div>زيارة: {p.visits?.[0] ? fmtDateTime(p.visits[0].visitDate) : "—"}</div>
                    <div className="text-xs text-gray-400">موعد: {p.appointments?.[0] ? fmtDateTime(p.appointments[0].scheduledAt) : "—"}</div>
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-2">
                      {canVisit && !p.archivedAt && (
                        <form action={receptionCheckIn} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="patientId" value={p.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          {canQueue && <input type="hidden" name="sendQueue" value="1" />}
                          {canQueue && <input type="hidden" name="hall" value="" />}
                          <button className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700" type="submit">{canQueue ? "زيارة + طابور" : "تسجيل زيارة"}</button>
                        </form>
                      )}
                      <Link href={`/patients/${p.id}`} className="text-xs font-medium text-brand-700 hover:underline">فتح الملف</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {officialDocs.length > 0 && (
        <Section title="الوثائق الرسمية" n={officialDocs.length} href={queryString(cleanSp, { tab: "docs" })}>
          <table className="w-full text-sm">
            <thead><tr><th className="th">رقم الكتاب</th><th className="th">التاريخ</th><th className="th">النوع</th><th className="th">الموضوع</th><th className="th">الجهة/المراجع</th><th className="th">رابط</th></tr></thead>
            <tbody>
              {officialDocs.map((d: any) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="td font-medium">{d.number}</td>
                  <td className="td">{fmtDate(d.docDate)}</td>
                  <td className="td"><Badge>{DOC_TYPE[d.docType as keyof typeof DOC_TYPE]}</Badge> <Badge>{DOC_DIRECTION[d.direction as keyof typeof DOC_DIRECTION]}</Badge></td>
                  <td className="td">{d.subject}</td>
                  <td className="td">
                    <div>{d.entity || "—"}</div>
                    {d.patient ? <Link href={`/patients/${d.patient.id}`} className="text-xs text-brand-700 hover:underline">{d.patient.fullName} #{d.patient.fileNumber}</Link> : <span className="text-xs text-gray-400">وثيقة عامة</span>}
                  </td>
                  <td className="td"><Link href={`/official-docs/${d.id}`} className="text-brand-700 hover:underline">عرض/طباعة</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {appointments.length > 0 && (
        <Section title="المواعيد" n={appointments.length} href={queryString(cleanSp, { tab: "appointments" })}>
          <table className="w-full text-sm">
            <thead><tr><th className="th">التاريخ</th><th className="th">الوقت</th><th className="th">المراجع</th><th className="th">النوع/المسؤول</th><th className="th">الحالة</th></tr></thead>
            <tbody>
              {appointments.map((a: any) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="td">{fmtDate(a.scheduledAt)}</td>
                  <td className="td">{fmtTime(a.scheduledAt)}</td>
                  <td className="td"><Link href={`/patients/${a.patientId}`} className="text-brand-700 hover:underline">{a.patient.fullName} #{a.patient.fileNumber}</Link></td>
                  <td className="td">{a.type || "—"}<div className="text-xs text-gray-400">{a.assignedTo || "غير مسند"} · {a.patient.branch?.name ?? "—"}</div></td>
                  <td className="td"><Badge>{APPT_STATUS[a.status as keyof typeof APPT_STATUS] ?? a.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {tasks.length > 0 && (
        <Section title="المهام" n={tasks.length} href={queryString(cleanSp, { tab: "tasks" })}>
          <table className="w-full text-sm">
            <thead><tr><th className="th">العنوان</th><th className="th">الحالة</th><th className="th">الاستحقاق</th><th className="th">المسند إليه</th><th className="th">المراجع</th></tr></thead>
            <tbody>
              {tasks.map((t: any) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="td"><Link href="/staff?tab=tasks" className="font-medium text-brand-700 hover:underline">{t.title}</Link><div className="text-xs text-gray-400">{t.description || "—"}</div></td>
                  <td className="td"><Badge>{t.status}</Badge></td>
                  <td className="td">{t.dueDate ? fmtDate(t.dueDate) : "—"}</td>
                  <td className="td">{t.assignedTo?.fullName ?? t.assignedRole ?? "—"}</td>
                  <td className="td">{t.patient ? <Link href={`/patients/${t.patientId}`} className="text-brand-700 hover:underline">{t.patient.fullName} #{t.patient.fileNumber}</Link> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {devices.length > 0 && (
        <Section title="الأجهزة" n={devices.length} href={queryString(cleanSp, { tab: "devices" })}>
          <table className="w-full text-sm">
            <thead><tr><th className="th">الجهاز</th><th className="th">المراجع</th><th className="th">التسليم</th><th className="th">الصيانة القادمة</th><th className="th">الحالة</th></tr></thead>
            <tbody>
              {devices.map((d: any) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="td"><Link href="/devices" className="font-medium text-brand-700 hover:underline">{d.type}</Link><div className="text-xs text-gray-400">{d.serialNo || "بدون رقم"} · {d.notes || "—"}</div></td>
                  <td className="td"><Link href={`/patients/${d.patientId}`} className="text-brand-700 hover:underline">{d.patient.fullName} #{d.patient.fileNumber}</Link></td>
                  <td className="td">{fmtDate(d.deliveredAt)}</td>
                  <td className="td">{d.nextMaintenanceAt ? fmtDate(d.nextMaintenanceAt) : "—"}</td>
                  <td className="td"><Badge>{DEVICE_STATUS[d.status as keyof typeof DEVICE_STATUS] ?? d.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {prescriptions.length > 0 && (
        <Section title="الصيدلية" n={prescriptions.length} href={queryString(cleanSp, { tab: "pharmacy" })}>
          <table className="w-full text-sm">
            <thead><tr><th className="th">التاريخ</th><th className="th">المراجع</th><th className="th">العلاج</th><th className="th">الطبيب</th><th className="th">الحالة</th><th className="th">رابط</th></tr></thead>
            <tbody>
              {prescriptions.map((rx: any) => (
                <tr key={rx.id} className="hover:bg-gray-50">
                  <td className="td">{fmtDate(rx.prescribedAt)}</td>
                  <td className="td"><Link href={`/patients/${rx.patientId}`} className="text-brand-700 hover:underline">{rx.patient.fullName} #{rx.patient.fileNumber}</Link></td>
                  <td className="td">{rx.medication?.name ?? rx.materialName ?? "—"}<div className="text-xs text-gray-400">{rx.usage || "—"}</div></td>
                  <td className="td">{rx.doctor || "—"}</td>
                  <td className="td"><Badge>{RX_STATUS[rx.status as keyof typeof RX_STATUS] ?? rx.status}</Badge></td>
                  <td className="td"><Link href={`/pharmacy/rx/${rx.id}`} className="text-brand-700 hover:underline">عرض الوصفة</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
