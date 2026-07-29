import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = "http://192.168.17.20:3000";
const CREDENTIALS = "/root/tahili-role-acceptance-credentials.tsv";
const RESULT_DIR = process.env.TAHILI_SMOKE_RESULT_DIR || "/var/lib/tahili-smoke/results";
const METRICS_DIR = process.env.TAHILI_SMOKE_METRICS_DIR || "/var/lib/tahili-smoke/metrics";
const RUN_ID = process.env.TAHILI_SMOKE_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
const CHECKPOINT = path.join(RESULT_DIR, "checkpoint.json");
const LATEST = path.join(path.dirname(RESULT_DIR), "latest-summary.json");
const ROUTES = ["/", "/workspaces", "/my-work", "/patients-care", "/therapy-centers", "/pharmacy-inventory", "/reports-finance", "/staff", "/settings", "/readiness", "/collaboration", "/collaboration/files"] as const;

type Check = { name: string; route: string; passed: boolean; durationMs: number; retries: number; error?: string };
type Counts = Record<string, number>;

function ensurePrivate(dir: string) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); }
function credentials() {
  const stat = fs.statSync(CREDENTIALS);
  if ((stat.mode & 0o077) !== 0) throw new Error("QA credential file permissions are unsafe");
  const row = fs.readFileSync(CREDENTIALS, "utf8").split("\n").find((line) => line && !line.startsWith("#"));
  if (!row) throw new Error("QA credential file has no usable account");
  const [, username, password] = row.split("\t");
  if (!username || !password) throw new Error("QA credential row is malformed");
  return { username, password };
}
async function counts(prisma: PrismaClient): Promise<Counts> {
  const [patients, visits, appointments, therapySessions, collaborationFiles, users] = await Promise.all([
    prisma.patient.count(), prisma.visit.count(), prisma.appointment.count(), prisma.therapySession.count(), prisma.collaborationFile.count(), prisma.user.count(),
  ]);
  return { patients, visits, appointments, therapySessions, collaborationFiles, users };
}
function sameCounts(before: Counts, after: Counts) { return Object.keys(before).every((key) => before[key] === after[key]); }
function writeJson(file: string, value: unknown) { fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 }); fs.chmodSync(file, 0o600); }
function xml(value: string) { return value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c] || c)); }
function clean(dir: string, prefix: string, maxAgeDays: number) {
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const target = path.join(dir, entry.name);
    if (fs.statSync(target).mtimeMs < cutoff) fs.unlinkSync(target);
  }
}
async function visit(page: Page, name: string, route: string, checks: Check[], checkpoint: () => void, patientRoute = false, allowLogin = false) {
  const started = Date.now(); let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (!response || response.status() >= 400 || (!allowLogin && new URL(page.url()).pathname === "/login")) throw new Error("route unavailable");
      checks.push({ name, route: patientRoute ? "/patients/:id" : route, passed: true, durationMs: Date.now() - started, retries: attempt });
      checkpoint();
      return;
    } catch (error) { lastError = error instanceof Error ? error.name : "route check failed"; }
  }
  if (!patientRoute) await page.screenshot({ path: path.join(RESULT_DIR, `failure-${RUN_ID}-${name}.png`), fullPage: false }).catch(() => {});
  checks.push({ name, route: patientRoute ? "/patients/:id" : route, passed: false, durationMs: Date.now() - started, retries: 1, error: lastError });
  checkpoint();
}
function writeMetrics(success: boolean, started: number, checks: Check[]) {
  fs.mkdirSync(METRICS_DIR, { recursive: true, mode: 0o755 }); fs.chmodSync(METRICS_DIR, 0o755);
  const failed = checks.filter((check) => !check.passed).length;
  const passed = checks.length - failed;
  const body = [
    "# HELP tahili_smoke_success Latest read-only smoke run success (1/0)", "# TYPE tahili_smoke_success gauge", `tahili_smoke_success ${success ? 1 : 0}`,
    "# HELP tahili_smoke_last_run_timestamp Unix timestamp of the latest smoke run", "# TYPE tahili_smoke_last_run_timestamp gauge", `tahili_smoke_last_run_timestamp ${Math.floor(Date.now() / 1000)}`,
    "# HELP tahili_smoke_duration_seconds Duration of the latest smoke run", "# TYPE tahili_smoke_duration_seconds gauge", `tahili_smoke_duration_seconds ${(Date.now() - started) / 1000}`,
    "# HELP tahili_smoke_failed_checks Failed checks in the latest smoke run", "# TYPE tahili_smoke_failed_checks gauge", `tahili_smoke_failed_checks ${failed}`,
    "# HELP tahili_smoke_passed_checks Passed checks in the latest smoke run", "# TYPE tahili_smoke_passed_checks gauge", `tahili_smoke_passed_checks ${passed}`,
    "# HELP tahili_smoke_total_checks Total checks in the latest smoke run", "# TYPE tahili_smoke_total_checks gauge", `tahili_smoke_total_checks ${checks.length}`,
  ].join("\n").concat("\n");
  const target = path.join(METRICS_DIR, "tahili_smoke.prom"); const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, body, { mode: 0o644 }); fs.renameSync(temporary, target); fs.chmodSync(target, 0o644);
}

