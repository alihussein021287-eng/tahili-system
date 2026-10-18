import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import Link from "next/link";
import type { ReactNode } from "react";
import { CASE_TYPE, fmtDate, PATIENT_STATUS } from "@/lib/labels";
import { currentPerms, requirePerm } from "@/lib/access";
import { getGovernorates, getInjuryTypes, getEmployees } from "@/lib/lookups";
import { PageHeader } from "@/components/PageHeader";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";
import { patientScopeWhere } from "@/lib/patient-access";
import { getSession } from "@/lib/access";
import { HandoffDialog } from "@/components/handoffs/HandoffDialog";
import { HubTabs } from "@/components/hub/HubTabs";
import { FilterBar } from "@/components/hub/FilterBar";
import { ToolsMenu } from "@/components/hub/ToolsMenu";
import { PATIENTS_CARE_NAV } from "@/lib/hub-nav";
import { baghdadDayRange } from "@/lib/display-utils";
import { handoffParty } from "@/lib/patient-handoff-presentation";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;
const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "IN_SESSION"] as const;
const PENDING_REFERRAL_STATUSES = ["DRAFT", "PENDING_PRINT", "READY", "SENT", "RESULT_RECEIVED"] as const;

type SP = {
  q?: string; name?: string; file?: string; phone?: string; gov?: string; district?: string; status?: string; injury?: string;
  caseType?: string; dataEntry?: string; archived?: string; page?: string; branch?: string; lastVisitFrom?: string; lastVisitTo?: string;
};

