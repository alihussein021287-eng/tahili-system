import { requireSession } from "@/lib/access";
import { Combobox } from "@/components/Combobox";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { canManageUsers, ROLE_LABELS } from "@/lib/permissions";
import { createUser } from "./actions";
import { fmtDate } from "@/lib/labels";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]: any) => ({ value, label }));

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; status?: string; branch?: string }> }) {
  const session = await requireSession();
  if (!canManageUsers((session?.user as any)?.role)) redirect("/");
  const sp = await searchParams;
  const where: any = {};
  const q = (sp.q ?? "").trim();
  if (q) where.OR = [
    { username: { contains: q, mode: "insensitive" } },
    { fullName: { contains: q, mode: "insensitive" } },
    { department: { contains: q, mode: "insensitive" } },
    { jobTitle: { contains: q, mode: "insensitive" } },
  ];
  if (sp.role) where.role = sp.role;
  if (sp.status === "active") where.isActive = true;
  if (sp.status === "disabled") where.isActive = false;
  if (sp.branch) where.branchId = Number(sp.branch);

  const [branches, users, total, active, disabled] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where, include: { branch: true }, orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] }),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: false } }),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="إدارة المستخدمين" subtitle="الحسابات والأدوار والصلاحيات" icon="⚙" />

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4"><div className="text-2xl font-bold text-gray-800">{total}</div><div className="text-sm text-gray-500">إجمالي المستخدمين</div></div>
        <div className="card p-4"><div className="text-2xl font-bold text-emerald-700">{active}</div><div className="text-sm text-gray-500">حسابات فعالة</div></div>
        <div className="card p-4"><div className="text-2xl font-bold text-red-700">{disabled}</div><div className="text-sm text-gray-500">حسابات معطلة</div></div>
      </div>

      <form action={createUser} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><label className="label">اسم المستخدم</label><input className="input" name="username" required  autoComplete="off" /></div>
        <div><label className="label">الاسم الكامل</label><input className="input" name="fullName" required  autoComplete="off" /></div>
        <div><label className="label">كلمة المرور المؤقتة</label><input className="input" name="password" type="password" required placeholder="يسلمها المدير للمستخدم خارج النظام" autoComplete="new-password" /></div>
        <div><label className="label">الدور</label>
<Combobox name="role" allowFree={false} options={ROLE_OPTIONS} />
        </div>
        <div><label className="label">الفرع</label>
<Combobox name="branchId" allowFree={false} placeholder="بدون" options={branches.map((b:any)=>({value:String(b.id),label:b.name}))} />
        </div>
        <div><label className="label">المسمّى الوظيفي</label><input className="input" name="jobTitle"  autoComplete="off" /></div>
        <div><label className="label">القسم/الشعبة</label><input className="input" name="department"  autoComplete="off" /></div>
        <div><label className="label">البريد (اختياري)</label><input className="input" name="email"  autoComplete="off" /></div>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" name="activateImmediately" value="1" /> تفعيل الحساب مباشرة بهذه الكلمة (خيار إداري صريح)</label>
        <div className="flex items-end"><button className="btn-primary w-full" type="submit">إضافة مستخدم</button></div>
      </form>

      <form action="/users" className="card grid gap-2 p-3 md:grid-cols-5">
        <div className="md:col-span-2"><label className="label">بحث</label><input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="اسم، مستخدم، قسم، مسمى وظيفي" /></div>
        <Combobox name="role" label="الدور" allowFree={false} defaultValue={sp.role ?? ""} placeholder="كل الأدوار" options={[{ value: "", label: "كل الأدوار" }, ...ROLE_OPTIONS]} />
        <Combobox name="status" label="الحالة" allowFree={false} defaultValue={sp.status ?? ""} options={[{ value: "", label: "كل الحالات" }, { value: "active", label: "فعّال" }, { value: "disabled", label: "معطّل" }]} />
        <Combobox name="branch" label="الفرع" allowFree={false} defaultValue={sp.branch ?? ""} placeholder="كل الفروع" options={[{ value: "", label: "كل الفروع" }, ...branches.map((b:any)=>({value:String(b.id),label:b.name}))]} />
        <div className="flex items-end gap-2 md:col-span-5">
          <button className="btn-primary" type="submit">تصفية</button>
          <Link href="/users" className="btn-ghost">مسح</Link>
          <span className="text-sm text-gray-400">المعروض: {users.length}</span>
        </div>
      </form>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead><tr>
            <th className="th">المستخدم</th><th className="th">الاسم</th><th className="th">الدور</th>
            <th className="th">القسم/الفرع</th><th className="th">الحالة</th><th className="th">آخر دخول</th><th className="th">إجراءات</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="td">{u.username}</td>
                <td className="td">
                  <Link href={`/users/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.fullName}</Link>
                  {u.jobTitle && <div className="text-xs text-gray-400">{u.jobTitle}</div>}
                </td>
                <td className="td">{ROLE_LABELS[u.role]}</td>
                <td className="td">
                  <div>{u.department || "—"}</div>
                  <div className="text-xs text-gray-400">{u.branch?.name || "بدون فرع"}</div>
                </td>
                <td className="td">{u.isActive
                  ? <span className="badge-success">فعّال</span>
                  : <span className="badge-danger">معطّل</span>}</td>
                <td className="td">{fmtDate(u.lastLoginAt)}</td>
                <td className="td">
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/users/${u.id}`} className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">إدارة</Link>
                    <Link href={`/users/${u.id}?tab=security`} className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">الأمان</Link>
                    <Link href={`/users/${u.id}?tab=perms`} className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">الصلاحيات</Link>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={7}>لا توجد نتائج مطابقة.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
