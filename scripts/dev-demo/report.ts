// Turns a full demo check run into one Arabic summary: test-results/demo/report.md and summary.json.
// Run after the check: npx tsx scripts/dev-demo/report.ts
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.DEMO_RESULTS || "test-results/demo");
const lines = (file: string) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
const json = (file: string, fallback: any) => (fs.existsSync(path.join(dir, file)) ? JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) : fallback);

const steps = lines("steps.jsonl").filter((item: any) => item.area !== "debug");
const findings = lines("findings.jsonl");
const stale = lines("stale-refresh.jsonl");
const coverage = json("sweep-coverage.json", {});
const patients = json("patients.json", {});
const results = json("results.json", null);
const sweepResults = json("sweep-results.json", null);

const order = ["حرج", "عالي", "متوسط", "منخفض"];
const grouped = new Map<string, { severity: string; area: string; message: string; count: number; users: Set<string>; urls: Set<string>; screenshot?: string }>();
for (const item of findings) {
  const message = String(item.message).replace(/ — طلبات معلقة:.*$/, "").replace(/cm[a-z0-9]{20,}/g, "…");
  const key = `${item.severity}|${item.area}|${message}`;
  const entry = grouped.get(key) ?? { severity: item.severity, area: item.area, message, count: 0, users: new Set(), urls: new Set(), screenshot: item.screenshot };
  entry.count++;
  if (item.user) entry.users.add(item.user);
  if (item.url) entry.urls.add(String(item.url).replace(/cm[a-z0-9]{20,}/g, "…"));
  grouped.set(key, entry);
}
const issues = [...grouped.values()].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || b.count - a.count);

const byArea = new Map<string, { ok: number; failed: number }>();
for (const item of steps) {
  const entry = byArea.get(item.area) ?? { ok: 0, failed: 0 };
  if (item.ok) entry.ok++; else entry.failed++;
  byArea.set(item.area, entry);
}
const totalOk = steps.filter((item: any) => item.ok).length;
const totalFailed = steps.filter((item: any) => !item.ok).length;
const runs = [results, sweepResults].filter((run) => run?.stats);
const tests = runs.length ? {
  passed: runs.reduce((sum, run) => sum + run.stats.expected, 0), failed: runs.reduce((sum, run) => sum + run.stats.unexpected, 0),
  flaky: runs.reduce((sum, run) => sum + run.stats.flaky, 0), minutes: Math.round(runs.reduce((sum, run) => sum + run.stats.duration, 0) / 60000),
} : null;
const pages = Object.values(coverage as Record<string, { pages: number }>).reduce((sum, item) => sum + item.pages, 0);
const score = totalOk + totalFailed ? Math.round((totalOk / (totalOk + totalFailed)) * 100) : 0;

const summary = {
  generatedAt: new Date().toISOString(), score, steps: { ok: totalOk, failed: totalFailed }, tests, patients: Object.keys(patients).length,
  accounts: Object.keys(coverage).length, pages, staleRefresh: stale.length,
  issues: issues.map((item) => ({ ...item, users: [...item.users], urls: [...item.urls].slice(0, 5) })),
  areas: Object.fromEntries(byArea),
};
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));

const md: string[] = [];
md.push(`# تقرير الفحص الشامل — نسخة التجربة 3001`, "", `التاريخ: ${new Date().toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" })}`, "");
md.push(`- نسبة الخطوات الناجحة: **${score}%** (${totalOk} ناجحة، ${totalFailed} متوقفة)`);
if (tests) md.push(`- الاختبارات: ${tests.passed} ناجح، ${tests.failed} فاشل — المدة ${tests.minutes} دقيقة`);
md.push(`- المراجعون التجريبيون: ${summary.patients}، الحسابات المفحوصة: ${summary.accounts}، الصفحات المفتوحة: ${pages}`);
md.push(`- مرات ما تحدثت الشاشة بعد الحفظ (تحتاج تحديث يدوي): ${stale.length}`, "");
md.push("## المسارات", "", "| المسار | خطوات ناجحة | متوقفة |", "|---|---|---|");
for (const [area, entry] of byArea) md.push(`| ${area} | ${entry.ok} | ${entry.failed} |`);
md.push("", "## المشاكل حسب الخطورة", "");
if (!issues.length) md.push("ماكو مشاكل مسجلة. ✓");
for (const item of issues) md.push(`- **${item.severity}** · ${item.area} · ${item.message}${item.count > 1 ? ` (×${item.count})` : ""}${item.users.size ? ` — الحسابات: ${[...item.users].slice(0, 4).join("، ")}` : ""}${item.screenshot ? ` — صورة: ${item.screenshot}` : ""}`);
fs.writeFileSync(path.join(dir, "report.md"), `${md.join("\n")}\n`);
process.stdout.write(`${md.slice(0, 8).join("\n")}\n`);
