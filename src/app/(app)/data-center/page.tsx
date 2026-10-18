import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { AdminIntro, AdminSection, AdminSectionTabs } from "@/components/AdminPageSections";
import { DataTable, StatusBadge, TableEmptyRow } from "@/components/Ui";
import { fmtDateTime } from "@/lib/labels";
import { currentActor } from "@/lib/data-center/access";
import { applyLockReason, currentDatabaseName, importAllowed, listOperations } from "@/lib/data-center/operations";
import { DISABLED_EXPORTS, EXPORT_IS_REIMPORTABLE, IMPORT_DOMAINS, PRIMARY_IMPORT_DOMAINS, STAFF_TEMPLATE_VERSION, TEMPLATE_VERSION, isAdvancedDomain, type FieldDef, type ImportDomain } from "@/lib/data-center/registry";
import { loadReferences } from "@/lib/data-center/reference";
import { fieldChoices } from "@/lib/data-center/templates";
import { FILE_LIMITS } from "@/lib/data-center/spreadsheet";
import { EXPORT_DOMAINS, exportAllowed } from "@/lib/data-center/export";
import { previewImportAction } from "./actions";

export const dynamic = "force-dynamic";

type Tab = "import" | "export" | "templates" | "history" | "rules";
const TABS: { key: Tab; label: string }[] = [
  { key: "import", label: "الاستيراد" },
  { key: "export", label: "التصدير" },
  { key: "templates", label: "القوالب الرسمية" },
  { key: "history", label: "السجل والإيصالات" },
  { key: "rules", label: "القواعد والمساعدة" },
];

const STATUS: Record<string, string> = { PREVIEWED: "معاينة", APPLYING: "قيد التنفيذ", APPLIED: "نُفِّذ", PARTIAL: "نُفِّذ جزئياً", FAILED: "فشل", CANCELLED: "أُلغي", COMPLETED: "اكتمل", DENIED: "مرفوض" };
const DOMAIN_TITLE: Record<string, string> = Object.fromEntries([...IMPORT_DOMAINS.map((d) => [d.id, d.title]), ...EXPORT_DOMAINS.map((d) => [d.id, d.title])]);
const TYPE_LABEL: Record<string, string> = { text: "نص", int: "رقم صحيح", percent: "نسبة 0–100", year: "سنة", phone: "هاتف", enum: "قائمة مغلقة", yesno: "نعم/لا", date: "تاريخ", username: "اسم مستخدم", email: "بريد", ref: "قائمة النظام" };
const CATEGORY_CARD: Record<string, { icon: string; blurb: string }> = {
  patients: { icon: "🧑‍⚕️", blurb: "ملفات المراجعين بالحقول نفسها التي يطلبها نموذج التسجيل" },
  staff: { icon: "🧑‍💼", blurb: "ملف واحد بثلاث أوراق مترابطة: الأشخاص، الحسابات المطلوبة، عضويات المراكز" },
};

