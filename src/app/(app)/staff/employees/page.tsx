import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, StatCard } from "@/components/AdminPageSections";
import { DataTable, StatusBadge, TableEmptyRow } from "@/components/Ui";
import { ROLE_LABELS } from "@/lib/permissions";
import { AdminSectionTabs as StaffTabsBar } from "@/components/AdminPageSections";
import { staffNavTabs } from "@/lib/staff-nav";
import { currentActor } from "@/lib/data-center/access";
import { EMPLOYEE_CATEGORIES, listEmployees, missingFields, MISSING_LABELS, roleMappingGroups, staffCounts } from "@/lib/employees/service";

export const dynamic = "force-dynamic";
type SP = { q?: string; category?: string; branch?: string; department?: string; center?: string; link?: string; page?: string; view?: string };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.has("employees.view")) redirect("/staff");
  const sp = await searchParams;
  const isAdmin = actor.role === "ADMIN";
  const filters = { q: sp.q, category: sp.category, branchId: sp.branch ? Number(sp.branch) : null, department: sp.department, centerId: sp.center ? Number(sp.center) : null, link: (sp.link === "linked" || sp.link === "unlinked" ? sp.link : "") as "linked" | "unlinked" | "", page: Number(sp.page) || 1 };
  const [counts, list, centers, branches, deps] = await Promise.all([
    staffCounts(prisma, actor),
    sp.view === "mapping" ? null : listEmployees(prisma, actor, filters),
    prisma.center.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    isAdmin ? prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    prisma.employee.findMany({ where: actor.role === "ADMIN" ? {} : { branchId: actor.branchId ?? -1 }, distinct: ["department"], select: { department: true }, orderBy: { department: "asc" } }),
  ]);
  const mapping = sp.view === "mapping" ? await roleMappingGroups(prisma, actor) : null;
  const qs = (over: Record<string, string>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, String(v)); return `/staff/employees?${p.toString()}`; };

  return (
    <div className="min-w-0 space-y-6" dir="rtl">
      <PageHeader title="سجلات الموظفين" subtitle="السجل الوظيفي (Employee) منفصل عن حساب الدخول (User)" icon="🗂">
        <Link href="/staff?tab=overview" className="btn-ghost">← الموظفون والمهام</Link>
        <Link href={sp.view === "mapping" ? "/staff/employees" : "/staff/employees?view=mapping"} className="btn-ghost">{sp.view === "mapping" ? "قائمة السجلات" : "مراجعة تعيين الأدوار"}</Link>
      </PageHeader>
      <StaffTabsBar tabs={staffNavTabs(actor.permissions, actor.role)} active="records" label="أقسام الموظفين والمهام" />
      <AdminIntro title="الأعداد" description="سجلات الأفراد والحسابات تُعدّ كلٌّ على حدة؛ وجود حساب لا يعني وجود سجل وظيفي والعكس." />
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8" aria-label="أعداد السجلات والحسابات">
        <StatCard label="سجلات الموظفين" value={counts.personnel} />
        <StatCard label="أطباء مقيمون" value={counts.residents} />
        <StatCard label="أطباء اختصاص" value={counts.specialists} />
        <StatCard label="موظفون آخرون" value={counts.others} />
        <StatCard label="سجلات بلا حساب" value={counts.unlinked} tone="text-amber-700" />
        <StatCard label="الحسابات" value={counts.accounts} />
        <StatCard label="حسابات فعالة" value={counts.activeAccounts} tone="text-emerald-700" />
        <StatCard label="حسابات معطلة" value={counts.inactiveAccounts} />
      </section>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="الاستكمال والربط">
        <StatCard label="مرتبطة بحساب" value={counts.linked} tone="text-emerald-700" />
        <StatCard label="تحتاج استكمال بيانات" value={counts.needsCompletion} tone="text-amber-700" />
        <StatCard label="تحتاج حساباً معتمداً" value={counts.needsAccount} tone="text-amber-700" description="مقيمون واختصاص بلا حساب" />
        <StatCard label="حسابات بلا عضوية مركز" value={counts.needsMembership} tone="text-amber-700" />
      </section>
      <section className="grid gap-3 md:grid-cols-2" aria-label="التوزيع">
        <div className="card p-4 text-sm"><h3 className="mb-2 font-semibold">الحسابات حسب الدور</h3>
          {counts.accountsByRole.length ? <ul className="space-y-1">{counts.accountsByRole.map((r) => <li key={r.role} className="flex justify-between"><span>{(ROLE_LABELS as Record<string, string>)[r.role] ?? r.role}</span><b>{r.count}</b></li>)}</ul> : <p className="text-gray-500">لا حسابات.</p>}</div>
        <div className="card p-4 text-sm"><h3 className="mb-2 font-semibold">الموظفون الآخرون حسب الوظيفة</h3>
          {counts.othersByJob.length ? <ul className="space-y-1">{counts.othersByJob.map((r, i) => <li key={i} className="flex justify-between"><span>{r.job ?? "بلا وظيفة مسجلة"}</span><b>{r.count}</b></li>)}</ul> : <p className="text-gray-500">لا سجلات.</p>}</div>
      </section>

      {mapping ? (
        <AdminSection id="mapping" title="مراجعة تعيين الأدوار" description="اقتراحات للقراءة فقط: لا تُطبَّق تلقائياً. الأطباء المقيمون = RESIDENT، الاختصاص = DOCTOR (قرار المالك)، والموظفون لا يُمنحون دوراً إلا بمطابقة تامة للمسمى ثم تأكيد المدير.">
          <DataTable label="مجموعات المسميات" className="-mx-5 -mb-5 rounded-none border-x-0 border-b-0">
            <table className="w-full">
              <thead><tr><th className="th">الفئة</th><th className="th">المسمى</th><th className="th">القسم</th><th className="th">العدد</th><th className="th">الدور المقترح</th><th className="th">الأساس</th></tr></thead>
              <tbody>
                {mapping.map((g, i) => (
                  <tr key={i}>
                    <td className="td">{g.category ? EMPLOYEE_CATEGORIES[g.category as keyof typeof EMPLOYEE_CATEGORIES] ?? g.category : "—"}</td>
                    <td className="td">{g.job ?? "—"}</td><td className="td">{g.department ?? "—"}</td><td className="td">{g.count}</td>
                    <td className="td">{g.suggestion.role ? <StatusBadge tone="neutral">{(ROLE_LABELS as Record<string, string>)[g.suggestion.role] ?? g.suggestion.role}</StatusBadge> : <StatusBadge tone="warning">لا دور مقترح</StatusBadge>}</td>
                    <td className="td text-xs">{g.suggestion.note}</td>
                  </tr>
                ))}
                {mapping.length === 0 ? <TableEmptyRow colSpan={6} title="لا توجد سجلات" description="" /> : null}
              </tbody>
            </table>
          </DataTable>
        </AdminSection>
      ) : list ? (
        <>
          <AdminSection id="filters" title="بحث وتصفية">
            <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="label" htmlFor="f-q">بحث</label><input id="f-q" name="q" defaultValue={sp.q ?? ""} className="input" placeholder="اسم، وظيفة، قسم…" /></div>
              <div><label className="label" htmlFor="f-cat">الفئة</label>
                <select id="f-cat" name="category" defaultValue={sp.category ?? ""} className="input"><option value="">الكل</option>{Object.entries(EMPLOYEE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="NONE">بلا فئة (قديم)</option></select></div>
              {isAdmin ? <div><label className="label" htmlFor="f-br">الفرع</label><select id="f-br" name="branch" defaultValue={sp.branch ?? ""} className="input"><option value="">الكل</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div> : null}
              <div><label className="label" htmlFor="f-dep">القسم</label><select id="f-dep" name="department" defaultValue={sp.department ?? ""} className="input"><option value="">الكل</option>{deps.filter((d) => d.department).map((d) => <option key={d.department!} value={d.department!}>{d.department}</option>)}</select></div>
              <div><label className="label" htmlFor="f-ce">المركز (عضوية الحساب)</label><select id="f-ce" name="center" defaultValue={sp.center ?? ""} className="input"><option value="">الكل</option>{centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label" htmlFor="f-li">الحساب</label><select id="f-li" name="link" defaultValue={sp.link ?? ""} className="input"><option value="">الكل</option><option value="linked">مرتبط بحساب</option><option value="unlinked">بلا حساب</option></select></div>
              <div className="flex items-end gap-2"><button className="btn-primary" type="submit">تصفية</button><Link href="/staff/employees" className="btn-ghost">مسح</Link></div>
            </form>
          </AdminSection>
          <AdminSection id="list" title={`السجلات (${list.total})`} description="افتح السجل لعرض التفاصيل أو إكمال المعلومات الناقصة أو ربط حساب.">
            <DataTable label="سجلات الموظفين" className="-mx-5 -mb-5 rounded-none border-x-0 border-b-0">
              <table className="w-full">
                <thead><tr><th className="th">الاسم</th><th className="th">الفئة</th><th className="th">الوظيفة</th><th className="th">القسم</th><th className="th">الفرع</th><th className="th">الحساب</th><th className="th">ناقص</th></tr></thead>
                <tbody>
                  {list.rows.map((e) => {
                    const miss = missingFields({ job: e.job, department: e.department, specialty: e.specialty, phone: e.phone, branchId: e.branchId, category: e.category });
                    return (
                      <tr key={e.id}>
                        <td className="td"><Link className="text-brand-700 hover:underline" href={`/staff/employees/${e.id}`}>{e.name}</Link></td>
                        <td className="td">{e.category ? EMPLOYEE_CATEGORIES[e.category as keyof typeof EMPLOYEE_CATEGORIES] ?? e.category : "—"}</td>
                        <td className="td">{e.job ?? <span className="text-gray-400">غير مسجل</span>}</td>
                        <td className="td">{e.department ?? <span className="text-gray-400">غير مسجل</span>}</td>
                        <td className="td">{e.branch?.name ?? <span className="text-amber-700">غير محدد</span>}</td>
                        <td className="td">{e.user ? <StatusBadge tone={e.user.isActive ? "success" : "neutral"}>{e.user.isActive ? "فعّال" : e.user.needsActivation ? "بانتظار التفعيل" : "معطّل"} · {e.user.username}</StatusBadge> : <StatusBadge tone="warning">بلا حساب</StatusBadge>}</td>
                        <td className="td text-xs">{miss.length ? miss.map((m) => MISSING_LABELS[m]).join("، ") : "—"}</td>
                      </tr>
                    );
                  })}
                  {list.rows.length === 0 ? <TableEmptyRow colSpan={7} title="لا توجد سجلات مطابقة" description="غيّر عوامل التصفية." /> : null}
                </tbody>
              </table>
            </DataTable>
          </AdminSection>
          {list.pages > 1 ? (
            <nav className="flex items-center justify-center gap-3 text-sm" aria-label="الصفحات">
              {list.page > 1 ? <Link className="btn-ghost" href={qs({ page: String(list.page - 1) })}>السابق</Link> : null}
              <span>{list.page} / {list.pages}</span>
              {list.page < list.pages ? <Link className="btn-ghost" href={qs({ page: String(list.page + 1) })}>التالي</Link> : null}
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
