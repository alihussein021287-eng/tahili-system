import { getSession } from "@/lib/access";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { getBackupOverview, type BackupFile } from "@/lib/backup";
import { fmtDateTime } from "@/lib/labels";
import { createBackup, deleteBackup, restoreBackupAction, toggleAutoBackup } from "./actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmtSize(b: number) { return b > 1048576 ? (b / 1048576).toFixed(1) + " م.ب" : Math.max(1, Math.round(b / 1024)) + " ك.ب"; }
function typeLabel(b: BackupFile) {
  if (b.kind === "uploads") return "مرفقات";
  if (b.type === "auto") return "قاعدة بيانات - تلقائية";
  if (b.type === "manual") return "قاعدة بيانات - يدوية";
  if (b.type === "server") return "قاعدة بيانات - سكربت السيرفر";
  return "قاعدة بيانات";
}
function locationLabel(b: BackupFile) { return b.location === "app" ? "واجهة التطبيق" : "سيرفر التطوير"; }
function backupAge(b: BackupFile | null) {
  if (!b) return "لا توجد نسخة";
  const hours = Math.floor((Date.now() - b.mtime.getTime()) / 3600000);
  if (hours < 1) return "قبل أقل من ساعة";
  if (hours < 24) return `قبل ${hours} ساعة`;
  return `قبل ${Math.floor(hours / 24)} يوم`;
}

