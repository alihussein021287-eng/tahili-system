import { requireSession } from "@/lib/access";
import { PageHeader } from "@/components/PageHeader";
import { ROLE_LABELS } from "@/lib/permissions";
import { changeOwnPassword } from "./actions";

export const dynamic = "force-dynamic";

export default async function Account() {
  const session = await requireSession();
  const name = session?.user?.name ?? "";
  const role = (session?.user as any)?.role;

  return (
    <div className="max-w-md space-y-5">
      <PageHeader title="حسابي" subtitle="إعدادات الحساب وكلمة السر" icon="👤" />
      <div className="card p-5 text-sm">
        <div className="mb-1"><span className="text-gray-500">الاسم:</span> <span className="font-medium">{name}</span></div>
        <div><span className="text-gray-500">الدور:</span> <span className="font-medium">{ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? "—"}</span></div>
      </div>

      <form action={changeOwnPassword} className="card space-y-3 p-5">
        <h2 className="font-semibold text-gray-700">تغيير كلمة السر</h2>
        <div><label className="label">كلمة السر الحالية</label><input className="input" name="current" type="password" required /></div>
        <div><label className="label">كلمة السر الجديدة</label><input className="input" name="next" type="password" required /></div>
        <div><label className="label">تأكيد كلمة السر الجديدة</label><input className="input" name="confirm" type="password" required /></div>
        <button className="btn-primary" type="submit">تغيير</button>
      </form>
    </div>
  );
}
