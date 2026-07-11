import { prisma } from "@/lib/db";
import { Combobox } from "@/components/Combobox";
import Link from "next/link";
import { fmtDate, PATIENT_STATUS } from "@/lib/labels";
import { currentPerms, requirePerm } from "@/lib/access";
import { getGovernorates, getInjuryTypes, getEmployees } from "@/lib/lookups";
import { PageHeader } from "@/components/PageHeader";
import { currentUserBranch, effectiveBranchId } from "@/lib/branch-context";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function PatientsList({
  searchParams,
}: { searchParams: Promise<{ q?: string; name?: string; file?: string; phone?: string; gov?: string; status?: string; injury?: string; dataEntry?: string; archived?: string; page?: string; branch?: string }> }) {
  const sp = await searchParams;
  await requirePerm("patients.view");
  const perms = await currentPerms();
  const userBranch = await currentUserBranch();
  const activeBranchId = effectiveBranchId(sp.branch, userBranch?.branchId);
  const page = Math.max(1, Number(sp.page) || 1);

  const where: any = {};
  const legacyQuery = sp.q?.trim();
  const name = sp.name?.trim();
  const fileNo = Number(sp.file);
  const phone = sp.phone?.trim();
  if (legacyQuery) {
    const qNum = Number(legacyQuery);
    where.OR = [
      { fullName: { contains: legacyQuery, mode: "insensitive" } },
      { phone: { contains: legacyQuery } },
      ...(!Number.isNaN(qNum) ? [{ fileNumber: qNum }] : []),
    ];
  }
  if (name) where.fullName = { contains: name, mode: "insensitive" };
  if (sp.file && !Number.isNaN(fileNo)) where.fileNumber = fileNo;
  if (phone) where.phone = { contains: phone };
  if (sp.gov) where.governorateId = Number(sp.gov);
  if (sp.status) where.status = sp.status;
  if (sp.injury) where.injuryTypeId = Number(sp.injury);
  if (activeBranchId) where.branchId = activeBranchId;
  if (sp.dataEntry) where.dataEntryBy = { contains: sp.dataEntry };
  where.archivedAt = sp.archived ? { not: null } : null;

  const [patients, total, governorates, injuryTypes, employees, branches] = await Promise.all([
    prisma.patient.findMany({
      where, include: { governorate: true, branch: true }, orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
    }),
    prisma.patient.count({ where }),
    getGovernorates(),
    getInjuryTypes(),
    getEmployees(),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (extra: Record<string, any>) => {
    const u = new URLSearchParams();
    if (sp.q) u.set("q", sp.q); if (sp.name) u.set("name", sp.name);
    if (sp.file) u.set("file", sp.file); if (sp.phone) u.set("phone", sp.phone);
    if (sp.gov) u.set("gov", sp.gov);
    if (sp.status) u.set("status", sp.status); if (sp.injury) u.set("injury", sp.injury);
    if (sp.branch) u.set("branch", sp.branch); else if (activeBranchId) u.set("branch", String(activeBranchId));
    if (sp.dataEntry) u.set("dataEntry", sp.dataEntry); if (sp.archived) u.set("archived", sp.archived);
    Object.entries(extra).forEach(([k, v]) => v ? u.set(k, String(v)) : u.delete(k));
    return `/patients?${u.toString()}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader title="المراجعون" subtitle={`${total} مراجع مسجّل`} icon="👥" />
      {userBranch?.branch?.name && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800">
          {activeBranchId ? `النتائج مفلترة افتراضياً حسب فرعك: ${userBranch.branch.name}` : "تعرض كل الفروع حالياً"}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={sp.archived ? "/patients" : "/patients?archived=1"} className="btn-ghost">{sp.archived ? "← المراجعون النشطون" : "🗄 الأرشيف"}</Link>
        <Link href="/patients/data-quality" className="btn-ghost">☑ جودة البيانات</Link>
        {perms.has("patients.import") && <Link href="/patients/import" className="btn-ghost">⤒ استيراد</Link>}
        {perms.has("patients.export") && <a href={`/api/export/patients?${new URLSearchParams(Object.entries(sp).filter(([,v])=>v) as any).toString()}`} className="btn-ghost">⤓ Excel</a>}
        {perms.has("patients.export") && <a href="/api/export/full" className="btn-ghost">⬇ تصدير شامل (Excel)</a>}
        {perms.has("patients.create") && <Link href="/patients/new" className="btn-primary">+ مراجع جديد</Link>}
      </div>

      <form className="card flex flex-wrap items-end gap-2 p-3" action="/patients">
        <div className="min-w-[190px] flex-1">
          <label className="label">الاسم</label>
          <input className="input" name="name" placeholder="اسم المراجع..." defaultValue={sp.name ?? sp.q ?? ""} />
        </div>
        <div className="w-32">
          <label className="label">رقم الملف</label>
          <input className="input" name="file" inputMode="numeric" placeholder="مثال 120" defaultValue={sp.file ?? ""} />
        </div>
        <div className="min-w-[150px]">
          <label className="label">الهاتف</label>
          <input className="input" name="phone" inputMode="numeric" placeholder="07..." defaultValue={sp.phone ?? ""} />
        </div>
        <Combobox name="gov" label="المحافظة" allowFree={false} defaultValue={sp.gov ?? ""} placeholder="الكل"
          options={[{ value: "", label: "الكل" }, ...governorates.map((g: any) => ({ value: String(g.id), label: g.name }))]} />
        <Combobox name="injury" label="نوع الإصابة" allowFree={false} defaultValue={sp.injury ?? ""} placeholder="الكل"
          options={[{ value: "", label: "الكل" }, ...injuryTypes.map((i: any) => ({ value: String(i.id), label: i.name }))]} />
        {branches.length > 0 && (
          <div>
            <Combobox name="branch" label="الفرع" allowFree={false} defaultValue={sp.branch ?? (activeBranchId ? String(activeBranchId) : "")} placeholder="الكل"
              options={[{ value: "all", label: "كل الفروع" }, ...branches.map((b: any) => ({ value: String(b.id), label: b.name }))]} />
          </div>
        )}
        <Combobox name="status" label="الحالة" allowFree={false} defaultValue={sp.status ?? ""} placeholder="الكل"
          options={[{ value: "", label: "الكل" }, ...Object.entries(PATIENT_STATUS).map(([value, label]: any) => ({ value, label }))]} />
        <Combobox name="dataEntry" label="مدخل البيانات" defaultValue={sp.dataEntry ?? ""} placeholder="الكل"
          options={employees.map((e: any) => e.name)} />
        {sp.archived && <input type="hidden" name="archived" value="1" />}
        <button className="btn-primary" type="submit">تطبيق</button>
        <Link href="/patients" className="btn-ghost">مسح</Link>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr>
            <th className="th">رقم الملف</th><th className="th">الاسم الرباعي</th><th className="th">الفرع</th><th className="th">المحافظة</th>
            <th className="th">الهاتف</th><th className="th">نسبة العجز</th><th className="th">الحالة</th><th className="th">التسجيل</th>
          </tr></thead>
          <tbody>
            {patients.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="td">{p.fileNumber}</td>
                <td className="td"><Link href={`/patients/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.fullName}</Link></td>
                <td className="td"><span className="badge-neutral">{(p as any).branch?.name ?? "بدون فرع"}</span></td>
                <td className="td">{(p as any).governorate?.name ?? "—"}</td>
                <td className="td">{p.phone ?? "—"}</td>
                <td className="td">{p.disabilityPct ? `${p.disabilityPct}%` : "—"}</td>
                <td className="td"><span className="badge-neutral">{PATIENT_STATUS[p.status as keyof typeof PATIENT_STATUS]}</span></td>
                <td className="td">{fmtDate(p.registrationDate)}</td>
              </tr>
            ))}
            {patients.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={8}>لا توجد نتائج.</td></tr>}
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
