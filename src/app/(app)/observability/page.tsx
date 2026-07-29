import { PageHeader } from "@/components/PageHeader";
import { ObservabilityRefresh } from "@/components/ObservabilityRefresh";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getObservabilitySummary, type MetricReading, type MonitoringState } from "@/lib/observability-summary";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATE: Record<MonitoringState, { label: string; tone: string; detail: string }> = {
  healthy: {
    label: "سليم",
    tone: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800",
    detail: "البيانات المتاحة سليمة؛ تظهر العزلة الأمنية وانتظار العينات كلٌ بحالته المستقلة.",
  },
  attention: {
    label: "يحتاج انتباهاً",
    tone: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800",
    detail: "توجد إشارة تشغيلية تستحق المراجعة في أدوات المراقبة الداخلية.",
  },
  waiting: {
    label: "بانتظار بيانات",
    tone: "bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-800",
    detail: "المسار يعمل، لكن لا توجد عينات كافية لحساب المؤشر بعد.",
  },
  security_na: {
    label: "غير مراقب أمنياً",
    tone: "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
    detail: "N/A مقصود للحفاظ على العزل؛ لا يدل على تعطل الخدمة.",
  },
  unavailable: {
    label: "غير متاح فعلياً",
    tone: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-800",
    detail: "تعذر جلب مصدر مراقبة مطلوب؛ يحتاج تشخيصاً دون افتراض تعطل التطبيق.",
  },
};

const numberFormat = new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 1 });

