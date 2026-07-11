"use client";
import { useState, useTransition } from "react";
import { Combobox } from "@/components/Combobox";
import { useRouter } from "next/navigation";
import { PERM_GROUPS } from "@/lib/perms";
import { ROLE_LABELS } from "@/lib/permissions";
import {
  updateUser, resetPassword, toggleUser,
  setUserPerm, setUserPermsBulk, clearUserPerms, applyRoleTemplate, getUserActivity,
} from "@/app/(app)/users/actions";
import { fmtDate, fmtDateTime } from "@/lib/labels";

const ROLE_KEYS = ["MANAGER", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "PHARMACIST", "ACCOUNTANT", "RECEPTION", "RESIDENT", "DATA_ENTRY", "LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS", "VIEWER"];

type User = {
  id: string; username: string; fullName: string; role: string; isActive: boolean;
  email?: string | null; phone?: string | null; jobTitle?: string | null;
  department?: string | null; note?: string | null; branchId?: number | null; branch?: { name: string } | null;
  lastLoginAt?: string | null; createdAt?: string | null;
};

const MAIN = [
  { key: "profile", label: "معلومات الشخص", icon: "👤" },
  { key: "perms", label: "الصلاحيات", icon: "🔐" },
  { key: "security", label: "الأمان", icon: "🔑" },
  { key: "activity", label: "النشاط", icon: "📌" },
] as const;

const PROFILE_SUBS = [
  { key: "overview", label: "نظرة عامة" },
  { key: "edit", label: "تعديل البيانات" },
];

export function UserTabs({ user, isAdmin, effective, overrides, activity, logins = [], branches = [], initialTab }: {
  user: User; isAdmin: boolean; effective: string[]; overrides: Record<string, boolean>; activity?: any[]; logins?: any[]; branches?: any[]; initialTab?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const validInitial = initialTab === "perms" || initialTab === "security" || initialTab === "activity" ? initialTab : "profile";
  const [main, setMain] = useState<"profile" | "perms" | "security" | "activity">(validInitial as any);
  const [sub, setSub] = useState<string>("overview");
  const [acts, setActs] = useState<any[] | undefined>(activity);

  const eff = new Set(effective);
  const has = (k: string) => eff.has(k);
  const isOverride = (k: string) => overrides[k] !== undefined;

  const togglePerm = (k: string, c: boolean) => start(async () => { await setUserPerm(user.id, k, c); router.refresh(); });
  const toggleSection = (keys: string[], c: boolean) => start(async () => { await setUserPermsBulk(user.id, keys, c); router.refresh(); });
  const reset = () => start(async () => { await clearUserPerms(user.id); router.refresh(); });
  const applyTmpl = (role: string) => start(async () => { await applyRoleTemplate(user.id, role, false); router.refresh(); });

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
        {pending && <span className="hidden px-2 pt-2 text-xs text-gray-400 md:block">يحفظ…</span>}
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
          <Security user={user} pending={pending} start={start} onChanged={() => router.refresh()} />
        )}

        {/* النشاط */}
        {main === "activity" && <Activity acts={acts} />}
      </div>
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
    <form action={save} className="grid gap-3 sm:grid-cols-2">
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
      <div className="sm:col-span-2"><button className="btn-primary" disabled={pending} type="submit">حفظ التعديلات</button></div>
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

function Security({ user, pending, start, onChanged }: any) {
  const doPw = (fd: FormData) => start(async () => { await resetPassword(user.id, fd); onChanged(); });
  const doToggle = () => start(async () => { await toggleUser(user.id, !user.isActive); onChanged(); });
  return (
    <div className="max-w-md space-y-4">
      <form action={doPw} className="space-y-2 rounded-lg border border-gray-200 p-4">
        <div className="font-semibold text-gray-700">تغيير كلمة السر</div>
        <input name="password" type="text" placeholder="كلمة سر جديدة (6 أحرف فأكثر)" className="input w-full" />
        <button className="btn-primary" disabled={pending} type="submit">تحديث كلمة السر</button>
      </form>
      <div className="space-y-2 rounded-lg border border-gray-200 p-4">
        <div className="font-semibold text-gray-700">حالة الحساب</div>
        <p className="text-sm text-gray-500">{user.isActive ? "الحساب فعّال ويستطيع الدخول." : "الحساب معطّل ولا يستطيع الدخول."}</p>
        <button onClick={doToggle} disabled={pending}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${user.isActive ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
          {user.isActive ? "تعطيل الحساب" : "تفعيل الحساب"}
        </button>
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