async function main() {
  if (process.env.TAHILI_SMOKE_ENABLED === "false") { console.log("smoke=disabled"); return; }
  loadEnvConfig(ROOT);
  if (process.env.DATABASE_URL) {
    const database = new URL(process.env.DATABASE_URL);
    if (database.hostname === "postgres") { database.hostname = "127.0.0.1"; process.env.DATABASE_URL = database.toString(); }
  }
  ensurePrivate(RESULT_DIR); fs.mkdirSync(METRICS_DIR, { recursive: true, mode: 0o755 }); fs.chmodSync(METRICS_DIR, 0o755);
  const started = Date.now(); const checks: Check[] = []; const prisma = new PrismaClient(); let before: Counts = {}; let after: Counts = {}; let browser: Browser | undefined; let context: BrowserContext | undefined; let stage = "initializing";
  const checkpoint = () => writeJson(CHECKPOINT, { runId: RUN_ID, startedAt: new Date(started).toISOString(), checks: checks.map(({ name, route, passed, retries }) => ({ name, route, passed, retries })) });
  try {
    stage = "db-counts-before"; before = await counts(prisma);
    // Development data is QA-scoped; retain only the opaque ID in memory and never emit it.
    const qaPatient = await prisma.patient.findFirst({ select: { id: true }, orderBy: { id: "asc" } });
    if (!qaPatient) throw new Error("No development patient is available for read-only smoke");
    stage = "browser-launch"; browser = await chromium.launch({ headless: true });
    const testDelay = Number(process.env.TAHILI_SMOKE_TEST_DELAY_SECONDS || "0");
    if (Number.isFinite(testDelay) && testDelay > 0 && testDelay <= 60) { stage = "test-delay"; await new Promise((resolve) => setTimeout(resolve, testDelay * 1000)); }
    context = await browser.newContext({ baseURL: BASE_URL }); const page = await context.newPage();
    await visit(page, "login-page", "/login", checks, checkpoint, false, true);
    const account = credentials();
    await page.locator("#u").fill(account.username); await page.getByRole("button", { name: "متابعة" }).click(); await page.locator("#p").fill(account.password); await page.getByRole("button", { name: "دخول" }).click();
    await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 });
    checks.push({ name: "login-session", route: "/login", passed: true, durationMs: 0, retries: 0 }); checkpoint();
    await page.reload({ waitUntil: "domcontentloaded" });
    checks.push({ name: "session-reload", route: "/", passed: new URL(page.url()).pathname !== "/login", durationMs: 0, retries: 0 }); checkpoint();
    for (const route of ROUTES) await visit(page, route === "/" ? "home" : route.slice(1), route, checks, checkpoint);
    await visit(page, "qa-patient", `/patients/${qaPatient.id}`, checks, checkpoint, true);
    stage = "logout-clear-cookies"; await context.clearCookies();
    stage = "logout-verify"; await page.goto("/", { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname !== "/login") throw new Error("logout did not clear the session");
    checks.push({ name: "session-isolation", route: "/login", passed: true, durationMs: 0, retries: 0 }); checkpoint();
    stage = "db-counts-after"; after = await counts(prisma);
  } catch (error) {
    checks.push({ name: "runner", route: "internal", passed: false, durationMs: 0, retries: 0, error: `stage:${stage}:${error instanceof Error ? error.name : "failed"}` }); checkpoint();
    after = await counts(prisma).catch(() => before);
  } finally { await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await prisma.$disconnect(); }
  const countsMatch = sameCounts(before, after); const success = checks.length > 0 && checks.every((check) => check.passed) && countsMatch;
  const summary = { runId: RUN_ID, startedAt: new Date(started).toISOString(), durationSeconds: (Date.now() - started) / 1000, success, checks, counts: { before, after, match: countsMatch } };
  writeJson(path.join(RESULT_DIR, `smoke-${RUN_ID}.json`), summary); writeJson(CHECKPOINT, summary); writeJson(LATEST, { runId: RUN_ID, startedAt: summary.startedAt, success, durationSeconds: summary.durationSeconds, checks: checks.map(({ name, passed }) => ({ name, passed })), countsMatch });
  fs.writeFileSync(path.join(RESULT_DIR, `smoke-${RUN_ID}.xml`), `<?xml version="1.0"?><testsuite name="tahili-readonly-smoke" tests="${checks.length}" failures="${checks.filter((c) => !c.passed).length}">${checks.map((c) => `<testcase name="${xml(c.name)}" time="${c.durationMs / 1000}">${c.passed ? "" : `<failure message="${xml(c.error || "failed")}"/>`}</testcase>`).join("")}</testsuite>\n`, { mode: 0o600 });
  clean(RESULT_DIR, "smoke-", success ? 7 : 14); clean(RESULT_DIR, "failure-", 14); writeMetrics(success, started, checks);
  console.log(`smoke=${success ? "PASS" : "FAIL"} checks=${checks.filter((c) => c.passed).length}/${checks.length} duration_seconds=${summary.durationSeconds.toFixed(1)}`);
  process.exitCode = success ? 0 : 1;
}
main().catch(() => { process.exitCode = 1; });
