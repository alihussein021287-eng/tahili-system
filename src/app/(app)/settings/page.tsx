import Link from "next/link";
import type { ReactNode } from "react";
import { currentPerms, getSession, requirePerm } from "@/lib/access";
import { getAdminConfig } from "@/lib/admin-config";
import { collaborationSettings } from "@/lib/collaboration-service";
import { checkClamAvStatus } from "@/lib/collaboration-scan";
import { prisma } from "@/lib/db";
import { maintenanceOn } from "@/lib/maintenance";
import { getOrg } from "@/lib/org";
import { queueHallNames } from "@/lib/queue";
import { getLibreOfficeStatus } from "@/lib/collaboration-office-preview";
import { PageHeader } from "@/components/PageHeader";
import { DisplaySettings } from "./DisplaySettings";
import {
  addBranch,
  addCenter,
  addDistrict,
  addFormation,
  addInjuryType,
  addMobilityAid,
  addProstheticType,
  addRank,
  deleteBranch,
  deleteCenter,
  deleteDistrict,
  deleteFormation,
  deleteInjuryType,
  deleteMobilityAid,
  deleteProstheticType,
  deleteRank,
  saveBackupAction,
  saveClamAvAction,
  saveExpenseApprovalLevels,
  saveFilesAction,
  saveIdentityAction,
  saveNotificationsAction,
  saveOfficePreviewAction,
  saveOperationsAction,
  savePresenceAction,
  saveReadinessAction,
  saveSecurityAction,
  saveTherapyAction,
  setMaintenanceMode,
  toggleBranch,
} from "./actions";
import {
  ConfirmSubmitButton,
  LookupSearchInput,
  SettingsActionForm,
  SettingsTabSelect,
  SmallSubmitButton,
  SubmitButton,
} from "./SettingsControls";

export const dynamic = "force-dynamic";

type TabKey = "identity" | "operations" | "therapy" | "security" | "notifications" | "files" | "backup" | "lookups";

const TABS: { key: TabKey; label: string; title: string; description: string }[] = [
  { key: "identity", label: "هوية النظام", title: "هوية النظام", description: "الاسم العام وبيانات الترويسة الرسمية المستخدمة في التقارير والطباعة." },
  { key: "operations", label: "الدوام والمواعيد", title: "الدوام والمواعيد", description: "المنطقة الزمنية، تنسيق التاريخ، أيام وساعات الدوام، ومدة الموعد الافتراضية." },
  { key: "therapy", label: "العلاج والمراكز", title: "العلاج والمراكز", description: "القيم الافتراضية للخطط العلاجية ومراجعة ارتباط المراكز والقاعات." },
  { key: "security", label: "الأمان والجلسات", title: "الأمان والجلسات", description: "قفل الحساب، مدة الجلسات الجديدة، وسياسات كلمة المرور." },
  { key: "notifications", label: "الإشعارات", title: "الإشعارات", description: "أنواع الإشعارات، مدد الاحتفاظ، ومنع التكرار." },
  { key: "files", label: "الملفات والطباعة", title: "الملفات والطباعة", description: "سياسة الرفع، PDF، الطباعة الرسمية، شاشات الانتظار ومركز التعاون." },
  { key: "backup", label: "النسخ والاحتفاظ", title: "النسخ والاحتفاظ", description: "النسخ التلقائي ومدد الاحتفاظ مع روابط الفحص والنسخ دون تنفيذ استعادة من هنا." },
  { key: "lookups", label: "القوائم والفروع", title: "القوائم والفروع", description: "المناطق والفروع والمراكز والتشكيلات والصفات وأنواع الإصابات ومساعدات الحركة." },
];

const DAY_LABELS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const NOTIFICATION_TYPES = [
  ["appointments", "المواعيد"],
  ["tasks", "المهام"],
  ["results", "النتائج والفحوص"],
  ["inventory", "المخزون"],
  ["system", "النظام"],
] as const;

function normalizeTab(raw?: string): TabKey {
  return TABS.some((tab) => tab.key === raw) ? (raw as TabKey) : "identity";
}

function tabHref(key: TabKey) {
  return `/settings?tab=${key}`;
}

function fieldValue<T>(value: T | null | undefined, fallback: T) {
  return value ?? fallback;
}

function canDeleteCount(item: any) {
  const counts = item?._count ? Object.values(item._count).filter((value): value is number => typeof value === "number") : [];
  return counts.reduce((sum, value) => sum + value, 0);
}

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; saved?: string; error?: string; card?: string }>;
}) {
  await requirePerm("settings.view");
  const params = await searchParams;
  const activeTab = normalizeTab(params.tab);
  const activeInfo = TABS.find((tab) => tab.key === activeTab)!;
  const [perms, session, org, cfg, orgRow] = await Promise.all([
    currentPerms(),
    getSession(),
    getOrg(),
    getAdminConfig(),
    prisma.orgSetting.findUnique({
      where: { id: 1 },
      select: {
        notifRetentionDays: true,
        loginLogRetentionDays: true,
        autoBackup: true,
        expenseApprovalLevels: true,
      },
    }),
  ]);
  const canEdit = perms.has("settings.edit");
  const canBackup = perms.has("settings.backup");
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  const navTabs = TABS.map((tab) => ({ key: tab.key, label: tab.label, href: tabHref(tab.key) }));

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="الإعدادات" subtitle="إعدادات فعلية مقسمة حسب المجال، مع حفظ مستقل لكل بطاقة" icon="🛠" />

      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <SettingsTabSelect tabs={navTabs} active={activeTab} />
        <nav className="hidden gap-2 overflow-x-auto md:flex" aria-label="تبويبات الإعدادات">
          {navTabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
                activeTab === tab.key ? "bg-brand-700 text-white" : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
        <h1 className="text-xl font-bold text-gray-900">{activeInfo.title}</h1>
        <p className="mt-1 text-sm text-gray-600">{activeInfo.description}</p>
        {!canEdit ? <p className="mt-3 text-sm text-amber-700">لديك صلاحية عرض فقط؛ أزرار التعديل مخفية والحفظ مرفوض خادمياً.</p> : null}
      </section>

      {activeTab === "identity" ? <IdentityTab org={org} canEdit={canEdit} message={params} /> : null}
      {activeTab === "operations" ? <OperationsTab cfg={cfg} canEdit={canEdit} /> : null}
      {activeTab === "therapy" ? <TherapyTab cfg={cfg} canEdit={canEdit} /> : null}
      {activeTab === "security" ? <SecurityTab cfg={cfg} canEdit={canEdit} isAdmin={isAdmin} message={params} /> : null}
      {activeTab === "notifications" ? <NotificationsTab cfg={cfg} orgRow={orgRow} canEdit={canEdit} /> : null}
      {activeTab === "files" ? <FilesTab cfg={cfg} canEdit={canEdit} isAdmin={isAdmin} /> : null}
      {activeTab === "backup" ? <BackupTab cfg={cfg} orgRow={orgRow} canEdit={canEdit} canBackup={canBackup} message={params} /> : null}
      {activeTab === "lookups" ? <LookupsTab canEdit={canEdit} isAdmin={isAdmin} message={params} /> : null}
    </div>
  );
}