export default async function Backup({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const s = await getSession();
  if ((s?.user as any)?.role !== "ADMIN") notFound();
  const sp = await searchParams;
  const [overview, org] = await Promise.all([
    Promise.resolve(getBackupOverview()),
    prisma.orgSetting.findUnique({ where: { id: 1 }, select: { autoBackup: true, lastAutoBackupAt: true } }),
  ]);
  const backups = overview.app;
  const serverBackups = overview.server.slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader title="النسخ الاحتياطي والاستعادة" subtitle="نسخ يدوي وتلقائي يومي + استعادة بواجهة — للأدمن فقط" icon="💾" />
      {sp.msg && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">✅ {sp.msg}</div>}
      {sp.err && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">⚠ {sp.err}</div>}

      <div className="grid gap-3 lg:grid-cols-3">
        <SummaryCard title="آخر نسخة قاعدة بيانات" value={overview.latestDb ? overview.latestDb.name : "لا توجد"} detail={overview.latestDb ? `${typeLabel(overview.latestDb)} · ${fmtSize(overview.latestDb.size)} · ${backupAge(overview.latestDb)}` : "أنشئ نسخة من الواجهة أو شغّل backup.sh"} tone={overview.latestDb ? "ok" : "warn"} />
        <SummaryCard title="آخر نسخة مرفقات" value={overview.latestUploads ? overview.latestUploads.name : "غير موجودة"} detail={overview.latestUploads ? `${fmtSize(overview.latestUploads.size)} · ${backupAge(overview.latestUploads)} · من سكربت السيرفر` : "مرفقات uploads لا تُنسخ من زر الواجهة؛ استخدم backup.sh"} tone={overview.latestUploads ? "ok" : "warn"} />
        <SummaryCard title="النسخ التلقائي" value={org?.autoBackup ? "مفعّل" : "متوقف"} detail={org?.lastAutoBackupAt ? `آخر تشغيل: ${fmtDateTime(org.lastAutoBackupAt)}` : "لم يُسجل تشغيل تلقائي بعد"} tone={org?.autoBackup ? "ok" : "warn"} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form action={createBackup}><button className="btn-primary" type="submit">＋ إنشاء نسخة الآن</button></form>
        <Link href="/readiness" className="btn-ghost">فحص الجاهزية والصحة الفنية</Link>
        <form action={toggleAutoBackup.bind(null, !(org?.autoBackup ?? true))}>
          <button className={`rounded-lg px-4 py-2 text-sm font-medium ${org?.autoBackup ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`} type="submit">
            النسخ التلقائي اليومي: {org?.autoBackup ? "مفعّل ✔ (اضغط للإيقاف)" : "متوقف (اضغط للتفعيل)"}
          </button>
        </form>
        {org?.lastAutoBackupAt && <span className="text-xs text-gray-400">آخر نسخة تلقائية: {fmtDateTime(org.lastAutoBackupAt)}</span>}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="font-semibold">تحذير الاستعادة</div>
        <div className="mt-1 text-xs leading-6">
          الاستعادة من الواجهة تستبدل قاعدة البيانات الحالية فقط، ولا تستعيد مرفقات uploads. نسخ المرفقات تُنشأ عبر <span className="font-mono">backup.sh</span> داخل <span className="font-mono">/tahili-system/backups</span> وتُستعاد يدوياً حسب توثيق التشغيل.
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <div className="border-b p-4">
          <div className="font-semibold text-gray-800">نسخ قاعدة البيانات من واجهة التطبيق</div>
          <div className="mt-1 text-xs text-gray-500">هذه ملفات SQL غير مضغوطة داخل مجلد uploads/backups ويمكن تنزيلها أو استعادتها من هنا.</div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="p-3 text-right">الملف</th><th className="p-3 text-right">النوع</th><th className="p-3 text-right">التاريخ</th><th className="p-3 text-right">الحجم</th><th className="p-3 text-right">إجراءات</th></tr>
          </thead>
          <tbody>
            {backups.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-400">لا توجد نسخ بعد — اضغط «إنشاء نسخة الآن».</td></tr>}
            {backups.map((b) => (
              <tr key={b.name} className="border-t align-top">
                <td className="p-3 font-mono text-xs text-gray-700">{b.name}</td>
                <td className="p-3 text-gray-600"><span className={`rounded-full px-2 py-0.5 text-[11px] ${b.type === "auto" ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-700"}`}>{typeLabel(b)}</span></td>
                <td className="whitespace-nowrap p-3 text-gray-600">{fmtDateTime(b.mtime)}</td>
                <td className="p-3 text-gray-600">{fmtSize(b.size)}</td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/api/backup-download?f=${encodeURIComponent(b.name)}`} className="rounded bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">⬇ تنزيل</a>
                    <details className="relative">
                      <summary className="cursor-pointer rounded bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100">استعادة…</summary>
                      <form action={restoreBackupAction.bind(null, b.name)} className="mt-1 flex items-center gap-1">
                        <input name="confirm" className="input !py-1 text-xs" placeholder="اكتب: استعادة" autoComplete="off" />
                        <button className="shrink-0 rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700" type="submit">تنفيذ</button>
                      </form>
                    </details>
                    <details>
                      <summary className="cursor-pointer rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">حذف…</summary>
                      <form action={deleteBackup.bind(null, b.name)} className="mt-1 flex items-center gap-1">
                        <input name="confirm" className="input !py-1 text-xs" placeholder="اكتب: حذف" autoComplete="off" />
                        <button className="shrink-0 rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700" type="submit">حذف</button>
                      </form>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto p-0">
        <div className="border-b p-4">
          <div className="font-semibold text-gray-800">آخر نسخ السيرفر</div>
          <div className="mt-1 text-xs text-gray-500">تُنشأ بواسطة backup.sh وتشمل قاعدة البيانات المضغوطة وملفات uploads. الاستعادة منها يدوية وليست من واجهة التطبيق.</div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr><th className="p-3 text-right">الملف</th><th className="p-3 text-right">النوع</th><th className="p-3 text-right">المكان</th><th className="p-3 text-right">التاريخ</th><th className="p-3 text-right">الحجم</th></tr>
          </thead>
          <tbody>
            {serverBackups.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-400">لا توجد نسخ سيرفر في /tahili-system/backups.</td></tr>}
            {serverBackups.map((b) => (
              <tr key={b.name} className="border-t">
                <td className="p-3 font-mono text-xs text-gray-700">{b.name}</td>
                <td className="p-3 text-gray-600">{typeLabel(b)}</td>
                <td className="p-3 text-gray-600">{locationLabel(b)}</td>
                <td className="whitespace-nowrap p-3 text-gray-600">{fmtDateTime(b.mtime)}</td>
                <td className="p-3 text-gray-600">{fmtSize(b.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, detail, tone }: { title: string; value: string; detail: string; tone: "ok" | "warn" }) {
  return (
    <div className={`card p-4 ${tone === "warn" ? "ring-1 ring-amber-200" : ""}`}>
      <div className="text-xs font-medium text-gray-500">{title}</div>
      <div className={`mt-2 break-all text-sm font-bold ${tone === "warn" ? "text-amber-800" : "text-gray-900"}`}>{value}</div>
      <div className="mt-1 text-xs leading-5 text-gray-500">{detail}</div>
    </div>
  );
}
