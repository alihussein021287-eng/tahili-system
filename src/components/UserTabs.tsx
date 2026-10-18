"use client";
import { useState, useTransition } from "react";
import { Combobox } from "@/components/Combobox";
import { useRouter } from "next/navigation";
import { PERM_GROUPS } from "@/lib/perms";
import { ROLE_LABELS } from "@/lib/permissions";
import {
  updateUser, resetPassword, toggleUser, deleteUnusedUser,
  setUserPerm, setUserPermsBulk, clearUserPerms, applyRoleTemplate, getUserActivity,
  placeUserInCenter, updateUserCenterMembership, endUserCenterMembership,
} from "@/app/(app)/users/actions";
import { fmtDate, fmtDateTime } from "@/lib/labels";

const ROLE_KEYS = ["MANAGER", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "PHARMACIST", "ACCOUNTANT", "RECEPTION", "SECRETARY", "RESIDENT", "DATA_ENTRY", "LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS", "VIEWER"];

type User = {
  id: string; username: string; fullName: string; role: string; isActive: boolean;
  email?: string | null; phone?: string | null; jobTitle?: string | null;
  department?: string | null; note?: string | null; branchId?: number | null; branch?: { name: string } | null;
  lastLoginAt?: string | null; createdAt?: string | null;
};

const MAIN = [
  { key: "profile", label: "معلومات الشخص", icon: "👤" },
  { key: "membership", label: "مراكز العمل", icon: "🏥" },
  { key: "perms", label: "الصلاحيات", icon: "🔐" },
  { key: "security", label: "الأمان", icon: "🔑" },
  { key: "activity", label: "النشاط", icon: "📌" },
] as const;

const CENTER_ROLE_OPTIONS = [
  { value: "CENTER_MANAGEMENT", label: "إدارة مركز" },
  { value: "HEAD_THERAPIST", label: "رئيس المعالجين" },
  { value: "THERAPIST", label: "معالج" },
  { value: "DEVICE_OPERATOR", label: "مشغّل جهاز" },
  { value: "SECRETARY", label: "سكرتارية" },
  { value: "RESIDENT", label: "طبيب مقيم" },
  { value: "SPECIALIST", label: "طبيب اختصاص" },
];
const CENTER_ROLE_LABELS = Object.fromEntries(CENTER_ROLE_OPTIONS.map((item) => [item.value, item.label]));
const MULTI_CENTER_ROLES = new Set(["THERAPIST", "DEVICE_OPERATOR"]);
const CENTER_ROLE_BY_ACCOUNT_ROLE: Record<string, string | undefined> = {
  MANAGER: "CENTER_MANAGEMENT",
  HEAD_THERAPIST: "HEAD_THERAPIST",
  THERAPIST: "THERAPIST",
  SECRETARY: "SECRETARY",
  RESIDENT: "RESIDENT",
  DOCTOR: "SPECIALIST",
  DRESSING: "DEVICE_OPERATOR",
  PROSTHETICS: "DEVICE_OPERATOR",
};

const PROFILE_SUBS = [
  { key: "overview", label: "نظرة عامة" },
  { key: "edit", label: "تعديل البيانات" },
];

