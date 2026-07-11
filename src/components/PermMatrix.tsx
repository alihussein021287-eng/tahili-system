"use client";
import { useState, useTransition } from "react";
import { Combobox } from "@/components/Combobox";
import { useRouter } from "next/navigation";
import { PERM_GROUPS, ROLE_DEFAULTS } from "@/lib/perms";
import { ROLE_LABELS } from "@/lib/permissions";
import { setRolePerm, setUserPerm, clearUserPerms, resetRolePerms } from "@/app/(app)/permissions/actions";

const ROLES = ["MANAGER", "DOCTOR", "HEAD_THERAPIST", "THERAPIST", "PHARMACIST", "ACCOUNTANT", "RECEPTION", "RESIDENT", "DATA_ENTRY", "LAB", "RADIOLOGY", "DRESSING", "PROSTHETICS", "VIEWER"];
const SENSITIVE = new Set(["users.manage", "users.permissions", "settings.edit", "settings.backup", "reports.approve", "finance.delete", "patients.delete", "appointments.delete", "devices.delete", "tasks.delete", "audit.view"]);

type Props = {
  roleSets: Record<string, string[]>;
  users: { id: string; fullName: string; username: string; role: string }[];
  userOverrides: Record<string, Record<string, boolean>>;
};

export function PermMatrix({ roleSets, users, userOverrides }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"roles" | "users">("roles");
  const [role, setRole] = useState("MANAGER");
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [pending, start] = useTransition();

  const roleSet = new Set(roleSets[role] ?? []);
  const defaultRoleSet = new Set((ROLE_DEFAULTS as any)[role] ?? []);
  const selUser = users.find((u) => u.id === userId);
  const baseForUser = new Set(roleSets[selUser?.role ?? ""] ?? []);
  const ov = userOverrides[userId] ?? {};

  const toggleRole = (key: string, checked: boolean) => start(async () => { await setRolePerm(role, key, checked); router.refresh(); });
  const resetRole = () => {
    if (!confirm(`إرجاع صلاحيات هذا الدور للقالب الافتراضي؟ سيتم حذف كل التخصيصات المحفوظة له.`)) return;
    start(async () => { await resetRolePerms(role); router.refresh(); });
  };
  const toggleUser = (key: string, checked: boolean) => start(async () => { await setUserPerm(userId, key, checked); router.refresh(); });
  const resetUser = () => start(async () => { await clearUserPerms(userId); router.refresh(); });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setTab("roles")} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "roles" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600"}`}>صلاحيات الأدوار</button>
        <button onClick={() => setTab("users")} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "users" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600"}`}>استثناءات المستخدمين</button>
        {pending && <span className="self-center text-xs text-gray-400">يحفظ...</span>}
      </div>

      {tab === "roles" && (
        <>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            تغييرات الأدوار تؤثر على كل مستخدم يحمل هذا الدور ما لم يكن لديه استثناء خاص. الصلاحيات الحساسة مميزة باللون الأحمر، وصلاحيات الأدمن فقط لا تُمنح فعلياً إلا لمدير النظام في مواضع التنفيذ.
          </div>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <button key={r} onClick={() => setRole(r)} className={`rounded-full px-3 py-1 text-sm ${role === r ? "bg-brand-50 text-brand-700 ring-1 ring-brand-300" : "bg-gray-100 text-gray-600"}`}>
                {ROLE_LABELS[r as keyof typeof ROLE_LABELS]}
              </button>
            ))}
          <button type="button" onClick={resetRole} disabled={pending}
            className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100">
            ↺ إرجاع للافتراضي
          </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3"><div className="text-xl font-bold text-gray-800">{roleSet.size}</div><div className="text-xs text-gray-500">صلاحية حالية</div></div>
            <div className="card p-3"><div className="text-xl font-bold text-brand-700">{defaultRoleSet.size}</div><div className="text-xs text-gray-500">قالب الدور</div></div>
            <div className="card p-3"><div className="text-xl font-bold text-amber-700">{[...SENSITIVE].filter((k) => roleSet.has(k)).length}</div><div className="text-xs text-gray-500">صلاحيات حساسة</div></div>
          </div>
          <Groups checkedOf={(k) => roleSet.has(k)} onToggle={toggleRole} baselineOf={(k) => defaultRoleSet.has(k)} />
        </>
      )}

      {tab === "users" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
<div className="min-w-[240px]"><Combobox name="_userPick" allowFree={false} defaultValue={userId} onValueChange={setUserId} options={users.map((u:any)=>({value:String(u.id),label:`${u.fullName} — ${ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}`}))} /></div>
            <button onClick={() => { if (confirm("حذف كل استثناءات هذا المستخدم والعودة لافتراضي دوره؟")) resetUser(); }} className="btn-ghost text-sm">إرجاع لافتراضي الدور</button>
            <span className="text-xs text-gray-400">العلامة الزرقاء = استثناء خاص بهذا المستخدم</span>
          </div>
          {selUser && (
            <div className="grid grid-cols-3 gap-3">
              <div className="card p-3"><div className="text-xl font-bold text-gray-800">{baseForUser.size}</div><div className="text-xs text-gray-500">افتراضي الدور</div></div>
              <div className="card p-3"><div className="text-xl font-bold text-brand-700">{Object.keys(ov).length}</div><div className="text-xs text-gray-500">استثناء خاص</div></div>
              <div className="card p-3"><div className="text-xl font-bold text-amber-700">{[...SENSITIVE].filter((k) => (ov[k] !== undefined ? ov[k] : baseForUser.has(k))).length}</div><div className="text-xs text-gray-500">حساس فعّال</div></div>
            </div>
          )}
          <Groups
            checkedOf={(k) => (ov[k] !== undefined ? ov[k] : baseForUser.has(k))}
            overriddenOf={(k) => ov[k] !== undefined}
            onToggle={toggleUser}
          />
        </>
      )}
    </div>
  );
}

function Groups({ checkedOf, onToggle, overriddenOf, baselineOf }: { checkedOf: (k: string) => boolean; onToggle: (k: string, c: boolean) => void; overriddenOf?: (k: string) => boolean; baselineOf?: (k: string) => boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {PERM_GROUPS.map((g) => (
        <div key={g.section} className="card p-4">
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
            <div className="font-semibold text-gray-700">{g.title}</div>
            <div className="text-xs text-gray-400">{g.items.filter((it) => checkedOf(it.key)).length}/{g.items.length}</div>
          </div>
          <div className="space-y-1.5">
            {g.items.map((it) => (
              <label key={it.key} className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50 ${overriddenOf?.(it.key) ? "bg-brand-50/60" : ""} ${SENSITIVE.has(it.key) ? "border border-red-100 bg-red-50/30" : ""}`}>
                <span className="text-gray-700">
                  {it.label}{overriddenOf?.(it.key) ? " •" : ""}
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {it.adminOnly && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">أدمن فقط</span>}
                    {SENSITIVE.has(it.key) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">حساسة</span>}
                    {baselineOf && baselineOf(it.key) !== checkedOf(it.key) && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">مختلفة عن القالب</span>}
                  </span>
                </span>
                <input type="checkbox" checked={checkedOf(it.key)} onChange={(e) => onToggle(it.key, e.target.checked)} className="h-4 w-4 accent-brand-600" />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