function QueryMessage({ message, card }: { message?: { saved?: string; error?: string; card?: string }; card: string }) {
  if (!message || message.card !== card || (!message.saved && !message.error)) return null;
  const ok = Boolean(message.saved);
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
      {message.saved || message.error}
    </div>
  );
}

function Card({
  id,
  title,
  description,
  children,
  message,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  message?: { saved?: string; error?: string; card?: string };
}) {
  return (
    <section id={id} className="card min-w-0 space-y-4 p-5">
      <div>
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
      </div>
      <QueryMessage message={message} card={id} />
      {children}
    </section>
  );
}

function TextInput({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
  unit,
  hint,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  unit?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number | string;
  disabled?: boolean;
}) {
  return (
    <label className="label min-w-0">
      <span>
        {label} {required ? <span className="text-red-600">*</span> : null}
      </span>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <input
          name={name}
          type={type}
          required={required}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="input min-w-0 flex-1"
          defaultValue={defaultValue ?? ""}
        />
        {unit ? <span className="shrink-0 rounded-md bg-gray-100 px-2 py-2 text-xs text-gray-600">{unit}</span> : null}
      </div>
      {hint ? <span className="mt-1 block text-xs text-gray-400">{hint}</span> : null}
    </label>
  );
}

function SelectInput({
  label,
  name,
  defaultValue,
  options,
  disabled,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  options: { value: string | number; label: string }[];
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="label min-w-0">
      {label}
      <select name={name} className="input mt-1" defaultValue={defaultValue ?? ""} disabled={disabled}>
        {options.map((option) => (
          <option key={String(option.value)} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <span className="mt-1 block text-xs text-gray-400">{hint}</span> : null}
    </label>
  );
}

function IdentityTab({ org, canEdit, message }: { org: Awaited<ReturnType<typeof getOrg>>; canEdit: boolean; message: any }) {
  return (
    <div className="space-y-5">
      <Card id="identity-main" title="الاسم والاتصال" description="هذه البيانات تظهر في واجهة النظام وعدد من النماذج العامة." message={message}>
        <SettingsActionForm action={saveIdentityAction} className="space-y-4">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-2">
            <TextInput label="اسم النظام" name="name" defaultValue={org.name} required disabled={!canEdit} />
            <TextInput label="العنوان الفرعي" name="subtitle" defaultValue={org.subtitle} disabled={!canEdit} />
            <TextInput label="العنوان" name="address" defaultValue={org.address} disabled={!canEdit} />
            <TextInput label="الهاتف" name="phone" defaultValue={org.phone} disabled={!canEdit} />
            <div className="md:col-span-2">
              <TextInput label="رابط الشعار" name="logoUrl" defaultValue={org.logoUrl} hint="استخدم مساراً داخلياً مثل /official/logo.png أو رابط http/https." disabled={!canEdit} />
              {org.logoUrl ? (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <img src={org.logoUrl} alt="معاينة الشعار" className="max-h-24 max-w-full object-contain" />
                </div>
              ) : null}
            </div>
          </fieldset>

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <TextInput label="سطر الترويسة الرسمي 1" name="officialHeader1" defaultValue={org.officialHeader1} disabled={!canEdit} />
            <TextInput label="سطر الترويسة الرسمي 2" name="officialHeader2" defaultValue={org.officialHeader2} disabled={!canEdit} />
            <TextInput label="سطر الترويسة الرسمي 3" name="officialHeader3" defaultValue={org.officialHeader3} disabled={!canEdit} />
            <TextInput label="سطر الترويسة الرسمي 4" name="officialHeader4" defaultValue={org.officialHeader4} disabled={!canEdit} />
            <TextInput label="الشعار/الآية في الترويسة" name="officialMotto" defaultValue={org.officialMotto} disabled={!canEdit} />
            <TextInput label="مصدر الشعار" name="officialMottoSub" defaultValue={org.officialMottoSub} disabled={!canEdit} />
            <TextInput label="عنوان الطباعة الرسمي" name="officialAddress" defaultValue={org.officialAddress} disabled={!canEdit} />
            <TextInput label="هاتف الطباعة الرسمي" name="officialPhone" defaultValue={org.officialPhone} disabled={!canEdit} />
            <TextInput label="جهة المخاطبة الرسمية" name="officialToOffice" defaultValue={org.officialToOffice} hint="تظهر في النماذج الرسمية التي تستخدم صيغة إلى/مكتب." disabled={!canEdit} />
          </div>
          {canEdit ? <SubmitButton>حفظ هوية النظام</SubmitButton> : null}
        </SettingsActionForm>
      </Card>
    </div>
  );
}

function OperationsTab({ cfg, canEdit }: { cfg: Awaited<ReturnType<typeof getAdminConfig>>; canEdit: boolean }) {
  const workDays = new Set((cfg.workDays ?? ["0", "1", "2", "3", "4"]).map(String));
  return (
    <div className="space-y-5">
      <Card id="operations-time" title="المنطقة والتنسيق" description="استخدم select ثابت للقيم المحددة حتى لا تُحفظ صيغة غير مدعومة.">
        <SettingsActionForm action={saveOperationsAction} className="space-y-4">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-3">
            <SelectInput label="المنطقة الزمنية" name="timezone" defaultValue={cfg.timezone} disabled={!canEdit} options={[{ value: "Asia/Baghdad", label: "بغداد" }, { value: "UTC", label: "UTC" }]} />
            <SelectInput label="اللغة" name="locale" defaultValue={cfg.locale} disabled={!canEdit} options={[{ value: "ar-IQ", label: "العربية - العراق" }, { value: "en-US", label: "English" }]} />
            <SelectInput label="تنسيق التاريخ" name="dateFormat" defaultValue={cfg.dateFormat} disabled={!canEdit} options={[{ value: "yyyy/MM/dd", label: "yyyy/MM/dd" }, { value: "dd/MM/yyyy", label: "dd/MM/yyyy" }, { value: "yyyy-MM-dd", label: "yyyy-MM-dd" }]} />
            <TextInput label="بداية الدوام" name="workStart" type="time" defaultValue={cfg.workStart} disabled={!canEdit} />
            <TextInput label="نهاية الدوام" name="workEnd" type="time" defaultValue={cfg.workEnd} disabled={!canEdit} />
            <TextInput label="مدة الموعد الافتراضية" name="appointmentMinutes" type="number" min={5} max={480} unit="دقيقة" defaultValue={cfg.appointmentMinutes} hint="محفوظة كسياسة افتراضية؛ تعارض المواعيد الحالي يعتمد على وقت البداية فقط." required disabled={!canEdit} />
            <div className="md:col-span-3">
              <span className="label">أيام الدوام <span className="text-red-600">*</span></span>
              <div className="mt-2 flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                {DAY_LABELS.map((day, index) => (
                  <label key={day} className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" name="workDays" value={index} defaultChecked={workDays.has(String(index))} disabled={!canEdit} />
                    {day}
                  </label>
                ))}
              </div>
            </div>
            <label className="label md:col-span-3">
              العطل الرسمية
              <textarea name="holidays" className="input mt-1 min-h-24" defaultValue={cfg.holidays} placeholder="2026-01-01, 2026-03-21" disabled={!canEdit} />
              <span className="mt-1 block text-xs text-gray-400">اكتب تواريخ بصيغة YYYY-MM-DD مفصولة بفواصل أو أسطر.</span>
            </label>
          </fieldset>
          {canEdit ? <SubmitButton>حفظ الدوام والمواعيد</SubmitButton> : null}
        </SettingsActionForm>
      </Card>
    </div>
  );
}

