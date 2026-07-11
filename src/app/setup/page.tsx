import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { completeSetup } from "./actions";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const activeAdmin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  if (activeAdmin) redirect("/login");

  const org = await prisma.orgSetting.findUnique({ where: { id: 1 } }).catch(() => null);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10" dir="rtl">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تهيئة النظام لأول مرة</h1>
          <p className="mt-1 text-sm text-gray-500">تظهر هذه الصفحة فقط عند عدم وجود مدير نظام فعّال.</p>
        </div>

        <form action={completeSetup} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">اسم المستخدم المدير</label>
              <input name="username" className="input" defaultValue="admin" required />
            </div>
            <div>
              <label className="label">اسم المدير</label>
              <input name="fullName" className="input" defaultValue="مدير النظام" required />
            </div>
            <div>
              <label className="label">كلمة سر قوية</label>
              <input name="password" className="input" type="password" required />
            </div>
            <div>
              <label className="label">تأكيد كلمة السر</label>
              <input name="confirm" className="input" type="password" required />
            </div>
            <div>
              <label className="label">اسم المجمع</label>
              <input name="name" className="input" defaultValue={org?.name || "المجمع التأهيلي الطبي"} required />
            </div>
            <div>
              <label className="label">العنوان الفرعي</label>
              <input name="subtitle" className="input" defaultValue={org?.subtitle || ""} />
            </div>
            <div>
              <label className="label">العنوان</label>
              <input name="address" className="input" defaultValue={org?.address || ""} />
            </div>
            <div>
              <label className="label">الهاتف</label>
              <input name="phone" className="input" defaultValue={org?.phone || ""} />
            </div>
            <div className="md:col-span-2">
              <label className="label">رابط الشعار</label>
              <input name="logoUrl" className="input" defaultValue={org?.logoUrl || ""} placeholder="/official/hashd-logo.png" />
            </div>
          </div>
          <div className="mt-5">
            <button type="submit" className="btn-primary">إكمال التهيئة</button>
          </div>
        </form>
      </div>
    </main>
  );
}