function displayReading(reading: MetricReading, suffix = "", zeroText?: string) {
  if (reading.state === "security_na") return "N/A — غير مفعّل أمنياً";
  if (reading.state === "waiting") return "بانتظار بيانات كافية";
  if (reading.state === "unavailable" || reading.value === null) return "غير متاح فعلياً";
  if (reading.value === 0 && zeroText) return `٠ — ${zeroText}`;
  return `${numberFormat.format(reading.value)}${suffix}`;
}

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

    <section className="card p-4" aria-labelledby="status-legend">
      <h2 id="status-legend" className="font-semibold">دليل الحالات</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {(Object.keys(STATE) as MonitoringState[]).map((state) => <StatusCard key={state} label={STATE[state].label} state={state} detail={STATE[state].detail} compact />)}
      </div>
    </section>

    <section className="card p-4" aria-labelledby="services-title">
      <h2 id="services-title" className="font-semibold">حالة الخدمات</h2>
      <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">خدمات المراقبة من health وtargets ثابتة. خدمات التطبيق المعزولة لا تُربط مباشرةً بشبكة monitoring.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {summary.services.map((service) => <StatusCard key={service.key} label={service.label} state={service.state} detail={service.detail} />)}
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="التنبيهات النشطة" detail="التصنيف حسب الشدة والخدمة فقط.">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="الإجمالي" state={summary.alerts.state} value={summary.alerts.total === null ? "غير متاح فعلياً" : String(summary.alerts.total)} />
          <Metric label="حرج" state={summary.alerts.state} value={summary.alerts.critical === null ? "غير متاح فعلياً" : String(summary.alerts.critical)} />
          <Metric label="تحذير" state={summary.alerts.state} value={summary.alerts.warning === null ? "غير متاح فعلياً" : String(summary.alerts.warning)} />
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">الخدمات: {summary.alerts.state === "unavailable" ? "غير متاح فعلياً" : summary.alerts.services.length ? summary.alerts.services.join("، ") : "لا توجد تنبيهات نشطة"}</p>
      </Section>

      <Section title="الفحص التلقائي Smoke" detail="آخر ملخص قراءة فقط من Stage 5؛ زر التحديث لا يبدأ الفحص.">
        <StatusCard label="الحالة" state={summary.smoke.state} />
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Metric
            label="النتيجة"
            state={summary.smoke.state}
            value={summary.smoke.passedChecks === null || summary.smoke.totalChecks === null ? "غير متاح فعلياً" : `${summary.smoke.passedChecks}/${summary.smoke.totalChecks}`}
          />
          <Metric label="تاريخ التشغيل" state={summary.smoke.state} value={summary.smoke.lastRunAt ? new Date(summary.smoke.lastRunAt).toLocaleString("ar-IQ") : "غير متاح فعلياً"} />
          <Metric label="المدة" state={summary.smoke.state} value={summary.smoke.durationSeconds === null ? "غير متاح فعلياً" : `${numberFormat.format(summary.smoke.durationSeconds)} ث`} />
        </div>
      </Section>

      <Section title="موارد الخادم" detail="لا Docker socket ولا privileged ولا host-root mounts ضمن التصميم الحالي.">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="CPU" state={summary.resources.cpu.state} value={displayReading(summary.resources.cpu, "%")} />
          <Metric label="RAM" state={summary.resources.memory.state} value={displayReading(summary.resources.memory, "%")} />
          <Metric label="القرص" state={summary.resources.disk.state} value={displayReading(summary.resources.disk, "%")} />
        </div>
      </Section>

      <Section title="مراقبة الواجهة Faro" detail="مؤشرات مجمعة ومنقحة فقط؛ غياب عينة LCP ليس عطلاً، والـsynthetic لا يعني وجود مراقبة دورية.">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="مفعّل" state={summary.faro.enabled.state} value={summary.faro.enabled.value === null ? "غير متاح فعلياً" : summary.faro.enabled.value ? "نعم" : "لا"} />
          <Metric
            label="Faro forwarding"
            state={summary.faro.forwardFailures.state}
            value={summary.faro.forwardFailures.value === 0 ? "سليم — لا توجد إخفاقات" : displayReading(summary.faro.forwardFailures)}
          />
          <Metric
            label="المراقبة التلقائية الدورية"
            state={summary.faro.automaticTelemetryExpected.state}
            value={summary.faro.automaticTelemetryExpected.value === null ? "غير متاح فعلياً" : summary.faro.automaticTelemetryExpected.value ? "مفعلة" : "غير مفعلة حالياً — N/A مقصود"}
          />
          <Metric label="الإشارات المستلمة" state={summary.faro.signals.state} value={displayReading(summary.faro.signals)} />
          <Metric label="أخطاء/دقيقة" state={summary.faro.errorsPerMinute.state} value={displayReading(summary.faro.errorsPerMinute, "", "لا توجد أخطاء")} />
          <Metric label="LCP p95" state={summary.faro.lcpP95Ms.state} value={displayReading(summary.faro.lcpP95Ms, " ms")} />
        </div>
      </Section>

      <Section title="أداء الخادم وTempo" detail="مؤشرات traces مجمعة فقط، بلا trace IDs أو spans؛ غياب عينة 5xx يُعرض كانتظار بيانات.">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="OTEL مفعّل" state={summary.tracing.enabled.state} value={summary.tracing.enabled.value === null ? "غير متاح فعلياً" : summary.tracing.enabled.value ? "نعم" : "لا"} />
          <Metric label="traces/دقيقة" state={summary.tracing.tracesPerMinute.state} value={displayReading(summary.tracing.tracesPerMinute)} />
          <Metric label="p95" state={summary.tracing.latencyP95Ms.state} value={displayReading(summary.tracing.latencyP95Ms, " ms")} />
          <Metric label="5xx" state={summary.tracing.server5xxPercent.state} value={displayReading(summary.tracing.server5xxPercent, "%", "لا توجد استجابات 5xx")} />
          <Metric label="فشل التصدير" state={summary.tracing.exportFailures.state} value={displayReading(summary.tracing.exportFailures, "", "لا توجد إخفاقات")} />
        </div>
      </Section>

      <Section title="النسخ والجاهزية" detail="روابط داخلية متاحة للمدير؛ لا تنفذ هذه الصفحة أي إجراء.">
        <div className="mt-3 flex flex-wrap gap-2"><Link href="/readiness" className="btn-ghost">فحص الجاهزية</Link><Link href="/backup" className="btn-ghost">النسخ الاحتياطي</Link></div>
      </Section>
    </div>
  </div>;
}

function Section({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return <section className="card p-4"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{detail}</p><div className="mt-3">{children}</div></section>;
}

function Metric({ label, value, state }: { label: string; value: string; state: MonitoringState }) {
  const tone = STATE[state].tone;
  return <div className={`rounded-lg p-3 ring-1 ${tone}`}><div className="text-xs opacity-75">{label}</div><div className="mt-1 break-words text-sm font-bold">{value}</div></div>;
}

function StatusCard({ label, state, detail, compact = false }: { label: string; state: MonitoringState; detail?: string; compact?: boolean }) {
  const item = STATE[state];
  return <div className={`rounded-lg p-3 ring-1 ${item.tone}`}><div className="text-xs opacity-75">{label}</div>{!compact && <div className="mt-1 text-sm font-bold">{item.label}</div>}{detail && <div className="mt-1 text-xs leading-5 opacity-80">{detail}</div>}</div>;
}