async function TherapyTab({ cfg, canEdit }: { cfg: Awaited<ReturnType<typeof getAdminConfig>>; canEdit: boolean }) {
  const [centers, halls] = await Promise.all([
    prisma.center.findMany({
      include: {
        _count: { select: { memberships: true, resources: true, programs: true, centerSessions: true, treatmentPlans: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.therapyHall.findMany({
      include: { _count: { select: { centerResources: true, therapySessions: true, treatmentPlans: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  ]);
  return (
    <div className="space-y-5">
      <Card id="therapy-defaults" title="افتراضيات الخطط العلاجية" description="تستخدم كنقطة بداية عند إنشاء الخطط ولا تغيّر الخطط القديمة تلقائياً.">
        <SettingsActionForm action={saveTherapyAction} className="space-y-4">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-4">
            <TextInput label="عدد الجلسات الافتراضي" name="defaultSessions" type="number" min={1} max={365} defaultValue={cfg.defaultSessions} required disabled={!canEdit} />
            <TextInput label="مدة الخطة" name="defaultPlanDays" type="number" min={1} max={730} unit="يوم" defaultValue={cfg.defaultPlanDays} required disabled={!canEdit} />
            <TextInput label="دورية التقييم" name="evaluationEvery" type="number" min={1} max={365} unit="جلسة" defaultValue={cfg.evaluationEvery} required disabled={!canEdit} />
            <TextInput label="تنبيه ضعف التحسن" name="weakImprovementThreshold" type="number" min={0} max={100} unit="نسبة مئوية" defaultValue={cfg.weakImprovementThreshold} hint="محفوظة كعتبة إدارية؛ التنبيه الآلي حسبها يحتاج ربط لاحق." required disabled={!canEdit} />
          </fieldset>
          {canEdit ? <SubmitButton>حفظ إعدادات العلاج</SubmitButton> : null}
        </SettingsActionForm>
      </Card>

      <Card id="therapy-centers" title="المراكز والقاعات المرتبطة" description="إدارة أسماء المراكز من تبويب القوائم، وهذه البطاقة توضّح الارتباطات قبل أي تعديل.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 font-medium text-gray-800">المراكز العلاجية</div>
            <div className="space-y-2 text-sm">
              {centers.map((center) => (
                <div key={center.id} className="rounded-md bg-gray-50 p-2">
                  <div className="font-medium">{center.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-500">
                    <span className="badge-neutral">{center._count.memberships} عضوية</span>
                    <span className="badge-neutral">{center._count.resources} مورد/قاعة</span>
                    <span className="badge-neutral">{center._count.programs} برنامج</span>
                    <span className="badge-neutral">{center._count.centerSessions + center._count.treatmentPlans} علاج</span>
                  </div>
                </div>
              ))}
              {centers.length === 0 ? <div className="text-gray-400">لا توجد مراكز.</div> : null}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 font-medium text-gray-800">القاعات</div>
            <div className="space-y-2 text-sm">
              {halls.map((hall) => (
                <div key={hall.id} className="rounded-md bg-gray-50 p-2">
                  <div className="font-medium">{hall.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-500">
                    <span className={hall.active ? "badge-success" : "badge-neutral"}>{hall.active ? "فعالة" : "معطلة"}</span>
                    <span className="badge-neutral">{hall._count.centerResources} مورد</span>
                    <span className="badge-neutral">{hall._count.therapySessions + hall._count.treatmentPlans} ارتباط علاجي</span>
                  </div>
                </div>
              ))}
              {halls.length === 0 ? <div className="text-gray-400">لا توجد قاعات.</div> : null}
            </div>
          </div>
        </div>
        <Link href="/settings?tab=lookups" className="btn-ghost">فتح القوائم والفروع</Link>
      </Card>
    </div>
  );
}

async function SecurityTab({ cfg, canEdit, isAdmin, message }: { cfg: Awaited<ReturnType<typeof getAdminConfig>>; canEdit: boolean; isAdmin: boolean; message: any }) {
  const maint = await maintenanceOn();
  return (
    <div className="space-y-5">
      <Card id="security-login" title="قفل الدخول والجلسات" description="تغيير مدة الجلسة يؤثر على الجلسات الجديدة فقط، ولا يقطع الجلسات الحالية.">
        <SettingsActionForm action={saveSecurityAction} className="space-y-4">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-3">
            <TextInput label="محاولات الدخول" name="loginAttempts" type="number" min={3} max={20} defaultValue={cfg.loginAttempts} required disabled={!canEdit} />
            <TextInput label="مدة قفل الحساب" name="lockMinutes" type="number" min={5} max={1440} unit="دقيقة" defaultValue={cfg.lockMinutes} required disabled={!canEdit} />
            <TextInput label="مدة الجلسة" name="sessionMinutes" type="number" min={15} max={10080} unit="دقيقة" defaultValue={cfg.sessionMinutes} required disabled={!canEdit} />
            <TextInput label="الحد الأدنى لكلمة المرور" name="passwordMinLength" type="number" min={8} max={64} defaultValue={cfg.passwordMinLength} required disabled={!canEdit} />
            <div className="md:col-span-2">
              <span className="label">شروط كلمة المرور</span>
              <div className="mt-2 flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <label className="flex items-center gap-2"><input name="passwordRequireLetters" type="checkbox" defaultChecked={cfg.passwordRequireLetters} disabled={!canEdit} /> حروف</label>
                <label className="flex items-center gap-2"><input name="passwordRequireNumbers" type="checkbox" defaultChecked={cfg.passwordRequireNumbers} disabled={!canEdit} /> أرقام</label>
                <label className="flex items-center gap-2"><input name="passwordRequireSymbols" type="checkbox" defaultChecked={cfg.passwordRequireSymbols} disabled={!canEdit} /> رمز خاص</label>
              </div>
            </div>
          </fieldset>
          {canEdit ? <SubmitButton>حفظ الأمان والجلسات</SubmitButton> : null}
        </SettingsActionForm>
      </Card>

      <Card id="presence-policy" title="تواجد المستخدمين" description="هذه القيم تطبق على /users وعلى ping العام بعد تسجيل الدخول.">
        <SettingsActionForm action={savePresenceAction} className="space-y-4">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-3">
            <TextInput label="أونلاين خلال" name="onlineMinutes" type="number" min={1} max={60} unit="دقيقة" defaultValue={cfg.onlineMinutes} required disabled={!canEdit} />
            <TextInput label="خامل خلال" name="idleMinutes" type="number" min={2} max={240} unit="دقيقة" defaultValue={cfg.idleMinutes} hint="يجب أن تكون أكبر من مدة الأونلاين." required disabled={!canEdit} />
            <TextInput label="فاصل ping" name="pingIntervalSeconds" type="number" min={15} max={600} unit="ثانية" defaultValue={cfg.pingIntervalSeconds} required disabled={!canEdit} />
          </fieldset>
          {canEdit ? <SubmitButton>حفظ تواجد المستخدمين</SubmitButton> : null}
        </SettingsActionForm>
      </Card>

      {isAdmin ? (
        <Card id="maintenance" title="وضع الصيانة" description="يبقى حصرياً للأدمن لأنه يفتح منطقة عمليات خطرة. لا يؤثر على صلاحية settings.edit." message={message}>
          <div className={`rounded-lg border p-3 text-sm ${maint ? "border-red-200 bg-red-50 text-red-800" : "border-gray-200 bg-gray-50 text-gray-700"}`}>
            الحالة الحالية: {maint ? "مفعّل" : "متوقف"}
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <form action={setMaintenanceMode.bind(null, !maint)}>
                <SubmitButton>{maint ? "إيقاف وضع الصيانة" : "تفعيل وضع الصيانة"}</SubmitButton>
              </form>
            ) : null}
            {maint ? <Link href="/maintenance" className="btn-danger">فتح منطقة الصيانة</Link> : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function NotificationsTab({ cfg, orgRow, canEdit }: { cfg: Awaited<ReturnType<typeof getAdminConfig>>; orgRow: any; canEdit: boolean }) {
  const enabled = new Set((cfg.notificationTypes ?? []).map(String));
  return (
    <Card id="notifications-main" title="سياسة الإشعارات" description="منع التكرار مطبق عند إنشاء الإشعارات؛ ومدد الاحتفاظ تُستخدم في تنظيف السجلات المقروءة.">
      <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
        الأنواع، احتفاظ غير المقروءة، والتنبيهات المهمة محفوظة كسياسة إدارية، وتحتاج ربطاً أوسع قبل أن تتحكم بكل الإشعارات.
      </div>
      <SettingsActionForm action={saveNotificationsAction} className="space-y-4">
        <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-3">
          <div className="md:col-span-3">
            <span className="label">الأنواع المفعلة</span>
            <div className="mt-2 flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              {NOTIFICATION_TYPES.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input type="checkbox" name="notificationTypes" value={value} defaultChecked={enabled.has(value)} disabled={!canEdit} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <TextInput label="احتفاظ المقروءة" name="notifRetentionDays" type="number" min={1} max={3650} unit="يوم" defaultValue={orgRow?.notifRetentionDays ?? 30} required disabled={!canEdit} />
          <TextInput label="احتفاظ غير المقروءة" name="notificationRetentionUnreadDays" type="number" min={1} max={3650} unit="يوم" defaultValue={cfg.notificationRetentionUnreadDays} required disabled={!canEdit} />
          <TextInput label="منع التكرار" name="notificationDedupeMinutes" type="number" min={1} max={1440} unit="دقيقة" defaultValue={cfg.notificationDedupeMinutes} required disabled={!canEdit} />
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 md:col-span-3">
            <input type="checkbox" name="importantAlerts" defaultChecked={cfg.importantAlerts} disabled={!canEdit} />
            تفعيل التنبيهات المهمة في الإشعارات النظامية
          </label>
        </fieldset>
        {canEdit ? <SubmitButton>حفظ الإشعارات</SubmitButton> : null}
      </SettingsActionForm>
    </Card>
  );
}

async function FilesTab({ cfg, canEdit, isAdmin }: { cfg: Awaited<ReturnType<typeof getAdminConfig>>; canEdit: boolean; isAdmin: boolean }) {
  const [centers, displayDevices, therapyHalls, collabSettings, libreOfficeStatus, clamAvStatus] = await Promise.all([
    prisma.center.findMany({ orderBy: { name: "asc" } }),
    canEdit ? prisma.displayDevice.findMany({ include: { center: true }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    prisma.therapyHall.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    collaborationSettings(),
    getLibreOfficeStatus(),
    checkClamAvStatus(Math.min(3, cfg.clamavScanTimeoutSeconds)),
  ]);
  return (
    <div className="space-y-5">
      <Card id="files-policy" title="الملفات العامة والطباعة" description="سياسة الرفع العامة مستخدمة عند حفظ المرفقات في أجزاء النظام. إعدادات PDF والبادئات تطبقها النماذج التي تدعمها حالياً فقط.">
        <SettingsActionForm action={saveFilesAction} className="space-y-4">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-3">
            <TextInput label="الحجم الأقصى للرفع" name="maxUploadMb" type="number" min={1} max={100} unit="ميغابايت" defaultValue={cfg.maxUploadMb} required disabled={!canEdit} />
            <TextInput label="الأنواع المسموحة" name="fileTypes" defaultValue={cfg.fileTypes.join(",")} hint="اكتب الامتدادات مفصولة بفواصل، مثل pdf,jpg,png." disabled={!canEdit} />
            <TextInput label="الأنواع الممنوعة" name="blockedFileTypes" defaultValue={cfg.blockedFileTypes.join(",")} hint="تُضاف الامتدادات التنفيذية الخطرة تلقائياً حتى لو حُذفت هنا." disabled={!canEdit} />
            <TextInput label="بادئة الملفات" name="fileNumberPrefix" defaultValue={cfg.fileNumberPrefix} disabled={!canEdit} />
            <TextInput label="بادئة التقارير" name="reportNumberPrefix" defaultValue={cfg.reportNumberPrefix} disabled={!canEdit} />
            <SelectInput label="حجم صفحة PDF" name="pdfPageSize" defaultValue={cfg.pdfPageSize} disabled={!canEdit} options={[{ value: "A4", label: "A4" }, { value: "Letter", label: "Letter" }]} />
            <label className="label md:col-span-3">
              تذييل الطباعة
              <textarea name="printFooter" className="input mt-1" rows={2} defaultValue={cfg.printFooter} disabled={!canEdit} />
            </label>
          </fieldset>

          <div className="rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-800">مركز التعاون</h3>
            <p className="mt-1 text-sm text-gray-500">هذه القيم تطبق على محادثات وملفات التعاون فقط.</p>
            <p className="mt-1 text-xs text-amber-700">مدد احتفاظ الرسائل والسلة محفوظة كسياسة؛ التنظيف الآلي حسبها يحتاج ربط مهمة تنظيف لاحقة.</p>
            <fieldset disabled={!canEdit} className="mt-4 grid min-w-0 gap-4 md:grid-cols-3">
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 md:col-span-3">
                <input type="checkbox" name="servicePaused" defaultChecked={collabSettings.servicePaused} disabled={!canEdit} />
                إيقاف خدمة التعاون مؤقتاً
              </label>
              <TextInput label="حجم ملف التعاون" name="collabMaxUploadMb" type="number" min={1} max={500} unit="ميغابايت" defaultValue={collabSettings.maxUploadMb} required disabled={!canEdit} />
              <TextInput label="مدة تعديل الرسالة" name="editWindowMinutes" type="number" min={1} max={1440} unit="دقيقة" defaultValue={collabSettings.editWindowMinutes} required disabled={!canEdit} />
              <TextInput label="احتفاظ الرسائل" name="messageRetentionDays" type="number" min={1} max={3650} unit="يوم" defaultValue={collabSettings.messageRetentionDays} required disabled={!canEdit} />
              <TextInput label="احتفاظ سلة الملفات" name="trashRetentionDays" type="number" min={1} max={365} unit="يوم" defaultValue={collabSettings.trashRetentionDays} required disabled={!canEdit} />
              <TextInput label="حصة المستخدم" name="userQuotaMb" type="number" min={1} max={102400} unit="ميغابايت" defaultValue={collabSettings.userQuotaMb} required disabled={!canEdit} />
              <TextInput label="حصة القسم" name="departmentQuotaMb" type="number" min={1} max={1024000} unit="ميغابايت" defaultValue={collabSettings.departmentQuotaMb} required disabled={!canEdit} />
              <TextInput label="حصة المركز" name="centerQuotaMb" type="number" min={1} max={1024000} unit="ميغابايت" defaultValue={collabSettings.centerQuotaMb} required disabled={!canEdit} />
              <TextInput label="أنواع التعاون المسموحة" name="collabAllowedTypes" defaultValue={collabSettings.allowedTypes.join(",")} disabled={!canEdit} />
              <TextInput label="أنواع التعاون الممنوعة" name="collabBlockedTypes" defaultValue={collabSettings.blockedTypes.join(",")} disabled={!canEdit} />
            </fieldset>
            <Link href="/collaboration/admin" className="btn-ghost mt-4 inline-flex">فتح إدارة التعاون</Link>
          </div>
          {canEdit ? <SubmitButton>حفظ الملفات والطباعة</SubmitButton> : null}
        </SettingsActionForm>
      </Card>

      <Card id="office-preview" title="معاينة Office" description="لا يفتح Office مباشرة؛ يحول محلياً إلى PDF عند المعاينة. مسار LibreOffice يبقى من بيئة التشغيل ولا يدار من الواجهة.">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <div className="font-medium text-gray-800">LibreOffice</div>
          <div className="mt-1 text-gray-600">
            الحالة: <span className={libreOfficeStatus.available ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>{libreOfficeStatus.available ? "موجود" : "غير موجود"}</span>
            {libreOfficeStatus.version ? <span> · {libreOfficeStatus.version}</span> : null}
          </div>
        </div>
        <SettingsActionForm action={saveOfficePreviewAction} className="space-y-4">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-4">
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 md:col-span-4">
              <input type="checkbox" name="officePreviewEnabled" defaultChecked={cfg.officePreviewEnabled} disabled={!canEdit} />
              تفعيل معاينة docx/xlsx/pptx كـ PDF داخلي
            </label>
            <TextInput label="حد الحجم" name="officePreviewMaxMb" type="number" min={1} max={100} unit="ميغابايت" defaultValue={cfg.officePreviewMaxMb} required disabled={!canEdit} />
            <TextInput label="مهلة التحويل" name="officePreviewTimeoutSeconds" type="number" min={5} max={120} unit="ثانية" defaultValue={cfg.officePreviewTimeoutSeconds} required disabled={!canEdit} />
            <TextInput label="احتفاظ cache المؤقت" name="officePreviewCacheRetentionHours" type="number" min={1} max={720} unit="ساعة" defaultValue={cfg.officePreviewCacheRetentionHours} required disabled={!canEdit} />
          </fieldset>
          {canEdit ? <SubmitButton>حفظ معاينة Office</SubmitButton> : null}
        </SettingsActionForm>
      </Card>

      <Card id="clamav-scan" title="فحص ClamAV" description="الواجهة لا تعدّل host أو port؛ تتحكم فقط بالمهلة وسلوك فشل الفحص. الملفات غير SAFE لا تفتح ولا تنزل.">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <div className="font-medium text-gray-800">حالة الفاحص</div>
          <div className="mt-1 text-gray-600">
            الحالة: <span className={clamAvStatus.available ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>{clamAvStatus.available ? "يعمل" : "غير متاح"}</span>
            <span> · {clamAvStatus.detail}</span>
          </div>
        </div>
        <SettingsActionForm action={saveClamAvAction} className="space-y-4">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-3">
            <TextInput label="مهلة الفحص" name="clamavScanTimeoutSeconds" type="number" min={1} max={60} unit="ثانية" defaultValue={cfg.clamavScanTimeoutSeconds} required disabled={!canEdit} />
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 md:col-span-2">
              <input type="checkbox" name="clamavFailClosed" defaultChecked={cfg.clamavFailClosed} disabled={!canEdit} />
              عند فشل الفحص علّم الملف FAILED بدلاً من PENDING_SCAN
            </label>
          </fieldset>
          {canEdit ? <SubmitButton>حفظ فحص ClamAV</SubmitButton> : null}
        </SettingsActionForm>
      </Card>

      {canEdit ? (
        <DisplaySettings
          devices={JSON.parse(JSON.stringify(displayDevices))}
          centers={centers}
          halls={queueHallNames(therapyHalls.map((hall) => hall.name))}
        />
      ) : null}
    </div>
  );
}

function BackupTab({
  cfg,
  orgRow,
  canEdit,
  canBackup,
  message,
}: {
  cfg: Awaited<ReturnType<typeof getAdminConfig>>;
  orgRow: any;
  canEdit: boolean;
  canBackup: boolean;
  message: any;
}) {
  return (
    <div className="space-y-5">
      <Card id="backup-main" title="النسخ التلقائي والاحتفاظ" description="هذه الصفحة لا تنفذ استعادة أو حذف نسخة. العمليات الفعلية تبقى في صفحة النسخ." message={message}>
        {!canBackup ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">تحتاج صلاحية settings.backup لفتح روابط النسخ والاحتفاظ.</div> : null}
        <SettingsActionForm action={saveBackupAction} className="space-y-4">
          <fieldset disabled={!canEdit || !canBackup} className="grid min-w-0 gap-4 md:grid-cols-3">
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 md:col-span-3">
              <input type="checkbox" name="autoBackup" defaultChecked={orgRow?.autoBackup ?? true} disabled={!canEdit || !canBackup} />
              النسخ التلقائي اليومي
            </label>
            <TextInput label="عدد النسخ المحتفظ بها" name="backupRetentionDays" type="number" min={1} max={3650} defaultValue={cfg.backupRetentionDays} required disabled={!canEdit || !canBackup} />
            <TextInput label="احتفاظ سجل الدخول" name="loginLogRetentionDays" type="number" min={1} max={3650} unit="يوم" defaultValue={orgRow?.loginLogRetentionDays ?? 180} required disabled={!canEdit || !canBackup} />
          </fieldset>
          {canEdit && canBackup ? <SubmitButton>حفظ النسخ والاحتفاظ</SubmitButton> : null}
        </SettingsActionForm>
        <div className="flex flex-wrap gap-2">
          {canBackup ? <Link href="/backup" className="btn-ghost">فتح النسخ الاحتياطي</Link> : null}
          {canBackup ? <Link href="/readiness" className="btn-ghost">فتح فحص الجاهزية</Link> : null}
        </div>
      </Card>

      <Card id="readiness-thresholds" title="عتبات الجاهزية" description="تستخدم في /readiness والتنبيهات التشغيلية، ولا تغيّر النسخ أو الخدمات مباشرة.">
        {!canBackup ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">تعديل عتبات الجاهزية يتطلب صلاحية settings.backup.</div> : null}
        <SettingsActionForm action={saveReadinessAction} className="space-y-4">
          <fieldset disabled={!canEdit || !canBackup} className="grid min-w-0 gap-4 md:grid-cols-4">
            <TextInput label="قدم نسخة قاعدة البيانات" name="dbBackupStaleHours" type="number" min={1} max={720} unit="ساعة" defaultValue={cfg.dbBackupStaleHours} required disabled={!canEdit || !canBackup} />
            <TextInput label="قدم نسخة uploads" name="uploadsBackupStaleHours" type="number" min={1} max={2160} unit="ساعة" defaultValue={cfg.uploadsBackupStaleHours} required disabled={!canEdit || !canBackup} />
            <TextInput label="تحذير القرص" name="diskWarnPercent" type="number" min={1} max={99} unit="%" defaultValue={cfg.diskWarnPercent} required disabled={!canEdit || !canBackup} />
            <TextInput label="خطر القرص" name="diskCriticalPercent" type="number" min={2} max={100} unit="%" defaultValue={cfg.diskCriticalPercent} required disabled={!canEdit || !canBackup} />
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 md:col-span-2">
              <input type="checkbox" name="requireClamav" defaultChecked={cfg.requireClamav} disabled={!canEdit || !canBackup} />
              اعتبر ClamAV متطلباً إلزامياً في الجاهزية
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 md:col-span-2">
              <input type="checkbox" name="requireLibreOffice" defaultChecked={cfg.requireLibreOffice} disabled={!canEdit || !canBackup} />
              اعتبر LibreOffice متطلباً إلزامياً في الجاهزية
            </label>
          </fieldset>
          {canEdit && canBackup ? <SubmitButton>حفظ عتبات الجاهزية</SubmitButton> : null}
        </SettingsActionForm>
      </Card>

      <Card id="expense" title="سياسة اعتماد الصرفيات" description="تحدد عدد مستويات الاعتماد المطلوبة عند إنشاء صرفية جديدة؛ لا تغيّر الصرفيات القديمة." message={message}>
        <form action={saveExpenseApprovalLevels} className="space-y-4">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 md:grid-cols-3">
            <TextInput label="مستويات الاعتماد" name="expenseApprovalLevels" type="number" min={1} max={5} defaultValue={orgRow?.expenseApprovalLevels ?? 1} required disabled={!canEdit} />
          </fieldset>
          {canEdit ? <SubmitButton>حفظ سياسة الصرفيات</SubmitButton> : null}
        </form>
      </Card>
    </div>
  );
}

async function LookupsTab({ canEdit, isAdmin, message }: { canEdit: boolean; isAdmin: boolean; message: any }) {
  const [branches, mobilityAids, prostheticTypes, centers, injuries, governorates, formations, ranks] = await Promise.all([
    prisma.branch.findMany({ include: { _count: { select: { users: true, patients: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.mobilityAid.findMany({ orderBy: { name: "asc" } }),
    prisma.prostheticType.findMany({ orderBy: { name: "asc" } }),
    prisma.center.findMany({ include: { _count: { select: { sessions: true, admissions: true, memberships: true, resources: true, programs: true } } }, orderBy: { name: "asc" } }),
    prisma.injuryType.findMany({ include: { _count: { select: { patients: true } } }, orderBy: { name: "asc" } }),
    prisma.governorate.findMany({ include: { districts: { include: { _count: { select: { patients: true } } }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
    prisma.formation.findMany({ include: { _count: { select: { patients: true } } }, orderBy: { name: "asc" } }),
    prisma.rank.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="space-y-5">
      <Card id="lookups-search" title="بحث القوائم" description="البحث يفلتر العناصر الظاهرة في كل بطاقات القوائم دون حفظ أي تغيير.">
        <LookupSearchInput />
      </Card>
      <DistrictsCard governorates={governorates} canEdit={canEdit} isAdmin={isAdmin} message={message} />
      <BranchCard items={branches} canEdit={canEdit} isAdmin={isAdmin} message={message} />
      <div className="grid gap-5 lg:grid-cols-2">
        <LookupCard card="mobility" title="مساعدات الحركة" items={mobilityAids} action={addMobilityAid} del={deleteMobilityAid} canEdit={canEdit} isAdmin={isAdmin} message={message} />
        <LookupCard card="prosthetic" title="الأطراف الصناعية" items={prostheticTypes} action={addProstheticType} del={deleteProstheticType} canEdit={canEdit} isAdmin={isAdmin} message={message} />
        <LookupCard card="centers" title="المراكز العلاجية" items={centers} action={addCenter} del={deleteCenter} canEdit={canEdit} isAdmin={isAdmin} message={message} />
        <LookupCard card="injuries" title="أنواع الإصابات" items={injuries} action={addInjuryType} del={deleteInjuryType} canEdit={canEdit} isAdmin={isAdmin} message={message} />
        <LookupCard card="formations" title="التشكيلات" items={formations} action={addFormation} del={deleteFormation} canEdit={canEdit} isAdmin={isAdmin} message={message} />
        <LookupCard card="ranks" title="الصفات" items={ranks} action={addRank} del={deleteRank} canEdit={canEdit} isAdmin={isAdmin} message={message} />
      </div>
    </div>
  );
}

function DistrictsCard({ governorates, canEdit, isAdmin, message }: { governorates: any[]; canEdit: boolean; isAdmin: boolean; message: any }) {
  return (
    <Card id="districts" title="المناطق" description="لا يمكن حذف منطقة مستخدمة في بيانات مراجع." message={message}>
      {canEdit ? (
        <form action={addDistrict} className="grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-[220px_1fr_auto]">
          <SelectInput label="المحافظة" name="governorateId" options={governorates.map((g) => ({ value: g.id, label: g.name }))} />
          <TextInput label="اسم المنطقة الجديدة" name="name" required />
          <div className="self-end"><SmallSubmitButton>إضافة منطقة</SmallSubmitButton></div>
        </form>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {governorates.map((g) => (
          <div key={g.id} className="rounded-lg border border-gray-200 p-3" data-lookup-item data-lookup-text={`${g.name} ${g.districts.map((d: any) => d.name).join(" ")}`}>
            <div className="mb-2 font-medium text-gray-800">{g.name} <span className="text-xs text-gray-400">({g.districts.length})</span></div>
            <div className="flex flex-wrap gap-2">
              {g.districts.map((district: any) => (
                <span key={district.id} className="badge flex items-center gap-2 bg-gray-100 text-gray-700">
                  {district.name}
                  {district._count?.patients ? <span className="text-gray-400">{district._count.patients}</span> : null}
                  {canEdit && isAdmin && !district._count?.patients ? (
                    <form action={deleteDistrict.bind(null, district.id)}>
                      <ConfirmSubmitButton message="حذف المنطقة؟" className="text-red-600 hover:text-red-800">×</ConfirmSubmitButton>
                    </form>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BranchCard({ items, canEdit, isAdmin, message }: { items: any[]; canEdit: boolean; isAdmin: boolean; message: any }) {
  const active = items.filter((b) => b.isActive).length;
  const users = items.reduce((sum, b) => sum + (b._count?.users ?? 0), 0);
  const patients = items.reduce((sum, b) => sum + (b._count?.patients ?? 0), 0);
  return (
    <Card id="branches" title="الفروع" description="تعطيل الفرع يخفيه من الاختيارات الجديدة دون حذف السجلات المرتبطة." message={message}>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="badge-success">{active} فعّال</span>
        <span className="badge-neutral">{users} مستخدم</span>
        <span className="badge-neutral">{patients} مراجع</span>
      </div>
      {canEdit ? (
        <form action={addBranch} className="grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-[1fr_auto]">
          <TextInput label="اسم الفرع الجديد" name="name" required />
          <div className="self-end"><SmallSubmitButton>إضافة فرع</SmallSubmitButton></div>
        </form>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((branch) => {
          const used = (branch._count?.users ?? 0) + (branch._count?.patients ?? 0);
          return (
            <article key={branch.id} className="rounded-lg border border-gray-200 p-3" data-lookup-item data-lookup-text={branch.name}>
              <div className="font-semibold text-gray-800">{branch.name}</div>
              <div className="mt-2 flex flex-wrap gap-1 text-xs">
                <span className={branch.isActive ? "badge-success" : "badge-neutral"}>{branch.isActive ? "فعّال" : "معطّل"}</span>
                <span className="badge-neutral">{branch._count?.users ?? 0} مستخدم</span>
                <span className="badge-neutral">{branch._count?.patients ?? 0} مراجع</span>
              </div>
              {canEdit ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={toggleBranch.bind(null, branch.id, !branch.isActive)}>
                    <SmallSubmitButton>{branch.isActive ? "تعطيل" : "تفعيل"}</SmallSubmitButton>
                  </form>
                  {isAdmin && used === 0 ? (
                    <form action={deleteBranch.bind(null, branch.id)}>
                      <ConfirmSubmitButton message="حذف الفرع نهائياً؟">حذف</ConfirmSubmitButton>
                    </form>
                  ) : null}
                </div>
              ) : null}
              {used > 0 ? <p className="mt-2 text-xs text-gray-400">لا يمكن حذف فرع مرتبط بسجلات؛ استخدم التعطيل.</p> : null}
            </article>
          );
        })}
      </div>
    </Card>
  );
}

function LookupCard({
  card,
  title,
  items,
  action,
  del,
  canEdit,
  isAdmin,
  message,
}: {
  card: string;
  title: string;
  items: any[];
  action: (fd: FormData) => Promise<void>;
  del: (id: number) => Promise<void>;
  canEdit: boolean;
  isAdmin: boolean;
  message: any;
}) {
  return (
    <Card id={card} title={title} description="العناصر المستخدمة لا تُحذف؛ تظهر رسالة واضحة عند الارتباط بسجلات." message={message}>
      {canEdit ? (
        <form action={action} className="grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-[1fr_auto]">
          <TextInput label={`إضافة إلى ${title}`} name="name" required />
          <div className="self-end"><SmallSubmitButton>إضافة</SmallSubmitButton></div>
        </form>
      ) : null}
      <ul className="space-y-2 text-sm">
        {items.map((item) => {
          const used = canDeleteCount(item);
          return (
            <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2" data-lookup-item data-lookup-text={item.name}>
              <div className="min-w-0">
                <span className="break-words">{item.name}</span>
                {used ? <span className="mr-2 text-xs text-gray-400">مرتبط بـ {used} سجل</span> : null}
              </div>
              {canEdit && isAdmin && used === 0 ? (
                <form action={del.bind(null, item.id)} className="shrink-0">
                  <ConfirmSubmitButton message={`حذف ${item.name}؟`}>حذف</ConfirmSubmitButton>
                </form>
              ) : null}
            </li>
          );
        })}
        {items.length === 0 ? <li className="text-gray-400">فارغة.</li> : null}
      </ul>
    </Card>
  );
}