export function UserTabs({ user, isAdmin, effective, overrides, activity, logins = [], branches = [], initialTab, deletionBlockers = [], isCurrentUser = false, centers = [], memberships = [], isNewAccount = false }: {
  user: User; isAdmin: boolean; effective: string[]; overrides: Record<string, boolean>; activity?: any[]; logins?: any[]; branches?: any[]; initialTab?: string; deletionBlockers?: { table: string; count: number }[]; isCurrentUser?: boolean; centers?: { id: number; name: string }[]; memberships?: any[]; isNewAccount?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const validInitial = initialTab === "membership" || initialTab === "perms" || initialTab === "security" || initialTab === "activity" ? initialTab : "profile";
  const [main, setMain] = useState<"profile" | "membership" | "perms" | "security" | "activity">(validInitial as any);
  const [sub, setSub] = useState<string>("overview");
  const [acts, setActs] = useState<any[] | undefined>(activity);

  const eff = new Set(effective);
  const has = (k: string) => eff.has(k);
  const isOverride = (k: string) => overrides[k] !== undefined;

  const togglePerm = (k: string, c: boolean) => start(async () => { await setUserPerm(user.id, k, c); router.refresh(); });
  const toggleSection = (keys: string[], c: boolean) => start(async () => { await setUserPermsBulk(user.id, keys, c); router.refresh(); });
  const reset = () => start(async () => { await clearUserPerms(user.id); router.refresh(); });
  const applyTmpl = (role: string) => start(async () => { try { await applyRoleTemplate(user.id, role, false); router.refresh(); } catch (e) { alert((e as Error).message || "تعذّر تطبيق القالب"); } });

  const loadActivity = () => { if (acts === undefined) getUserActivity(user.id).then(setActs).catch(() => setActs([])); };

  const openMain = (k: any) => {
    setMain(k);
    if (k === "profile") setSub("overview");
    else setSub("");
    if (k === "activity") loadActivity();
  };

  const subs = main === "profile" ? PROFILE_SUBS : [];

  return (
    <div className="card flex flex-col md:flex-row">
      {/* التبويبات الرئيسية (سايدبار يمين على الشاشات الكبيرة) */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-gray-200 p-3 md:w-52 md:shrink-0 md:flex-col md:gap-1 md:overflow-visible md:border-b-0 md:border-l">
        {MAIN.map((t) => (
          <button key={t.key} onClick={() => openMain(t.key)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition md:w-full
              ${main === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200 md:bg-transparent md:hover:bg-gray-100"}`}>
            <span className="text-base leading-none">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
        <span className="hidden px-2 pt-2 text-xs text-gray-400 md:block" aria-live="polite">{pending ? "جارٍ الحفظ…" : ""}</span>
      </div>

      <div className="flex-1 space-y-4 p-5">
        {/* شريط التبويبات الفرعية */}
        {subs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-gray-100 pb-3">
            {subs.map((s) => (
              <button key={s.key} onClick={() => setSub(s.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${sub === s.key ? "bg-brand-50 text-brand-700 ring-1 ring-brand-300" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* معلومات الشخص */}
        {main === "profile" && sub === "overview" && <Overview user={user} effectiveCount={effective.length} overridesCount={Object.keys(overrides).length} logins={logins ?? []} />}
        {main === "profile" && sub === "edit" && (
          <EditForm user={user} branches={branches ?? []} pending={pending} start={start} onSaved={() => router.refresh()} />
        )}

        {main === "membership" && (
          <MembershipManager
            userId={user.id}
            centers={centers}
            memberships={memberships}
            pending={pending}
            start={start}
            onSaved={() => router.refresh()}
            isNewAccount={isNewAccount}
            accountRole={user.role}
          />
        )}

        {/* الصلاحيات */}
        {main === "perms" && (
          isAdmin ? (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              مدير النظام (ADMIN) يملك كل الصلاحيات تلقائياً ولا يمكن تقييده.
            </div>
          ) : (
            <>
              <PermToolbar onApply={applyTmpl} onReset={reset} />
              <div className="grid gap-4 md:grid-cols-2">
                {PERM_GROUPS.map((g) => {
                  const keys = g.items.map((it) => it.key);
                  const allOn = keys.every((k) => has(k));
                  return (
                    <div key={g.section} className="rounded-xl border border-gray-200 p-4">
                      <div className="mb-2 flex items-center justify-between border-b border-gray-100 pb-2">
                        <span className="font-semibold text-gray-700">{g.title}</span>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-400">
                          تحديد الكل
                          <input type="checkbox" checked={allOn} onChange={(e) => toggleSection(keys, e.target.checked)} className="h-3.5 w-3.5 accent-brand-600" />
                        </label>
                      </div>
                      <div className="space-y-0.5">
                        {g.items.map((it) => (
                          <label key={it.key}
                            className={`flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50 ${isOverride(it.key) ? "bg-brand-50/60" : ""}`}>
                            <span className="text-gray-700">{it.label}{isOverride(it.key) ? " •" : ""}</span>
                            <input type="checkbox" checked={has(it.key)} onChange={(e) => togglePerm(it.key, e.target.checked)} className="h-4 w-4 accent-brand-600" />
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400">العلامة • = قرار صريح خاص بهذا المستخدم. الحفظ تلقائي عند كل تأشير.</p>
            </>
          )
        )}

        {/* الأمان */}
        {main === "security" && (
          <Security user={user} pending={pending} start={start} onChanged={() => router.refresh()} deletionBlockers={deletionBlockers} isCurrentUser={isCurrentUser} />
        )}

        {/* النشاط */}
        {main === "activity" && <Activity acts={acts} />}
      </div>
    </div>
  );
}

function MembershipManager({ userId, centers, memberships, pending, start, onSaved, isNewAccount, accountRole }: any) {
  const now = Date.now();
  const [error, setError] = useState("");
  const active = memberships.filter((membership: any) => membership.status === "ACTIVE" && new Date(membership.startDate).getTime() <= now && (!membership.endDate || new Date(membership.endDate).getTime() >= now));
  const history = memberships.filter((membership: any) => !active.some((item: any) => item.id === membership.id));
  const run = (task: () => Promise<void>) => start(async () => { try { setError(""); await task(); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر حفظ عضوية المركز"); } });
  const savePlacement = (fd: FormData) => run(() => placeUserInCenter(userId, fd));
  const saveMembership = (id: string, fd: FormData) => run(() => updateUserCenterMembership(userId, id, fd));
  const endMembership = (id: string) => run(() => endUserCenterMembership(userId, id));
  const fixedRole = CENTER_ROLE_BY_ACCOUNT_ROLE[accountRole];
  const fixedRoleLabel = fixedRole ? CENTER_ROLE_LABELS[fixedRole] : null;

  return (
    <div className="space-y-5">
      {isNewAccount && fixedRole ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">تم إنشاء الحساب. صفته داخل المركز ستكون «{fixedRoleLabel}» بحسب دور الحساب؛ حدّد المركز فقط.</div> : null}
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      <section className="rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-gray-900">مركز العمل الحالي</h3><p className="mt-1 text-sm text-gray-500">كل تعديل هنا ينعكس مباشرة في فريق المركز والتحويلات المستقبلية.</p></div><span className="badge-neutral">{active.length} ارتباط فعّال</span></div>
        {active.length ? <div className="mt-4 space-y-3">{active.map((membership: any) => {
          const canEdit = fixedRole === membership.role;
          return (
          <form key={membership.id} action={(fd) => saveMembership(membership.id, fd)} className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 md:grid-cols-4">
            <label className="label">المركز{canEdit ? <select name="centerId" className="input mt-1" defaultValue={membership.centerId}>{centers.map((center: any) => <option key={center.id} value={center.id}>{center.name}</option>)}</select> : <div className="input mt-1 bg-gray-100">{membership.center.name}</div>}</label>
            <label className="label">الصفة<input type="hidden" name="role" value={membership.role} /><div className="input mt-1 bg-gray-100">{CENTER_ROLE_LABELS[membership.role] ?? membership.role}</div></label>
            <label className="label">الاختصاص<input name="specialty" className="input mt-1" defaultValue={membership.specialty ?? ""} disabled={!canEdit} /></label>
            <div className="flex items-end gap-2">{canEdit ? <button className="btn-primary" disabled={pending} type="submit">حفظ التعديل</button> : null}<button className="btn-ghost text-red-700" disabled={pending} type="button" onClick={() => { if (confirm(`إنهاء ارتباطه بـ ${membership.center.name}؟`)) endMembership(membership.id); }}>إنهاء</button></div>
            {!canEdit ? <p className="md:col-span-4 text-xs text-amber-800">هذه عضوية قديمة لا تطابق دور الحساب الحالي؛ يمكنك إنهاؤها، أما إنشاء أو نقل عضوية جديدة فيتبع دور الحساب.</p> : null}
            <p className="md:col-span-4 text-xs text-gray-500">{MULTI_CENTER_ROLES.has(membership.role) ? "هذه الصفة يمكن أن تكون فعّالة في أكثر من مركز." : "هذه الصفة تكون فعّالة في مركز واحد؛ اختيار مركز آخر ينقل الموظف إليه ويحفظ ارتباطه السابق في السجل."}</p>
          </form>
          );
        })}</div> : <p className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{fixedRole ? "لا يوجد مركز عمل فعّال لهذا الموظف. أضف ارتباطه من النموذج أدناه." : "هذا الدور يعمل على مستوى الفرع ولا يحتاج ارتباطاً بمركز علاجي."}</p>}
      </section>

      {fixedRole ? <section className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
        <h3 className="font-semibold text-gray-900">إضافة أو نقل إلى مركز</h3>
        <p className="mt-1 text-sm text-gray-500">الصفة مثبتة من دور الحساب: <b>{fixedRoleLabel}</b>. {MULTI_CENTER_ROLES.has(fixedRole) ? "يمكن ربط هذا الدور بأكثر من مركز." : "اختيار مركز جديد ينهي الارتباط الفعّال السابق تلقائياً ولا يحذف تاريخه."}</p>
        <form action={savePlacement} className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="label">المركز<select name="centerId" className="input mt-1" required defaultValue=""><option value="" disabled>اختر المركز</option>{centers.map((center: any) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
          <label className="label">الصفة<input type="hidden" name="role" value={fixedRole} /><div className="input mt-1 bg-gray-100">{fixedRoleLabel}</div></label>
          <label className="label">الاختصاص<input name="specialty" className="input mt-1" /></label>
          <div className="md:col-span-2"><button className="btn-primary" disabled={pending} type="submit">حفظ مركز العمل</button></div>
        </form>
      </section> : null}

      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900">سجل المراكز السابق</h3>
        {history.length ? <div className="mt-3 space-y-2">{history.map((membership: any) => <div key={membership.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"><span className="font-medium text-gray-800">{membership.center.name} · {CENTER_ROLE_LABELS[membership.role] ?? membership.role}</span><span className="text-gray-500">من {fmtDate(membership.startDate)} إلى {membership.endDate ? fmtDate(membership.endDate) : "—"}</span></div>)}</div> : <p className="mt-2 text-sm text-gray-400">لا يوجد سجل سابق.</p>}
      </section>
    </div>
  );
}

function Overview({ user, effectiveCount, overridesCount, logins }: { user: User; effectiveCount: number; overridesCount: number; logins: any[] }) {
  const rows: [string, any][] = [
    ["اسم المستخدم", user.username],
    ["الاسم الكامل", user.fullName],
    ["الدور", ROLE_LABELS[user.role as keyof typeof ROLE_LABELS]],
    ["الحالة", user.isActive ? "فعّال" : "معطّل"],
    ["المسمّى الوظيفي", user.jobTitle],
    ["القسم/الشعبة", user.department],
    ["الفرع", user.branch?.name],
    ["البريد الإلكتروني", user.email],
    ["الهاتف", user.phone],
    ["آخر دخول", user.lastLoginAt ? fmtDate(user.lastLoginAt) : "—"],
    ["تاريخ الإنشاء", user.createdAt ? fmtDate(user.createdAt) : "—"],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-xl font-bold text-gray-800">{effectiveCount}</div><div className="text-xs text-gray-500">صلاحية فعالة</div></div>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-xl font-bold text-brand-700">{overridesCount}</div><div className="text-xs text-gray-500">استثناء خاص</div></div>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className={`text-xl font-bold ${user.isActive ? "text-emerald-700" : "text-red-700"}`}>{user.isActive ? "فعال" : "معطل"}</div><div className="text-xs text-gray-500">حالة الحساب</div></div>
      </div>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-gray-50 py-2 text-sm">
            <span className="text-gray-400">{k}</span>
            <span className="font-medium text-gray-800">{v || "—"}</span>
          </div>
        ))}
      </div>
      {user.note && (
        <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600"><b className="text-gray-700">ملاحظات:</b> {user.note}</div>
      )}
      <div className="rounded-xl border border-gray-100 p-3">
        <div className="mb-2 text-sm font-semibold text-gray-700">آخر الدخول</div>
        {logins.length === 0 ? <div className="text-sm text-gray-400">لا توجد سجلات دخول حديثة.</div> : (
          <div className="space-y-1">
            {logins.map((l) => <div key={l.id} className="flex justify-between rounded bg-gray-50 px-2 py-1 text-xs"><span>{l.success ? "ناجح" : "فاشل"}{l.ip ? ` · ${l.ip}` : ""}</span><span className="text-gray-400">{fmtDateTime(l.createdAt)}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function EditForm({ user, branches, pending, start, onSaved }: any) {
  const save = (fd: FormData) => start(async () => { await updateUser(user.id, fd); onSaved(); });
  return (
    <form action={save} className="space-y-5">
      <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-semibold text-gray-800">البيانات الوظيفية</legend>
      <div><label className="label">الاسم الكامل</label><input name="fullName" defaultValue={user.fullName} className="input" /></div>
      <div><label className="label">الدور</label>
<Combobox name="role" allowFree={false} defaultValue={user.role} options={Object.entries(ROLE_LABELS).map(([value,label]:any)=>({value,label}))} />
      </div>
      <div><label className="label">الفرع</label>
<Combobox name="branchId" allowFree={false} defaultValue={user.branchId ? String(user.branchId) : ""} placeholder="بدون" options={[{ value: "", label: "بدون فرع" }, ...branches.map((b:any)=>({value:String(b.id),label:b.name}))]} />
      </div>
      <div><label className="label">المسمّى الوظيفي</label><input name="jobTitle" defaultValue={user.jobTitle ?? ""} className="input" /></div>
      <div><label className="label">القسم/الشعبة</label><input name="department" defaultValue={user.department ?? ""} className="input" /></div>
      <div><label className="label">البريد الإلكتروني</label><input name="email" defaultValue={user.email ?? ""} className="input" /></div>
      <div><label className="label">الهاتف</label><input name="phone" defaultValue={user.phone ?? ""} className="input" /></div>
      <div className="sm:col-span-2"><label className="label">ملاحظات</label><textarea name="note" defaultValue={user.note ?? ""} className="input" rows={2} /></div>
      </fieldset>
      <div className="flex justify-end border-t border-gray-100 pt-4"><button className="btn-primary" disabled={pending} type="submit">حفظ التعديلات</button></div>
    </form>
  );
}

function PermToolbar({ onApply, onReset }: { onApply: (r: string) => void; onReset: () => void }) {
  const [role, setRole] = useState("MANAGER");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3">
      <span className="text-xs text-gray-500">قالب سريع:</span>
<div className="min-w-[180px]"><Combobox name="_roleTpl" allowFree={false} defaultValue={role} onValueChange={setRole} options={ROLE_KEYS.map((r:any)=>({value:r,label:ROLE_LABELS[r as keyof typeof ROLE_LABELS]}))} /></div>
      <button onClick={() => { if (confirm("سيتم تعبئة كل صلاحيات هذا المستخدم من القالب المختار (يستبدل الحالية). متابعة؟")) onApply(role); }}
        className="btn-primary !py-1 text-sm">تعبئة من القالب</button>
      <button onClick={() => { if (confirm("إرجاع صلاحيات هذا المستخدم لافتراضي دوره وحذف كل الاستثناءات؟")) onReset(); }}
        className="btn-ghost !py-1 text-sm">تصفير</button>
    </div>
  );
}

function Security({ user, pending, start, onChanged, deletionBlockers, isCurrentUser }: any) {
  const doPw = (fd: FormData) => start(async () => { await resetPassword(user.id, fd); onChanged(); });
  const doToggle = () => start(async () => { await toggleUser(user.id, !user.isActive); onChanged(); });
  const doDelete = (fd: FormData) => start(async () => { await deleteUnusedUser(user.id, fd); window.location.href = "/users"; });
  return (
    <div className="max-w-2xl space-y-5">
      <form action={doPw} className="space-y-2 rounded-lg border border-gray-200 p-4">
        <div><div className="font-semibold text-gray-700">تغيير كلمة السر</div><p className="mt-1 text-sm text-gray-500">إجراء أمان مستقل؛ لا يغيّر بيانات الحساب أو صلاحياته.</p></div>
        <label className="label">كلمة السر الجديدة<input name="password" type="text" placeholder="8 أحرف فأكثر بحروف وأرقام (حسب سياسة النظام)" className="input mt-1 w-full" /></label>
        <button className="btn-primary" disabled={pending} type="submit">تحديث كلمة السر</button>
      </form>
      <div className="space-y-3 rounded-lg border border-gray-200 p-4">
        <div className="font-semibold text-gray-700">حالة الحساب</div>
        <p className="text-sm text-gray-500">{user.isActive ? "الحساب فعّال ويستطيع الدخول." : "الحساب معطّل ولا يستطيع الدخول."}</p>
        <button onClick={doToggle} disabled={pending}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${user.isActive ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
          {user.isActive ? "تعطيل الحساب" : "تفعيل الحساب"}
        </button>
      </div>
      <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/20 p-4">
        <div className="font-semibold text-red-700">الحذف النهائي للحساب غير المستخدم</div>
        {isCurrentUser ? <p className="text-sm text-red-700">لا يمكن حذف حسابك الحالي.</p> : deletionBlockers.length > 0 ? (
          <div className="text-sm text-gray-600">
            <p>الحذف ممنوع لوجود {deletionBlockers.reduce((s: number, x: any) => s + x.count, 0)} سجل مرتبط. استخدم تعطيل الحساب.</p>
            <div className="mt-2 flex flex-wrap gap-1">{deletionBlockers.map((x: any) => <span key={x.table} className="rounded bg-gray-100 px-2 py-1 text-xs">{x.table}: {x.count}</span>)}</div>
          </div>
        ) : (
          <form action={doDelete} className="space-y-2">
            <p className="text-sm text-gray-600">هذا الحساب غير مرتبط بأي سجل. التعطيل يبقى الخيار المفضل.</p>
            <label className="label">عبارة تأكيد الحذف<input name="confirm" className="input mt-1" placeholder="اكتب: حذف الحساب" autoComplete="off" /></label>
            <button type="submit" disabled={pending || user.role === "ADMIN"} className="btn-danger">حذف الحساب نهائياً</button>
          </form>
        )}
      </div>
    </div>
  );
}

function Activity({ acts }: { acts: any[] | undefined }) {
  const ACT: Record<string, string> = { CREATE: "أنشأ", UPDATE: "عدّل", DELETE: "حذف", VIEW: "فتح" };
  const CLR: Record<string, string> = { CREATE: "text-green-700", UPDATE: "text-amber-700", DELETE: "text-red-700", VIEW: "text-gray-500" };
  if (acts === undefined) return <div className="py-10 text-center text-sm text-gray-400">جارٍ التحميل…</div>;
  if (acts.length === 0) return <p className="text-sm text-gray-400">لا يوجد نشاط مسجّل لهذا المستخدم.</p>;
  return (
    <div className="space-y-1.5">
      <p className="mb-2 text-xs text-gray-400">آخر {acts.length} عملية قام بها هذا المستخدم.</p>
      {acts.map((l) => (
        <div key={l.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
          <span><span className={`font-medium ${CLR[l.action] ?? "text-gray-600"}`}>{ACT[l.action] ?? l.action}</span> · {l.tableName}{l.ipAddress ? ` · ${l.ipAddress}` : ""}</span>
          <span className="text-xs text-gray-400">{fmtDateTime(l.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
