import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/access";
import { maintenanceOn } from "@/lib/maintenance";
import { PageHeader } from "@/components/PageHeader";
import { wipeCategory, wipeAll } from "./actions";
import { CATS } from "./cats";
import { getBackupOverview } from "@/lib/backup";
import { getReadinessChecks } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export default async function Maintenance({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const session = await requireSession();
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  if (!isAdmin || !(await maintenanceOn())) notFound();
  const sp = await searchParams;
  const [technicalChecks, recentMaintenance] = await Promise.all([
    getReadinessChecks(),
    prisma.auditLog.findMany({ where: { tableName: { startsWith: "maintenance:" } }, include: { user: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const latestBackup = getBackupOverview().latestDb;
  const backupRecent = Boolean(latestBackup && Date.now() - latestBackup.mtime.getTime() <= 86400000);

  // عدّادات كل فئة
  const c = await prisma.$transaction([
    prisma.appointment.count(),      // 0
    prisma.queueEntry.count(),       // 1
    prisma.therapySession.count(),   // 2
    prisma.prescription.count(),     // 3
    prisma.admission.count(),        // 4
    prisma.woundAssessment.count(),  // 5
    prisma.correspondence.count(),   // 6
    prisma.device.count(),           // 7
    prisma.invoice.count(),          // 8
    prisma.task.count(),             // 9
    prisma.shift.count(),            // 10
    prisma.leave.count(),            // 11
    prisma.attendance.count(),       // 12
    prisma.employee.count(),         // 13
    prisma.medicalReport.count(),    // 14
    prisma.diagnosis.count(),        // 15
    prisma.relative.count(),         // 16
    prisma.auditLog.count(),         // 17
    prisma.medication.count(),       // 18
    prisma.governorate.count(),      // 19
    prisma.injuryType.count(),       // 20
    prisma.center.count(),           // 21
    prisma.patient.count(),          // 22
    prisma.user.count({ where: { role: { not: "ADMIN" } } }), // 23
  ]);

  const cards = [
    { key: "appointments", count: c[0] },
    { key: "queue", count: c[1] },
    { key: "sessions", count: c[2] },
    { key: "prescriptions", count: c[3] },
    { key: "admissions", count: c[4] },
    { key: "wounds", count: c[5] },
    { key: "correspondence", count: c[6] },
    { key: "devices", count: c[7] },
    { key: "finance", count: c[8] },
    { key: "tasks", count: c[9] },
    { key: "shiftsLeaves", count: c[10] + c[11] },
    { key: "attendance", count: c[12] + c[13] },
    { key: "clinicalDocs", count: c[14] + c[15] },
    { key: "relativesVisits", count: c[16] },
    { key: "audit", count: c[17] },
    { key: "meds", count: c[18] },
    { key: "reference", count: c[19] + c[20] + c[21] },
    { key: "patients", count: c[22] },
    { key: "users", count: c[23], label: "المستخدمون (عدا الأدمن)", note: "يحذف كل المستخدمين والصلاحيات ما عدا الأدمن." },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="مركز الصيانة الفني" subtitle="فحوص التشغيل منفصلة عن منطقة الخطر" icon="🧹" />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {technicalChecks.map((check) => <div key={check.key} className="card p-4"><div className="text-sm font-semibold">{check.label}</div><div className={`mt-2 text-xs ${check.status === 'ok' ? 'text-emerald-700' : check.status === 'fail' ? 'text-red-700' : 'text-amber-700'}`}>{check.detail}</div></div>)}
      </section>
      <section className="card p-4"><h2 className="font-semibold">آخر عمليات الصيانة</h2><div className="mt-2 space-y-1 text-sm">{recentMaintenance.length ? recentMaintenance.map((x)=><div key={x.id}>{x.action} · {x.tableName} · {x.user?.fullName ?? 'النظام'} · {x.createdAt.toLocaleString('ar-IQ')}</div>) : <div className="text-gray-400">لا توجد عمليات صيانة مسجلة.</div>}</div></section>

      <div className="border-t-4 border-red-500 pt-5"><h2 className="text-xl font-bold text-red-800">منطقة الخطر</h2><p className="text-sm text-gray-600">بعيدة عن الفحوص الآمنة وتتطلب وضع الصيانة ونسخة حديثة وتأكيداً متعدد الخطوات.</p></div>

      <div className="card-danger p-4 text-sm text-red-800">
        <b>تحذير:</b> كل عملية هنا حذف نهائي. حالة النسخة الحديثة: <b>{backupRecent ? `صالحة (${latestBackup?.name})` : "غير متوفرة؛ المسح محظور"}</b>.
        <Link href="/settings" className="mr-2 underline">→ الإعدادات</Link>
      </div>

      {sp.msg && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">✅ {sp.msg}</div>}
      {sp.err && <div className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">⚠ {sp.err}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const meta = (CATS as any)[card.key] || { label: card.label, note: card.note };
          const empty = card.count === 0;
          return (
            <div key={card.key} className={`card p-4 ${empty ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-gray-800">{meta.label}</div>
                <span className={`badge ${empty ? "bg-gray-100 text-gray-500" : "bg-brand-50 text-brand-700"}`}>{card.count}</span>
              </div>
              {(meta.note || card.note) && <div className="mt-1 text-xs text-gray-400">{meta.note || card.note}</div>}
              {!empty && card.key !== "audit" && (
                <form action={wipeCategory.bind(null, card.key)} className="mt-3 flex items-center gap-2">
                  <input type="hidden" name="expectedCount" value={card.count} />
                  <input name="confirm" className="input !py-1 text-sm" placeholder="اكتب: امسح" autoComplete="off" />
                  <input name="count" inputMode="numeric" className="input !py-1 text-sm" placeholder={`العدد: ${card.count}`} autoComplete="off" />
                  <button disabled={!backupRecent} className="btn-danger btn-sm shrink-0" type="submit">مسح</button>
                </form>
              )}
              {card.key === "audit" && <p className="mt-3 text-xs font-medium text-emerald-700">محفوظ دائماً لإثبات العمليات.</p>}
            </div>
          );
        })}
      </div>

      <div className="card border-2 border-red-300 p-5">
        <div className="mb-1 font-bold text-red-700">تصفير شامل</div>
        <p className="mb-3 text-sm text-gray-600">يمسح <b>كل البيانات</b> ويُبقي فقط حساب الأدمن وإعدادات المركز. اكتب «تصفير شامل» للتأكيد.</p>
        <form action={wipeAll} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="expectedCount" value={c.reduce((sum, n, i) => i === 17 ? sum : sum + n, 0)} />
          <input name="confirm" className="input max-w-xs" placeholder="اكتب: تصفير شامل" autoComplete="off" />
          <input name="confirmCount" className="input max-w-xs" placeholder={`اكتب عدد السجلات: ${c.reduce((sum, n, i) => i === 17 ? sum : sum + n, 0)}`} autoComplete="off" />
          <button disabled={!backupRecent} className="btn-danger font-bold" type="submit">تصفير النظام بالكامل</button>
        </form>
      </div>
    </div>
  );
}
