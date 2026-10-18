import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { AdminSection } from "@/components/AdminPageSections";
import { StatusBadge } from "@/components/Ui";
import { ROLE_LABELS } from "@/lib/permissions";
import { currentActor } from "@/lib/data-center/access";
import { canEditEmployees, canManageAccounts, EMPLOYEE_CATEGORIES, getEmployee, MISSING_LABELS, missingFields, proposeLink, STAGEABLE_ROLES, suggestRole, attendanceRequired } from "@/lib/employees/service";
import { confirmLinkAction, stageAccountAction, updateEmployeeAction } from "../actions";

export const dynamic = "force-dynamic";
type SP = { saved?: string; err?: string; linked?: string; staged?: string; warn?: string; propose?: string };

export default async function EmployeeProfile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.has("employees.view")) redirect("/staff");
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;
  const emp = await getEmployee(prisma, actor, id);
  if (!emp) notFound();
  const canEdit = canEditEmployees(actor);
  const canAccounts = canManageAccounts(actor);
  const isAdmin = actor.role === "ADMIN";
  const missing = missingFields(emp);
  const suggestion = suggestRole(emp);
  const [centers, branches] = await Promise.all([
    canAccounts ? prisma.center.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    isAdmin ? prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const evidence = canAccounts && !emp.user && sp.propose ? await proposeLink(prisma, actor, emp.id, sp.propose) : null;
  const requiredRole = emp.category === "RESIDENT" ? "RESIDENT" : emp.category === "SPECIALIST" ? "DOCTOR" : null;
  const roleChoices = requiredRole ? [requiredRole] : STAGEABLE_ROLES;

  return (
    <div className="min-w-0 space-y-6" dir="rtl">
      <PageHeader title={emp.name} subtitle={`${emp.category ? EMPLOYEE_CATEGORIES[emp.category as keyof typeof EMPLOYEE_CATEGORIES] ?? emp.category : "سجل قديم"} · ${emp.branch?.name ?? "فرع غير محدد"}`} icon="🗂">
        <Link href="/staff/employees" className="btn-ghost">← سجلات الموظفين</Link>
      </PageHeader>
      {sp.err ? <div role="alert" className="card-danger p-3 text-sm text-red-800">{sp.err}</div> : null}
      {sp.linked ? <div role="status" className="card p-3 text-sm text-emerald-800">تم ربط الحساب بالسجل.</div> : null}
      {sp.staged ? <div role="status" className="card p-3 text-sm text-emerald-800">أُعدّ حساب غير مفعّل مرتبط بالسجل. التفعيل خطوة منفصلة من صفحة الحساب.{sp.warn ? ` تنبيه: ${sp.warn}` : ""}</div> : null}

      <AdminSection id="details" title="البيانات">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[["الوظيفة", emp.job], ["القسم", emp.department], ["الاختصاص", emp.specialty], ["الصفة", emp.capacity], ["الهاتف", emp.phone], ["الفرع", emp.branch?.name], ["ملاحظات", emp.notes]].map(([k, v]) => (
            <div key={k as string}><dt className="text-gray-500">{k}</dt><dd>{v ? String(v) : <span className="text-amber-700">غير مسجل</span>}</dd></div>
          ))}
          <div><dt className="text-gray-500">يُتوقع حضوره</dt><dd>{attendanceRequired(emp) ? "نعم" : "لا (لا يُحتسب غائباً)"}</dd></div>
        </dl>
        {missing.length ? <p className="mt-3 text-sm text-amber-800" data-testid="missing-info">معلومات ناقصة: {missing.map((m) => MISSING_LABELS[m]).join("، ")}</p> : null}
      </AdminSection>

      {canEdit ? (
        <AdminSection id="edit" title="تعديل البيانات" description="يمكن إكمال الحقول الاختيارية يدوياً. لا يُنشأ سجل جديد ولا يتكرر الشخص.">
          <form action={updateEmployeeAction.bind(null, emp.id)} className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="e-name">الاسم</label><input id="e-name" name="name" defaultValue={emp.name} className="input" required /></div>
            <div><label className="label" htmlFor="e-job">الوظيفة</label><input id="e-job" name="job" defaultValue={emp.job ?? ""} className="input" /></div>
            <div><label className="label" htmlFor="e-dep">القسم</label><input id="e-dep" name="department" defaultValue={emp.department ?? ""} className="input" /></div>
            <div><label className="label" htmlFor="e-spec">الاختصاص</label><input id="e-spec" name="specialty" defaultValue={emp.specialty ?? ""} className="input" /></div>
            <div><label className="label" htmlFor="e-cap">الصفة</label><input id="e-cap" name="capacity" defaultValue={emp.capacity ?? ""} className="input" /></div>
            <div><label className="label" htmlFor="e-ph">الهاتف</label><input id="e-ph" name="phone" defaultValue={emp.phone ?? ""} className="input" inputMode="tel" /></div>
            <div><label className="label" htmlFor="e-cat">الفئة</label>
              <select id="e-cat" name="category" defaultValue={emp.category ?? ""} className="input" disabled={!!emp.user}><option value="">بلا فئة</option>{Object.entries(EMPLOYEE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {emp.user ? <input type="hidden" name="category" value={emp.category ?? ""} /> : null}</div>
            <div><label className="label" htmlFor="e-att">الحضور</label>
              <select id="e-att" name="attendanceRequired" defaultValue={emp.attendanceRequired == null ? "" : emp.attendanceRequired ? "yes" : "no"} className="input"><option value="">الافتراضي</option><option value="yes">يُتوقع حضوره</option><option value="no">لا يُحتسب غائباً</option></select></div>
            {isAdmin && !emp.user ? <div><label className="label" htmlFor="e-br">الفرع</label><select id="e-br" name="branchId" defaultValue={emp.branchId ?? ""} className="input"><option value="">غير محدد</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div> : null}
            <div className="sm:col-span-2"><label className="label" htmlFor="e-no">ملاحظات</label><textarea id="e-no" name="notes" defaultValue={emp.notes ?? ""} className="input" rows={2} /></div>
            <div className="sm:col-span-2"><button type="submit" className="btn-primary">حفظ</button></div>
          </form>
        </AdminSection>
      ) : null}

      <AdminSection id="account" title="الحساب المرتبط" description="السجل الوظيفي لا يمنح صلاحيات. الربط واحد لواحد، والتفعيل خطوة مستقلة.">
        {emp.user ? (
          <div className="space-y-2 text-sm" data-testid="linked-account">
            <p>اسم المستخدم: <b>{emp.user.username}</b> · الدور: {(ROLE_LABELS as Record<string, string>)[emp.user.role] ?? emp.user.role} · <StatusBadge tone={emp.user.isActive ? "success" : "neutral"}>{emp.user.isActive ? "فعّال" : emp.user.needsActivation ? "غير مفعّل بانتظار التفعيل" : "معطّل"}</StatusBadge></p>
            <p>عضويات المراكز: {emp.user.centerMemberships.length ? emp.user.centerMemberships.map((m) => m.center.name).join("، ") : <span className="text-amber-700">لا توجد (لا وصول لأي مركز)</span>}</p>
            {canAccounts ? <Link className="btn-ghost btn-sm" href={`/users/${emp.user.id}`}>إدارة الحساب والتفعيل</Link> : null}
          </div>
        ) : (
          <div className="space-y-5 text-sm">
            <p>لا يوجد حساب مرتبط. الدور المقترح: <b>{suggestion.role ? (ROLE_LABELS as Record<string, string>)[suggestion.role] ?? suggestion.role : "لا دور مقترح"}</b> — {suggestion.note}</p>
            {!canAccounts ? <p className="text-gray-500">ربط الحسابات وإنشاؤها لمدير النظام فقط.</p> : (
              <>
                <section aria-labelledby="link-h">
                  <h3 id="link-h" className="mb-2 font-semibold">1) ربط حساب موجود</h3>
                  <form method="get" className="flex flex-wrap items-end gap-2">
                    <div><label className="label" htmlFor="l-u">اسم مستخدم الحساب (يُكتب بدقة)</label><input id="l-u" name="propose" defaultValue={sp.propose ?? ""} className="input" dir="ltr" /></div>
                    <button className="btn-ghost" type="submit">مراجعة الأدلة</button>
                  </form>
                  {evidence ? (
                    <div className="mt-3 rounded-lg border border-gray-200 p-3" data-testid="link-evidence">
                      <ul className="space-y-1">{evidence.checks.map((c) => <li key={c.key}>{c.ok ? "✅" : "❌"} {c.label}</li>)}</ul>
                      {evidence.ok ? (
                        <form action={confirmLinkAction.bind(null, emp.id)} className="mt-3 space-y-2">
                          <input type="hidden" name="username" value={sp.propose ?? ""} />
                          <div><label className="label" htmlFor="l-n">كيف تحقّقت من الهوية؟ (إلزامي ويُسجَّل في التدقيق)</label><input id="l-n" name="note" className="input" required minLength={5} /></div>
                          <button className="btn-primary" type="submit">تأكيد الربط</button>
                        </form>
                      ) : <p className="mt-2 text-red-700">لا يُسمح بالربط حتى تكتمل كل الأدلة.</p>}
                    </div>
                  ) : null}
                </section>
                <section aria-labelledby="stage-h">
                  <h3 id="stage-h" className="mb-2 font-semibold">2) تجهيز حساب غير مفعّل</h3>
                  {emp.branchId == null ? <p className="text-amber-700">حدّد فرع السجل أولاً.</p> : (
                    <form action={stageAccountAction.bind(null, emp.id)} className="grid gap-3 sm:grid-cols-3">
                      <div><label className="label" htmlFor="s-u">اسم المستخدم</label><input id="s-u" name="username" className="input" dir="ltr" required pattern="[a-z0-9._-]{3,40}" /></div>
                      <div><label className="label" htmlFor="s-r">الدور</label><select id="s-r" name="role" className="input" defaultValue={suggestion.role ?? roleChoices[0]}>{roleChoices.map((r) => <option key={r} value={r}>{(ROLE_LABELS as Record<string, string>)[r] ?? r}</option>)}</select></div>
                      <div><label className="label" htmlFor="s-c">المركز (عضوية)</label><select id="s-c" name="centerId" className="input" defaultValue=""><option value="">بدون عضوية</option>{centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                      <p className="text-xs text-gray-600 sm:col-span-3">يُنشأ الحساب معطّلاً بكلمة سر عشوائية غير قابلة للاستخدام؛ دور بلا مركز لا يمنح وصولاً لأي مركز. ADMIN وMANAGER لا يُجهَّزان من هنا.{requiredRole ? ` هذا السجل يقتضي الدور ${requiredRole}.` : ""}</p>
                      <div className="sm:col-span-3"><button className="btn-primary" type="submit">تجهيز الحساب</button></div>
                    </form>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </AdminSection>
    </div>
  );
}
