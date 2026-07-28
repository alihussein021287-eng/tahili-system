import { PageHeader } from "@/components/PageHeader";
import { ObservabilityRefresh } from "@/components/ObservabilityRefresh";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getObservabilitySummary, type MonitoringState } from "@/lib/observability-summary";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATE: Record<MonitoringState, { label: string; tone: string; detail: string }> = {
  healthy: { label: "سليم", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200", detail: "تصل بيانات المراقبة المتاحة ولا توجد إشارة تشغيلية ظاهرة في هذا الملخص." },
  attention: { label: "يحتاج انتباهاً", tone: "bg-amber-50 text-amber-800 ring-amber-200", detail: "توجد إشارة تشغيلية تستحق المراجعة في أدوات المراقبة الداخلية." },
  unavailable: { label: "غير متاح", tone: "bg-gray-100 text-gray-700 ring-gray-200", detail: "تعذر جلب جزء من بيانات المراقبة؛ يستمر التطبيق دون تعطيل." },
};

function value(number: number | null, suffix = "") { return number === null ? "غير متاح" : `${new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 1 }).format(number)}${suffix}`; }

export default async function ObservabilityPage() {
  const session = await requireSession();
  const userId = (session.user as { id?: string } | undefined)?.id;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } }) : null;
  if (!user?.isActive || user.role !== "ADMIN") redirect("/");
  const summary = await getObservabilitySummary();
  const overall = STATE[summary.state];

  return <div className="space-y-5">
    <PageHeader title="مراقبة النظام" subtitle="ملخص تشغيلي مبسط للمدير؛ لا يعرض سجلات أو traces خام." icon="📡"><ObservabilityRefresh /></PageHeader>
    <section className={`card ring-1 p-5 ${overall.tone}`} aria-labelledby="observability-status">
      <h2 id="observability-status" className="text-lg font-bold">الحالة العامة: {overall.label}</h2>
      <p className="mt-1 text-sm leading-6">{overall.detail}</p>
      <p className="mt-3 text-xs opacity-80">آخر تحديث: {new Date(summary.refreshedAt).toLocaleString("ar-IQ")}</p>
    </section>

    <section className="card p-4" aria-labelledby="services-title"><h2 id="services-title" className="font-semibold">حالة الخدمات</h2><p className="mt-1 text-xs text-gray-500">حالات مجمعة من targets وفحوصات محلية ثابتة؛ لا عناوين أو بيانات اتصال.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{summary.services.map((service) => <StatusCard key={service.key} label={service.label} state={service.state} />)}</div></section>

    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="التنبيهات النشطة" detail="التصنيف حسب الشدة والخدمة فقط."><div className="grid grid-cols-3 gap-2"><Metric label="الإجمالي" value={String(summary.alerts.total)} /><Metric label="حرج" value={String(summary.alerts.critical)} /><Metric label="تحذير" value={String(summary.alerts.warning)} /></div><p className="mt-3 text-xs text-gray-500">الخدمات: {summary.alerts.services.length ? summary.alerts.services.join("، ") : "لا توجد تنبيهات نشطة"}</p></Section>
      <Section title="الفحص التلقائي Smoke" detail="آخر فحص قراءة فقط؛ لا يبدأ الفحص من هذه الصفحة."><StatusCard label="الحالة" state={summary.smoke.state} /><div className="mt-3 grid grid-cols-2 gap-2"><Metric label="منذ آخر تشغيل" value={value(summary.smoke.lastRunSecondsAgo, " ث")}/><Metric label="المدة" value={value(summary.smoke.durationSeconds, " ث")}/></div></Section>
      <Section title="موارد الخادم" detail="مؤشرات مجمعة دون تفاصيل عمليات أو ملفات."><div className="grid grid-cols-3 gap-2"><Metric label="CPU" value={value(summary.resources.cpuPercent, "%")} /><Metric label="RAM" value={value(summary.resources.memoryPercent, "%")} /><Metric label="القرص" value={value(summary.resources.diskPercent, "%")} /></div></Section>
      <Section title="مراقبة الواجهة Faro" detail="حالة تجميعية للواجهة؛ لا سجلات متصفح خام."><div className="grid grid-cols-2 gap-2"><Metric label="مفعّل" value={summary.faro.enabled === null ? "غير متاح" : summary.faro.enabled ? "نعم" : "لا"}/><Metric label="أخطاء/دقيقة" value={value(summary.faro.errorsPerMinute)} /><Metric label="LCP p95" value={value(summary.faro.lcpP95Ms, " ms")} /><Metric label="فشل الإرسال" value={value(summary.faro.forwardFailures)} /></div></Section>
      <Section title="أداء الخادم وTempo" detail="مؤشرات traces مجمعة فقط، بلا trace IDs أو spans."><div className="grid grid-cols-2 gap-2"><Metric label="OTEL مفعّل" value={summary.tracing.enabled === null ? "غير متاح" : summary.tracing.enabled ? "نعم" : "لا"}/><Metric label="traces/دقيقة" value={value(summary.tracing.tracesPerMinute)} /><Metric label="p95" value={value(summary.tracing.latencyP95Ms, " ms")} /><Metric label="5xx" value={value(summary.tracing.server5xxPercent, "%")} /><Metric label="فشل التصدير" value={value(summary.tracing.exportFailures)} /></div></Section>
      <Section title="النسخ والجاهزية" detail="روابط داخلية متاحة للمدير؛ لا تنفذ هذه الصفحة أي إجراء."><div className="mt-3 flex flex-wrap gap-2"><Link href="/readiness" className="btn-ghost">فحص الجاهزية</Link><Link href="/backup" className="btn-ghost">النسخ الاحتياطي</Link></div></Section>
    </div>
  </div>;
}

function Section({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) { return <section className="card p-4"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p><div className="mt-3">{children}</div></section>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-gray-50 p-3"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 break-words text-sm font-bold text-gray-800">{value}</div></div>; }
function StatusCard({ label, state }: { label: string; state: MonitoringState }) { const item = STATE[state]; return <div className={`rounded-lg p-3 ring-1 ${item.tone}`}><div className="text-xs opacity-75">{label}</div><div className="mt-1 text-sm font-bold">{item.label}</div></div>; }
