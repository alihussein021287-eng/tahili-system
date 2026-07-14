import { requirePerm, getSession } from "@/lib/access";
import { Combobox } from "@/components/Combobox";
import Link from "next/link";
import { maintenanceOn } from "@/lib/maintenance";
import { getOrg } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { addCenter, addInjuryType, addDistrict, addFormation,
  addRank, deleteRank, deleteCenter, deleteInjuryType, deleteFormation, deleteDistrict, saveOrg, saveRetention, saveExpenseApprovalLevels, saveAdminConfig, setMaintenanceMode, addBranch, deleteBranch, toggleBranch, addMobilityAid, deleteMobilityAid, addProstheticType, deleteProstheticType } from "./actions";

export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requirePerm("settings.view");
  const org = await getOrg();
  const session = await getSession();
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  const maint = await maintenanceOn();
  const messages = await searchParams;
  const retention = await prisma.orgSetting.findUnique({ where: { id: 1 }, select: { notifRetentionDays: true, loginLogRetentionDays: true, expenseApprovalLevels: true, adminConfig: true } });
  const cfg = (retention?.adminConfig ?? {}) as Record<string, any>;
  const [branches, mobilityAids, prostheticTypes, centers, injuries, governorates, formations, ranks] = await Promise.all([
    prisma.branch.findMany({ include: { _count: { select: { users: true, patients: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.mobilityAid.findMany({ orderBy: { name: "asc" } }),
    prisma.prostheticType.findMany({ orderBy: { name: "asc" } }),
    prisma.center.findMany({ orderBy: { name: "asc" } }),
    prisma.injuryType.findMany({ orderBy: { name: "asc" } }),
    prisma.governorate.findMany({ include: { districts: { orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
    prisma.formation.findMany({ orderBy: { name: "asc" } }),
    prisma.rank.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="الإعدادات" subtitle="هوية المركز والقوائم الثابتة" icon="🛠" />
      {messages.saved && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{messages.saved}</div>}
      {messages.error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{messages.error}</div>}
      <nav className="flex gap-2 overflow-x-auto rounded-lg border bg-white p-2 text-sm" aria-label="أقسام الإعدادات">
        {[["هوية النظام","هوية النظام"],["الدوام والمواعيد","سياسات النظام"],["العلاج والمراكز","سياسات النظام"],["الأمان والجلسات","الأمان والجلسات"],["الإشعارات","سياسات النظام"],["الملفات والطباعة","سياسات النظام"],["النسخ والاحتفاظ","النسخ والاحتفاظ"],["القوائم والفروع","القوائم والفروع"]].map(([label,target]) => <a key={label} href={`#${target}`} className="shrink-0 rounded px-3 py-2 hover:bg-gray-100">{label}</a>)}
      </nav>

      {isAdmin && <form id="سياسات النظام" action={saveAdminConfig} className="card grid gap-4 p-5 md:grid-cols-3">
        <div className="md:col-span-3"><h2 className="font-semibold text-gray-800">سياسات التشغيل والعلاج والأمان</h2><p className="text-sm text-gray-500">قيم افتراضية مركزية مع تحقق خادمي وسجل للقيمة السابقة والجديدة.</p></div>
        <label className="label">المنطقة الزمنية<Combobox name="timezone" allowFree={false} defaultValue={cfg.timezone ?? "Asia/Baghdad"} options={[{value:"Asia/Baghdad",label:"بغداد"},{value:"UTC",label:"UTC"}]} /></label>
        <label className="label">اللغة<Combobox name="locale" allowFree={false} defaultValue={cfg.locale ?? "ar-IQ"} options={[{value:"ar-IQ",label:"العربية - العراق"},{value:"en-US",label:"English"}]} /></label>
        <label className="label">تنسيق التاريخ<input name="dateFormat" className="input" defaultValue={cfg.dateFormat ?? "yyyy/MM/dd"} /></label>
        <div className="md:col-span-3"><span className="label">أيام الدوام</span><div className="flex flex-wrap gap-3">{["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"].map((d,i)=><label key={d} className="text-sm"><input type="checkbox" name="workDays" value={i} defaultChecked={(cfg.workDays ?? [0,1,2,3,4]).includes(String(i))} /> {d}</label>)}</div></div>
        <label className="label">بداية الدوام<input type="time" name="workStart" className="input" defaultValue={cfg.workStart ?? "08:00"} /></label>
        <label className="label">نهاية الدوام<input type="time" name="workEnd" className="input" defaultValue={cfg.workEnd ?? "15:00"} /></label>
        <label className="label">العطل الرسمية<input name="holidays" className="input" defaultValue={cfg.holidays ?? ""} placeholder="2026-01-01, 2026-..." /></label>
        {[['appointmentMinutes','مدة الموعد الافتراضية',30],['defaultSessions','عدد الجلسات الافتراضي',10],['defaultPlanDays','مدة الخطة الافتراضية',30],['evaluationEvery','دورية التقييم الافتراضية',5],['weakImprovementThreshold','تنبيه ضعف التحسن %',20],['loginAttempts','محاولات الدخول',5],['lockMinutes','مدة قفل الحساب',15],['sessionMinutes','مدة الجلسة',480],['maxUploadMb','أقصى رفع (MB)',10],['backupRetentionDays','احتفاظ النسخ (يوم)',30]].map(([key,label,def])=><label key={String(key)} className="label">{label}<input type="number" name={String(key)} className="input" defaultValue={cfg[String(key)] ?? def} /></label>)}
        <label className="label">أنواع الملفات<input name="fileTypes" className="input" defaultValue={(cfg.fileTypes ?? ['pdf','jpg','jpeg','png']).join(',')} /></label>
        <label className="label">بادئة الملفات<input name="fileNumberPrefix" className="input" defaultValue={cfg.fileNumberPrefix ?? "PAT"} /></label>
        <label className="label">بادئة التقارير<input name="reportNumberPrefix" className="input" defaultValue={cfg.reportNumberPrefix ?? "REP"} /></label>
        <div className="md:col-span-3"><button className="btn-primary">حفظ سياسات النظام</button></div>
      </form>}

      {isAdmin && (
        <div id="الأمان والجلسات" className={`card border p-5 ${maint ? "border-red-300 bg-red-50" : "border-gray-200"}`}>
          <h2 className="mb-1 font-semibold text-gray-800">وضع الصيانة <span className="text-sm font-normal text-red-600">(خطر — للأدمن فقط)</span></h2>
          <p className="mb-3 text-sm text-gray-600">عند التفعيل تظهر «منطقة الصيانة» التي تسمح بمسح البيانات بشكل انتقائي (لترتيب النظام قبل الإطلاق). أطفئه فور الانتهاء.</p>
          <div className="flex flex-wrap items-center gap-3">
            <form action={setMaintenanceMode.bind(null, !maint)}>
              <button className={maint ? "rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800" : "rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"} type="submit">
                {maint ? "إيقاف وضع الصيانة" : "تفعيل وضع الصيانة"}
              </button>
            </form>
            {maint && <Link href="/maintenance" className="btn-danger">افتح منطقة الصيانة ←</Link>}
            <span className={`badge ${maint ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>{maint ? "مُفعّل" : "متوقف"}</span>
          </div>
        </div>
      )}

      <div id="هوية النظام" className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-700">هوية المركز (تظهر في التقارير والوصولات والبطاقات)</h2>
        <form action={saveOrg} className="grid gap-3 md:grid-cols-2">
          <div><label className="label">اسم المركز</label><input name="name" className="input" defaultValue={org.name} /></div>
          <div><label className="label">العنوان الفرعي</label><input name="subtitle" className="input" defaultValue={org.subtitle} placeholder="مثل: دائرة صحة..." /></div>
          <div><label className="label">العنوان</label><input name="address" className="input" defaultValue={org.address} /></div>
          <div><label className="label">الهاتف</label><input name="phone" className="input" defaultValue={org.phone} /></div>
          <div className="md:col-span-2"><label className="label">رابط الشعار</label><input name="logoUrl" className="input" defaultValue={org.logoUrl} placeholder="/official/hashd-logo.png أو رابط داخلي" /></div>
          <div className="md:col-span-2"><button className="btn-primary" type="submit">حفظ هوية المركز</button></div>
        </form>
      </div>

      {isAdmin && (
        <div className="card p-5">
          <h2 className="mb-1 font-semibold text-gray-700">حالة التهيئة الأولية</h2>
          <p className="text-sm text-gray-500">النظام مهيأ مسبقاً إذا كان يوجد مدير فعّال وهوية مركز محفوظة. صفحة الإعدادات هي مكان تعديل هذه القيم بعد أول تشغيل.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="badge-success">تسجيل الدخول الحالي محفوظ</span>
            <Link href="/readiness" className="rounded-lg bg-brand-50 px-3 py-1.5 text-brand-700 hover:bg-brand-100">فحص الجاهزية ←</Link>
          </div>
        </div>
      )}

      {isAdmin && (
        <div id="النسخ والاحتفاظ" className="card p-5">
          <h2 className="mb-1 font-semibold text-gray-700">مدد الاحتفاظ بالسجلات</h2>
          <p className="mb-3 text-sm text-gray-500">
            يُنظّف النظام السجلات القديمة تلقائياً مع النسخة الاحتياطية اليومية.
            <span className="font-medium text-gray-700"> سجل التدقيق (المساءلة الرسمية) محفوظ دائماً ولا يُمسّ.</span>
          </p>
          <form action={saveRetention} className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">الإشعارات المقروءة (يوم)</label>
              <input name="notifRetentionDays" type="number" min={1} max={3650} className="input" defaultValue={retention?.notifRetentionDays ?? 30} />
              <p className="mt-1 text-xs text-gray-400">تُحذف الإشعارات المقروءة الأقدم من هذه المدة.</p>
            </div>
            <div>
              <label className="label">سجل الدخول (يوم)</label>
              <input name="loginLogRetentionDays" type="number" min={1} max={3650} className="input" defaultValue={retention?.loginLogRetentionDays ?? 180} />
              <p className="mt-1 text-xs text-gray-400">يُحذف سجل محاولات الدخول الأقدم من هذه المدة.</p>
            </div>
            <div className="md:col-span-2"><button className="btn-primary" type="submit">حفظ مدد الاحتفاظ</button></div>
          </form>
        </div>
      )}

      {isAdmin && <div className="card p-5"><h2 className="font-semibold text-gray-700">سياسة اعتماد صرفيات الجرحى</h2><p className="mt-1 text-sm text-gray-500">حدد عدد مستويات الاعتماد المطلوبة قبل تجهيز السند للصرف.</p><form action={saveExpenseApprovalLevels} className="mt-3 flex items-end gap-3"><label className="label">عدد المستويات<input name="expenseApprovalLevels" type="number" min="1" max="5" className="input mt-1 !w-28" defaultValue={retention?.expenseApprovalLevels||1}/></label><button className="btn-primary">حفظ السياسة</button></form></div>}

      <h2 id="القوائم والفروع" className="text-lg font-bold text-gray-800">القوائم الثابتة</h2>
      <p className="text-sm text-gray-500">القوائم تُستخدم لتوحيد الإدخال في بطاقة المريض والجلسات والوصفات.</p>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-700">المحافظات والمناطق</h2>
        <form action={addDistrict} className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
          <div>
            <label className="label">المحافظة</label>
<Combobox name="governorateId" allowFree={false} options={governorates.map((g:any)=>({value:String(g.id),label:g.name}))} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="label">اسم المنطقة الجديدة</label>
            <input name="name" className="input" placeholder="مثال: مدينة الصدر" />
          </div>
          <button className="btn-primary" type="submit">إضافة منطقة</button>
        </form>
        <div className="grid gap-3 md:grid-cols-3">
          {governorates.map((g) => (
            <div key={g.id} className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2 font-medium text-gray-800">{g.name} <span className="text-xs text-gray-400">({g.districts.length})</span></div>
              <div className="flex flex-wrap gap-1">
                {g.districts.map((d) => (
                  <span key={d.id} className="badge flex items-center gap-1 bg-gray-100 text-gray-600">
                    {d.name}
                    <form action={deleteDistrict.bind(null, d.id)}><button className="text-red-500 hover:text-red-700" title="حذف">×</button></form>
                  </span>
                ))}
                {g.districts.length === 0 && <span className="text-xs text-gray-400">لا مناطق</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <BranchCard items={branches} />

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <LookupCard title="مساعدات الحركة" items={mobilityAids} action={addMobilityAid} del={deleteMobilityAid} />
        <LookupCard title="الأطراف الصناعية (أنواع)" items={prostheticTypes} action={addProstheticType} del={deleteProstheticType} />
        <LookupCard title="المراكز العلاجية" items={centers} action={addCenter} del={deleteCenter} />
        <LookupCard title="أنواع الإصابات" items={injuries} action={addInjuryType} del={deleteInjuryType} />
        <LookupCard title="التشكيلات" items={formations} action={addFormation} del={deleteFormation} />
        <LookupCard title="الصفات" items={ranks} action={addRank} del={deleteRank} />
      </div>

    </div>
  );
}

function BranchCard({ items }: any) {
  const active = items.filter((b: any) => b.isActive).length;
  const users = items.reduce((sum: number, b: any) => sum + (b._count?.users ?? 0), 0);
  const patients = items.reduce((sum: number, b: any) => sum + (b._count?.patients ?? 0), 0);
  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">إدارة الفروع</h2>
          <p className="mt-1 text-sm text-gray-500">تعطيل الفرع يخفيه من قوائم الاختيار الجديدة دون حذف السجلات المرتبطة.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="badge-success">{active} فعّال</span>
          <span className="badge-neutral">{users} مستخدم</span>
          <span className="badge-neutral">{patients} مراجع</span>
        </div>
      </div>
      <form action={addBranch} className="mb-4 flex flex-wrap items-end gap-2 rounded-xl bg-gray-50 p-3">
        <div className="min-w-[220px] flex-1">
          <label className="label">اسم الفرع الجديد</label>
          <input name="name" className="input" placeholder="مثال: فرع بغداد" />
        </div>
        <button className="btn-primary" type="submit">إضافة فرع</button>
      </form>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map((b: any) => {
          const used = (b._count?.users ?? 0) + (b._count?.patients ?? 0);
          return (
            <div key={b.id} className={`rounded-xl border p-4 ${b.isActive ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50 opacity-80"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-800">{b.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    <span className={b.isActive ? "badge-success" : "badge-neutral"}>{b.isActive ? "فعّال" : "معطّل"}</span>
                    <span className="badge-neutral">{b._count?.users ?? 0} مستخدم</span>
                    <span className="badge-neutral">{b._count?.patients ?? 0} مراجع</span>
                  </div>
                </div>
                <form action={toggleBranch.bind(null, b.id, !b.isActive)}>
                  <button className={b.isActive ? "btn-warning btn-sm" : "btn-primary btn-sm"} type="submit">{b.isActive ? "تعطيل" : "تفعيل"}</button>
                </form>
              </div>
              {used === 0 ? (
                <form action={deleteBranch.bind(null, b.id)} className="mt-3">
                  <button className="text-xs font-medium text-red-600 hover:underline" type="submit">حذف نهائي</button>
                </form>
              ) : (
                <p className="mt-3 text-xs text-gray-400">الحذف غير مفضل لأن الفرع مرتبط بسجلات. استخدم التعطيل.</p>
              )}
            </div>
          );
        })}
        {items.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center text-sm text-gray-400">لا توجد فروع بعد.</div>}
      </div>
    </div>
  );
}

function LookupCard({ title, items, action, del }: any) {
  return (
    <div className="card p-4">
      <h2 className="mb-3 font-semibold text-gray-700">{title}</h2>
      <form action={action} className="mb-3 flex gap-2">
        <input name="name" className="input" placeholder="إضافة جديد..." />
        <button className="btn-primary" type="submit">+</button>
      </form>
      <ul className="space-y-1 text-sm">
        {items.map((i: any) => (
          <li key={i.id} className="flex items-center justify-between rounded bg-gray-50 px-3 py-1.5">
            <span>{i.name}</span>
            <form action={del.bind(null, i.id)}><button className="text-red-500 hover:text-red-700" title="حذف">×</button></form>
          </li>
        ))}
        {items.length === 0 && <li className="text-gray-400">فارغة.</li>}
      </ul>
    </div>
  );
}