export default async function DataCenterPage({ searchParams }: { searchParams: Promise<{ tab?: string; type?: string; err?: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.has("datacenter.view")) redirect("/");
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "import";
  const allowed = IMPORT_DOMAINS.filter((d) => importAllowed(actor, d.id));
  const primary = PRIMARY_IMPORT_DOMAINS.map((id) => allowed.find((d) => d.id === id)).filter((d): d is ImportDomain => !!d); // patients first, then the unified staff file
  const advanced = allowed.filter((d) => isAdvancedDomain(d.id));
  const selected = primary.find((d) => d.id === sp.type) ?? primary[0];
  const exportDomains = EXPORT_DOMAINS.filter((d) => exportAllowed(actor, d.id));
  const lock = applyLockReason(await currentDatabaseName(prisma));
  const isAdmin = actor.role === "ADMIN";
  const branches = isAdmin ? await prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const ownBranch = !isAdmin && actor.branchId != null ? await prisma.branch.findUnique({ where: { id: actor.branchId }, select: { name: true } }) : null;
  const history = tab === "history" ? await listOperations(prisma, actor) : [];
  const refs = tab === "templates" ? await loadReferences(prisma) : null;
  const required = (d: ImportDomain) => (d.sheets ? d.sheets[0].fields : d.fields).filter((f) => f.required);

  const fieldsTable = (fields: FieldDef[]) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead><tr><th className="th">الحقل</th><th className="th">المعرّف</th><th className="th">الإلزام</th><th className="th">النوع</th><th className="th">القيم المسموحة / الشرح</th></tr></thead>
        <tbody>
          {fields.map((f) => {
            const c = refs ? fieldChoices(f, refs) : null;
            return (
              <tr key={f.id}>
                <td className="td">{f.label}</td>
                <td className="td font-mono text-xs" dir="ltr">{f.id}</td>
                <td className="td">{f.required ? <StatusBadge tone="danger">مطلوب</StatusBadge> : <StatusBadge tone="neutral">اختياري</StatusBadge>}</td>
                <td className="td">{TYPE_LABEL[f.type] ?? f.type}</td>
                <td className="td text-xs">{c ? (c.values.length > 8 ? `${c.values.slice(0, 8).join(" / ")} … (+${c.values.length - 8})` : c.values.join(" / ") || "—") + (c.strict ? "" : " (مقترحة)") : f.help}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // Full contract (Templates / Help section only): fields, allowed values, what is intentionally not importable.
  const contractCard = (d: ImportDomain) => (
    <details key={d.id} className="card p-4" id={d.id} data-testid={`contract-${d.id}`}>
      <summary className="cursor-pointer font-semibold">{d.title}{isAdvancedDomain(d.id) ? <span className="mr-2 text-xs font-normal text-gray-500">(خيار متقدم)</span> : null}</summary>
      <p className="mt-2 text-xs text-gray-600">المرجع المعتمد: {d.authority}</p>
      <p className="mt-1 text-xs text-gray-600">سياسة الهوية: {d.identityPolicy}</p>
      {d.sheets ? d.sheets.map((sh) => (
        <div key={sh.id} className="mt-3"><h3 className="text-sm font-semibold">ورقة «{sh.name}» — {sh.title}</h3>{fieldsTable(sh.fields)}</div>
      )) : fieldsTable(d.fields)}
      {d.notImported.length ? <div className="mt-3 text-xs text-gray-600"><b>غير قابل للاستيراد عمداً:</b> {d.notImported.map((n) => `${n.name} (${n.reason})`).join("؛ ")}</div> : null}
      <div className="mt-3 flex gap-2">
        <a className="btn-ghost btn-sm" href={`/api/data-center/templates/${d.id}?format=xlsx`}>تنزيل القالب XLSX</a>
        {d.sheets ? null : <a className="btn-ghost btn-sm" href={`/api/data-center/templates/${d.id}?format=csv`}>CSV</a>}
      </div>
    </details>
  );

  const branchField = (suffix: string) => isAdmin ? (
    <div>
      <label className="label" htmlFor={`dc-branch${suffix}`}>الفرع الوجهة</label>
      <select id={`dc-branch${suffix}`} name="branchId" className="input" required>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </div>
  ) : <div><span className="label">الفرع الوجهة</span><p className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm" data-testid="dc-own-branch">{ownBranch?.name ?? "حسابك بلا فرع فعّال"}</p></div>;

  return (
    <div className="min-w-0 space-y-6" dir="rtl">
      <PageHeader title="استيراد وتصدير البيانات" subtitle="قوالب رسمية مطابقة لحقول النظام، معاينة وتحقق قبل أي تنفيذ، وتصدير محكوم بالصلاحيات والفرع" icon="🗄" />
      <AdminSectionTabs tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/data-center?tab=${t.key}` }))} active={tab} label="تبويبات مركز البيانات" />

      {sp.err ? <div role="alert" className="card-danger p-3 text-sm text-red-800">{sp.err}</div> : null}
      {lock ? <div className="card-warning p-3 text-sm text-amber-900" data-testid="apply-lock-banner">🔒 {lock}</div> : null}

      {tab === "import" ? (
        allowed.length === 0 ? <div className="card p-4 text-sm text-gray-600">ليست لديك صلاحية استيراد أي نوع من البيانات.</div> : (
          <>
            <AdminIntro title="الاستيراد" description="1 اختر النوع ← 2 نزّل القالب الرسمي ← 3 ارفع الملف ← 4 راجع المعاينة والأخطاء ← 5 أكّد التنفيذ ← 6 احتفظ بالإيصال. لا يُكتب شيء قبل التأكيد، ولا يُحدَّث أي سجل قائم." />
            {selected ? (
              <>
                <section aria-label="نوع الاستيراد" className="grid gap-3 sm:grid-cols-2" data-testid="import-types">
                  {primary.map((d) => (
                    <Link key={d.id} href={`/data-center?tab=import&type=${d.id}`} aria-current={d.id === selected.id ? "true" : undefined} data-testid={`type-${d.id}`}
                      className={`card block p-4 transition ${d.id === selected.id ? "border-brand-500 ring-2 ring-brand-200" : "hover:border-gray-300"}`}>
                      <div className="flex items-center gap-3"><span className="text-2xl" aria-hidden="true">{CATEGORY_CARD[d.id]?.icon}</span><div><div className="font-semibold">{d.title}</div><p className="text-xs text-gray-600">{CATEGORY_CARD[d.id]?.blurb}</p></div></div>
                    </Link>
                  ))}
                </section>

                <AdminSection id="selected" title={`استيراد: ${selected.title}`} description="متطلبات النوع المختار فقط؛ التفاصيل الكاملة والقيم المسموحة في «القوالب الرسمية».">
                  <div className="space-y-4" data-testid="selected-requirements">
                    <div>
                      <h3 className="mb-1 text-sm font-semibold">{selected.sheets ? "الأوراق" : "الحقول المطلوبة"}</h3>
                      {selected.sheets ? (
                        <ul className="space-y-1 text-sm text-gray-700">
                          <li><b>الأشخاص</b> (مطلوبة): {required(selected).map((f) => f.label).join("، ")}؛ والفئة تحدد الطبيب المقيم / الاختصاص / الموظف.</li>
                          <li><b>الحسابات</b> (اختيارية): رمز الشخص، اسم المستخدم، الدور المطلوب (تُنشأ الحسابات غير مفعّلة).</li>
                          <li><b>العضويات</b> (اختيارية): رمز الشخص واسم المركز.</li>
                        </ul>
                      ) : (
                        <div className="flex flex-wrap gap-2 text-xs">{required(selected).map((f) => <StatusBadge key={f.id} tone="danger">{f.label}</StatusBadge>)}<span className="self-center text-gray-500">+ {selected.fields.filter((f) => !f.required).length} حقل اختياري</span></div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a className="btn-primary btn-sm" href={`/api/data-center/templates/${selected.id}?format=xlsx`} data-testid="template-xlsx">تنزيل القالب الرسمي (XLSX)</a>
                      {selected.sheets ? null : <a className="btn-ghost btn-sm" href={`/api/data-center/templates/${selected.id}?format=csv`}>CSV</a>}
                      <Link className="text-xs text-brand-700 hover:underline" href={`/data-center?tab=templates#${selected.id}`}>تفاصيل الحقول والقيم المسموحة</Link>
                    </div>
                    <form action={previewImportAction} className="grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2" encType="multipart/form-data">
                      <input type="hidden" name="domain" value={selected.id} />
                      {branchField("")}
                      <div className="sm:col-span-2">
                        <label className="label" htmlFor="dc-file">الملف ({selected.sheets ? "XLSX فقط" : "XLSX أو CSV بترميز UTF-8"})</label>
                        <input id="dc-file" name="file" type="file" accept={selected.sheets ? ".xlsx" : ".xlsx,.csv"} className="input" required />
                        <p className="mt-1 text-xs text-gray-500">الحد: {FILE_LIMITS.maxBytes / 1024 / 1024} ميغابايت، {FILE_LIMITS.maxRows} صف. الماكرو والصيغ والمراجع الخارجية مرفوضة.</p>
                      </div>
                      <div className="sm:col-span-2"><button type="submit" className="btn-primary w-full sm:w-auto">معاينة وتحقق</button></div>
                    </form>
                  </div>
                </AdminSection>
              </>
            ) : <div className="card p-4 text-sm text-gray-600">لا تملك صلاحيات الاستيراد الأساسية؛ الخيارات المتقدمة أدناه.</div>}

            {advanced.length ? (
              <details className="card p-4" data-testid="advanced-import">
                <summary className="cursor-pointer font-semibold">خيارات متقدمة: مستورِدات منفصلة لكل نوع</summary>
                <p className="mt-2 text-xs text-gray-600">للمسارات القديمة فقط (موظفون، أطباء مقيمون، أطباء اختصاص، حسابات، عضويات). يُفضَّل الملف الموحّد للكادر أعلاه.</p>
                <form action={previewImportAction} className="mt-3 grid gap-3 sm:grid-cols-2" encType="multipart/form-data">
                  <div>
                    <label className="label" htmlFor="dc-domain-adv">النوع</label>
                    <select id="dc-domain-adv" name="domain" className="input" required>{advanced.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
                  </div>
                  {branchField("-adv")}
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="dc-file-adv">الملف (XLSX أو CSV)</label>
                    <input id="dc-file-adv" name="file" type="file" accept=".xlsx,.csv" className="input" required />
                    <p className="mt-1 text-xs text-gray-500">القوالب: {advanced.map((d) => <span key={d.id} className="ml-2"><a className="text-brand-700 hover:underline" href={`/api/data-center/templates/${d.id}?format=xlsx`}>{d.title}</a></span>)}</p>
                  </div>
                  <div className="sm:col-span-2"><button type="submit" className="btn-ghost w-full sm:w-auto">معاينة وتحقق</button></div>
                </form>
              </details>
            ) : null}
          </>
        )
      ) : null}

      {tab === "export" ? (
        <>
          <AdminIntro title="التصدير" description={`يقتصر التصدير على فرعك وصلاحيتك. صلاحية عرض الصفحة وحدها لا تمنح تصديراً. ملفات التصدير ملخصات للقراءة${EXPORT_IS_REIMPORTABLE ? "" : " وليست قوالب استيراد ولا تُعاد استيراداً كما هي"}.`} />
          {exportDomains.length === 0 ? <div className="card p-4 text-sm text-gray-600">ليست لديك صلاحية تصدير أي نوع.</div> : (
            <AdminSection id="export" title="طلب تصدير">
              <form method="get" action="/api/data-center/export" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="label" htmlFor="ex-domain">النوع</label>
                  <select id="ex-domain" name="domain" className="input">
                    {exportDomains.map((d) => <option key={d.id} value={d.id}>{d.title}{d.needsRange ? " (يتطلب نطاقاً زمنياً)" : ""}</option>)}
                  </select>
                </div>
                {isAdmin ? (
                  <div>
                    <label className="label" htmlFor="ex-branch">الفرع</label>
                    <select id="ex-branch" name="branchId" className="input">
                      <option value="">كل الفروع</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                ) : null}
                <div>
                  <label className="label" htmlFor="ex-format">الصيغة</label>
                  <select id="ex-format" name="format" className="input"><option value="xlsx">XLSX</option><option value="csv">CSV</option></select>
                </div>
                <div><label className="label" htmlFor="ex-from">من تاريخ</label><input id="ex-from" name="from" type="date" className="input" /></div>
                <div><label className="label" htmlFor="ex-to">إلى تاريخ</label><input id="ex-to" name="to" type="date" className="input" /></div>
                <div className="flex items-end gap-2">
                  <button type="submit" className="btn-primary">تنزيل</button>
                  <button type="submit" name="count" value="1" className="btn-ghost" formTarget="_blank">عدد الصفوف</button>
                </div>
              </form>
              <ul className="mt-4 space-y-1 text-xs text-gray-600">
                {exportDomains.map((d) => <li key={d.id}><b>{d.title}:</b> {d.note}</li>)}
              </ul>
            </AdminSection>
          )}
          <AdminSection id="disabled" title="تصديرات معطّلة عمداً">
            <ul className="space-y-1 text-sm text-gray-700">
              {DISABLED_EXPORTS.map((d) => <li key={d.title}><b>{d.title}:</b> {d.reason}</li>)}
            </ul>
          </AdminSection>
        </>
      ) : null}

      {tab === "templates" ? (
        <AdminSection id="templates" title={`القوالب الرسمية (المراجعون وخيارات متقدمة ${TEMPLATE_VERSION} · الكادر الموحّد ${STAFF_TEMPLATE_VERSION})`} description="الصف الأول معرّفات ثابتة والثاني تسميات عربية؛ التعليمات والقوائم المنسدلة (المأخوذة من النظام وقت التنزيل) في ورقتين منفصلتين، ولا بيانات نموذجية داخل صفوف الاستيراد.">
          <div className="space-y-3">
            {allowed.length ? [...allowed.filter((d) => !isAdvancedDomain(d.id)), ...allowed.filter((d) => isAdvancedDomain(d.id))].map(contractCard) : <p className="text-sm text-gray-600">ليست لديك صلاحية استيراد أي نوع من البيانات.</p>}
          </div>
        </AdminSection>
      ) : null}

      {tab === "history" ? (
        <AdminSection id="history" title="سجل العمليات" description="كل معاينة وتنفيذ وتصدير مع الفاعل والنتيجة؛ لا تُخزَّن بيانات شخصية في هذا السجل.">
          <DataTable label="سجل عمليات البيانات" className="-mx-5 -mb-5 rounded-none border-x-0 border-b-0">
            <table className="w-full">
              <thead><tr><th className="th">النوع</th><th className="th">البيانات</th><th className="th">الحالة</th><th className="th">الفرع</th><th className="th">الصفوف</th><th className="th">المنفّذ</th><th className="th">التاريخ</th><th className="th">إيصال</th></tr></thead>
              <tbody>
                {history.map((o) => (
                  <tr key={o.id}>
                    <td className="td">{o.kind === "IMPORT" ? "استيراد" : "تصدير"}</td>
                    <td className="td">{DOMAIN_TITLE[o.domain] ?? o.domain}</td>
                    <td className="td"><StatusBadge tone={o.status === "APPLIED" || o.status === "COMPLETED" ? "success" : o.status === "DENIED" || o.status === "FAILED" ? "danger" : "neutral"}>{STATUS[o.status] ?? o.status}</StatusBadge></td>
                    <td className="td">{o.branch?.name ?? "—"}</td>
                    <td className="td">{o.rowCount ?? "—"}</td>
                    <td className="td">{o.actor?.fullName ?? "—"}</td>
                    <td className="td">{fmtDateTime(o.createdAt)}</td>
                    <td className="td">{o.kind === "IMPORT" ? <Link className="text-brand-700 hover:underline" href={`/data-center/import/${o.id}`}>فتح</Link> : "—"}</td>
                  </tr>
                ))}
                {history.length === 0 ? <TableEmptyRow colSpan={8} title="لا توجد عمليات بعد" description="ستظهر هنا المعاينات والتصديرات." /> : null}
              </tbody>
            </table>
          </DataTable>
        </AdminSection>
      ) : null}

      {tab === "rules" ? (
        <AdminSection id="rules" title="القواعد والمساعدة">
          <ul className="list-disc space-y-1 pr-5 text-sm text-gray-700">
            <li>القوالب مولَّدة من تعريف واحد مشترك مع التحقق والتنفيذ؛ الحقول المطلوبة هي نفسها المطلوبة عند التسجيل اليدوي في النظام (للمراجع: الاسم، الجنس، سنة التولد، الهاتف، المحافظة، نوع الإصابة، نوع الحالة).</li>
            <li>ملف الكادر الموحّد: ورقة «الأشخاص» (سجلات الموظفين) ثم «الحسابات» و«العضويات» المرتبطتان برمز الشخص؛ ملف واحد ينتج معاينة واحدة وخطة واحدة، ويُنفَّذ كله أو لا يُنفَّذ شيء.</li>
            <li>أطباء التدرج = RESIDENT، الأطباء الاختصاص = DOCTOR؛ أما الموظفون فلا يُستنتج لهم دور من المسمى: يلزم دور صريح مع «تم التحقق من الدور = نعم».</li>
            <li>الحسابات تُنشأ غير مفعّلة وبلا كلمة سر قابلة للاستخدام، ولا ترتبط بسجل موجود إلا بسجل مطابق تماماً وغير مرتبط؛ ADMIN وMANAGER يُحجزان لاعتماد منفصل؛ دور بلا عضوية مركز لا يصل إلى أي مركز.</li>
            <li>تُفحص الملفات بمحتواها لا بامتدادها؛ تُرفض الماكرو والمراجع الخارجية والمحتوى غير المدعوم، ولا تُنفَّذ الصيغ أبداً. عمود غير مدعوم يظهر في المعاينة ولا يُهمل بصمت.</li>
            <li>الهوية: كل نوع له سياسة تكرار موثقة؛ تكرار الهاتف أو تشابه الاسم لا يدمج أشخاصاً، ولا يُختلق تاريخ ميلاد ناقص.</li>
            <li>لا تحديث جماعي للسجلات القائمة: المطابقات تُصنَّف فقط (جاهز / مطابق / مكرر / محجوز / غير صالح / مستثنى).</li>
            <li>الملف المنفَّذ لا يُنفَّذ مرتين (بصمة SHA-256 لكل نوع وفرع)، وتُعاد مراجعته في الخادم عند التأكيد؛ الفرع الوجهة يظهر صراحةً.</li>
            <li>مستثنى عمداً: المواعيد والجلسات والأدوية والتشخيصات والوصفات والمعاملات المالية والتدقيق والتقارير الطبية.</li>
          </ul>
        </AdminSection>
      ) : null}
    </div>
  );
}