function dayStart(value?: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function badge(children: ReactNode, tone = "bg-gray-100 text-gray-600") {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{children}</span>;
}

/** The one patient list: search, filters, export, archive, and handoff all live here. */
export default async function PatientsList({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requirePerm("patients.view");
  const perms = await currentPerms();
  const userBranch = await currentUserBranch();
  const activeBranchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const page = Math.max(1, Number(sp.page) || 1);
  const canSendHandoff = perms.has("handoff.send");

  const where: any = {};
  // One search box for name, phone or file number. The older separate fields still work in links.
  const query = (sp.q ?? sp.name ?? "").trim();
  if (query) {
    const asNumber = Number(query);
    where.OR = [
      { fullName: { contains: query, mode: "insensitive" } },
      { phone: { contains: query } },
      ...(Number.isInteger(asNumber) && asNumber > 0 && asNumber <= 2147483647 ? [{ fileNumber: asNumber }] : []),
    ];
  }
  const fileNo = Number(sp.file);
  if (sp.file && !Number.isNaN(fileNo)) where.fileNumber = fileNo;
  if (sp.phone?.trim()) where.phone = { contains: sp.phone.trim() };
  if (sp.gov) where.governorateId = Number(sp.gov);
  if (sp.district) where.districtId = Number(sp.district);
  if (sp.status && sp.status in PATIENT_STATUS) where.status = sp.status;
  if (sp.injury) where.injuryTypeId = Number(sp.injury);
  if (sp.caseType && sp.caseType in CASE_TYPE) where.caseType = sp.caseType;
  if (activeBranchId) where.branchId = activeBranchId;
  if (sp.dataEntry) where.dataEntryBy = { contains: sp.dataEntry };
  const lastVisitFrom = dayStart(sp.lastVisitFrom);
  const lastVisitTo = dayStart(sp.lastVisitTo);
  if (lastVisitFrom || lastVisitTo) {
    where.visits = { some: { visitDate: {
      ...(lastVisitFrom ? { gte: lastVisitFrom } : {}),
      ...(lastVisitTo ? { lt: new Date(lastVisitTo.getTime() + 86_400_000) } : {}),
    } } };
  }
  where.archivedAt = sp.archived ? { not: null } : null;
  // The record list is limited to patients the viewer is authorized for; a requested branch only narrows it.
  const viewerSession = await getSession();
  const scope = await patientScopeWhere(prisma, { userId: (viewerSession?.user as any)?.id ?? "", role: (viewerSession?.user as any)?.role, permissions: perms });
  where.AND = [scope];
  const countScope: any = { ...(activeBranchId ? { branchId: activeBranchId } : {}), AND: [scope] };

  const { start: todayStart, end: todayEnd } = baghdadDayRange(new Date());
  const [patients, total, governorates, districts, injuryTypes, employees, branches, activeTotal, archivedTotal] = await Promise.all([
    prisma.patient.findMany({
      where,
      include: {
        governorate: true, district: true, branch: true, injuryType: true,
        visits: { orderBy: { visitDate: "desc" }, take: 1, select: { visitDate: true } },
        queueEntries: { where: { createdAt: { gte: todayStart, lt: todayEnd }, status: { in: [...ACTIVE_QUEUE_STATUSES] } }, take: 1, select: { id: true } },
        referralRequests: { where: { status: { in: [...PENDING_REFERRAL_STATUSES] } }, take: 1, select: { id: true } },
        // "Where is the patient now" comes from the open handoff, the same source as the patient file.
        ...(perms.has("journey.view") ? { handoffs: { where: { status: { in: ["SENT", "ACCEPTED"] as any } }, orderBy: { sentAt: "desc" as const }, take: 1, select: { toRole: true, status: true, toUser: { select: { fullName: true } }, acceptedBy: { select: { fullName: true } }, toCenter: { select: { name: true } } } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
    }),
    prisma.patient.count({ where }),
    getGovernorates(),
    prisma.district.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, governorateId: true } }),
    getInjuryTypes(),
    getEmployees(),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.patient.count({ where: { ...countScope, archivedAt: null } }),
    prisma.patient.count({ where: { ...countScope, archivedAt: { not: null } } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const kept = (["q", "name", "file", "phone", "gov", "district", "status", "injury", "caseType", "dataEntry", "archived", "lastVisitFrom", "lastVisitTo"] as const)
    .filter((key) => sp[key]).map((key) => [key, sp[key]!] as [string, string]);
  const qs = (extra: Record<string, any>) => {
    const u = new URLSearchParams(kept);
    if (sp.branch) u.set("branch", sp.branch); else if (activeBranchId) u.set("branch", String(activeBranchId));
    Object.entries(extra).forEach(([k, v]) => v ? u.set(k, String(v)) : u.delete(k));
    return `/patients?${u.toString()}`;
  };
  const exportQuery = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  // Filters other than the search box; the user's own default branch is not counted as a choice.
  const activeCount = [sp.gov, sp.district, sp.status, sp.injury, sp.caseType, sp.dataEntry, sp.lastVisitFrom, sp.lastVisitTo, sp.branch].filter(Boolean).length;
  const districtOptions = sp.gov ? districts.filter((d) => d.governorateId === Number(sp.gov)) : districts;
  const columns = canSendHandoff ? 8 : 7;
  const isArchivedView = Boolean(sp.archived);

  return (
    <div className="space-y-4">
      <PageHeader title={isArchivedView ? "المراجعون المؤرشفون" : "المراجعون"} subtitle={`${total} مراجع${isArchivedView ? " مؤرشف" : " مسجّل"} · ${isArchivedView ? `${activeTotal} نشط` : `${archivedTotal} مؤرشف`}`} icon="👥">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={isArchivedView ? "/patients" : "/patients?archived=1"} className="btn-ghost">
            {isArchivedView ? "← المراجعون النشطون" : "🗄 أرشيف المراجعين"}
          </Link>
          <ToolsMenu>
            <Link href="/patients/data-quality">☑ جودة البيانات</Link>
            {perms.has("patients.import") ? <Link href="/patients/import">⤒ استيراد</Link> : null}
            {perms.has("patients.export") ? <a href={`/api/export/patients?${exportQuery}`}>⤓ تصدير القائمة الحالية (Excel)</a> : null}
            {perms.has("patients.export") ? <a href="/api/export/full">⬇ تصدير شامل (Excel)</a> : null}
            {perms.has("datacenter.view") && (perms.has("datacenter.import.patients") || perms.has("datacenter.export.patients")) ? <Link href="/data-center?tab=import">🗄 مركز استيراد وتصدير البيانات</Link> : null}
          </ToolsMenu>
          {perms.has("patients.create") ? <Link href="/patients/new" className="btn-primary">+ مراجع جديد</Link> : null}
        </div>
      </PageHeader>
      <HubTabs nav={PATIENTS_CARE_NAV} active="patients" label="تبويبات المرضى والرعاية" perms={perms} />

      {isArchivedView ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          هذا عرض أرشيف المراجعين. الملفات محفوظة بكل تفاصيلها، ولا تظهر في قوائم العمل اليومية حتى يتم استرجاعها.
        </div>
      ) : null}

      {userBranch?.branch?.name && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800">
          {activeBranchId ? `النتائج مفلترة افتراضياً حسب فرعك: ${userBranch.branch.name}` : "تعرض كل الفروع حالياً"}
        </div>
      )}

      <FilterBar action="/patients" query={sp.q ?? sp.name} placeholder="ابحث بالاسم أو رقم الملف أو الهاتف…" activeCount={activeCount}
        clearHref={sp.archived ? "/patients?archived=1" : "/patients"} hidden={sp.archived ? <input type="hidden" name="archived" value="1" /> : null}>
        <Combobox name="gov" label="المحافظة" allowFree={false} defaultValue={sp.gov ?? ""} placeholder="الكل"
          options={[{ value: "", label: "الكل" }, ...governorates.map((g: any) => ({ value: String(g.id), label: g.name }))]} />
        <Combobox name="district" label="المنطقة" allowFree={false} defaultValue={sp.district ?? ""} placeholder="الكل"
          options={[{ value: "", label: "الكل" }, ...districtOptions.map((d) => ({ value: String(d.id), label: d.name }))]} />
        {branches.length > 0 ? (
          <Combobox name="branch" label="الفرع" allowFree={false} defaultValue={sp.branch ?? (activeBranchId ? String(activeBranchId) : "")} placeholder="الكل"
            options={[{ value: "all", label: "كل الفروع" }, ...branches.map((b: any) => ({ value: String(b.id), label: b.name }))]} />
        ) : null}
        <Combobox name="injury" label="نوع الإصابة" allowFree={false} defaultValue={sp.injury ?? ""} placeholder="الكل"
          options={[{ value: "", label: "الكل" }, ...injuryTypes.map((i: any) => ({ value: String(i.id), label: i.name }))]} />
        <Combobox name="status" label="الحالة" allowFree={false} defaultValue={sp.status ?? ""} placeholder="الكل"
          options={[{ value: "", label: "الكل" }, ...Object.entries(PATIENT_STATUS).map(([value, label]: any) => ({ value, label }))]} />
        <Combobox name="caseType" label="نوع الحالة" allowFree={false} defaultValue={sp.caseType ?? ""} placeholder="الكل"
          options={[{ value: "", label: "الكل" }, ...Object.entries(CASE_TYPE).map(([value, label]: any) => ({ value, label }))]} />
        <Combobox name="dataEntry" label="مدخل البيانات" defaultValue={sp.dataEntry ?? ""} placeholder="الكل"
          options={employees.map((e: any) => e.name)} />
        <label className="label">آخر زيارة من<input name="lastVisitFrom" type="date" className="input mt-1" defaultValue={sp.lastVisitFrom ?? ""} /></label>
        <label className="label">آخر زيارة إلى<input name="lastVisitTo" type="date" className="input mt-1" defaultValue={sp.lastVisitTo ?? ""} /></label>
      </FilterBar>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="th">رقم الملف</th><th className="th">المراجع</th><th className="th">الفرع</th><th className="th">المحافظة/المنطقة</th>
            <th className="th">نوع الإصابة</th><th className="th">الحالة</th><th className="th">آخر زيارة</th>
            {canSendHandoff && <th className="th">التحويل</th>}
          </tr></thead>
          <tbody>
            {patients.map((p: any) => {
              const missing = [!p.phone ? "هاتف" : null, !p.governorateId ? "محافظة" : null, !p.injuryTypeId ? "إصابة" : null, !p.caseType ? "نوع الحالة" : null, !p.branchId ? "فرع" : null].filter(Boolean);
              const holder = p.handoffs?.[0];
              return (
                <tr key={p.id} className={missing.length ? "bg-amber-50/40" : "hover:bg-gray-50"}>
                  <td className="td">{p.fileNumber}</td>
                  <td className="td">
                    <Link href={`/patients/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.fullName}</Link>
                    <div className="text-xs text-gray-400">{p.phone || "لا يوجد هاتف"}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {isArchivedView && p.archivedAt ? badge(`مؤرشف منذ ${fmtDate(p.archivedAt)}`, "bg-amber-100 text-amber-800") : null}
                      {missing.length ? badge(`ناقص: ${missing.join("، ")}`, "bg-amber-100 text-amber-800") : null}
                      {p.queueEntries?.length ? badge("في الطابور", "bg-sky-50 text-sky-700") : null}
                      {p.referralRequests?.length ? badge("إحالة معلقة", "bg-orange-50 text-orange-700") : null}
                      {holder ? badge(`${holder.status === "SENT" ? "بانتظار" : "عند"}: ${handoffParty(holder.status === "ACCEPTED" ? holder.acceptedBy?.fullName ?? holder.toUser?.fullName : holder.toUser?.fullName, holder.toRole, holder.toCenter?.name)}`, holder.status === "SENT" ? "bg-amber-50 text-amber-800" : "bg-indigo-50 text-indigo-700") : null}
                    </div>
                  </td>
                  <td className="td"><span className="badge-neutral">{p.branch?.name ?? "بدون فرع"}</span></td>
                  <td className="td">{p.governorate?.name ?? "—"}{p.district?.name ? ` / ${p.district.name}` : ""}</td>
                  <td className="td">{p.injuryType?.name ?? "—"}</td>
                  <td className="td"><span className="badge-neutral">{PATIENT_STATUS[p.status as keyof typeof PATIENT_STATUS]}</span></td>
                  <td className="td">{p.visits?.[0] ? fmtDate(p.visits[0].visitDate) : `سُجّل ${fmtDate(p.registrationDate)}`}</td>
                  {canSendHandoff && <td className="td"><HandoffDialog patientId={p.id} patientName={p.fullName} fileNumber={String(p.fileNumber)} /></td>}
                </tr>
              );
            })}
            {patients.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={columns}>{isArchivedView ? "لا يوجد مراجعون مؤرشفون بهذه الفلاتر." : "لا توجد نتائج."}</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {page > 1 && <Link href={qs({ page: page - 1 })} className="btn-ghost">السابق</Link>}
          <span className="text-gray-500">صفحة {page} من {pages}</span>
          {page < pages && <Link href={qs({ page: page + 1 })} className="btn-ghost">التالي</Link>}
        </div>
      )}
    </div>
  );
}
